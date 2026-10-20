// Cámara + COCO-SSD lite (objetos) + Tesseract (texto). Todo corre en el celular.
// Bucle adaptativo, guardas contra carreras y lectura con votación.
const Scanner = (() => {
  const LIB = {
    tf: '/vendor/tf.min.js',
    coco: '/vendor/coco-ssd.min.js',
    model: '/vendor/coco/model.json',
    tess: '/vendor/tess/tesseract.min.js',
    worker: location.origin + '/vendor/tess/worker.min.js',
    core: location.origin + '/vendor/tess/core',
    lang: location.origin + '/vendor/tess/lang',
    words: '/vendor/es-words.txt',
  };
  const TEXT_MODES = new Set(['texto', 'traducir', 'medicina']);
  const OCR_IDLE_MS = 90000;               // libera el worker de Tesseract tras 90 s sin usar

  let video, overlay, ctx, camEl, stream, facing = Camera.load().facing || 'environment';
  let camInfo = null, openMs = 0, paused = false;
  let modelP, tessP, tessWorker, tessIdle = 0, curPsm = '';
  let mode = 'escena', running = false, starting = null, gen = 0, timer = null, busy = false;
  let lastSaved = 0, lastColor = '', lastLines = [], lastAdvice = '', lastStill = null, readToken = 0, infer = 250;
  const lastSpoken = new Map();
  const cb = { hud() {}, status() {}, save() {}, swatch() {}, state() {}, narrate(t, o = {}) { Speech.speak(t, { interrupt: !!(o.urgent || o.interrupt) }); } };
  // vigilancia: nada puede quedarse esperando para siempre
  const WORKER_LOAD_MS = 20000, FIRST_DETECT_MS = 15000, DETECT_MS = 4000, MUTE_MS = 3000;
  const READ_STEP_MS = 30000;              // preparar el lector o leer una pasada: tiempo máximo
  const STILL_MAX = 2400;                  // lado mayor de la foto para leer (el OCR usa ≤ 1800 px; menos memoria)
  let lastError = null, firstDetect = true, reopening = false, muteTimer = 0;
  const noteError = msg => { lastError = { msg: String(msg || 'error'), at: Date.now() }; };

  const loadScript = src => new Promise((ok, ko) => {
    const ex = [...document.scripts].find(s => s.src === new URL(src, location.href).href);
    if (ex) return ex.dataset.done ? ok() : (ex.addEventListener('load', ok), ex.addEventListener('error', () => ko(new Error('No se pudo cargar la IA'))));
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { s.dataset.done = '1'; ok(); };
    s.onerror = () => { s.remove(); ko(new Error('falta ' + src)); };
    document.head.appendChild(s);
  });

  // ---- detector de objetos ----
  // Preferido: Web Worker (la interfaz nunca se congela). Respaldo: hilo principal.
  const workerOK = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
  let det = null;            // { detect(video, max) -> predicciones }
  let workerBroken = false, detFails = 0;
  let backendName = null;
  const DETECT_W = 480;      // ancho al que se reduce cada cuadro antes de analizarlo

  function makeWorkerDetector() {
    return new Promise((ok, ko) => {
      const w = new Worker('/js/ai/detector.worker.js');
      const pending = new Map();
      let nextId = 1, settled = false, loadTimer = 0;
      const fail = msg => { clearTimeout(loadTimer); if (!settled) { settled = true; ko(new Error(msg)); } pending.forEach(p => p.ko(new Error(msg))); pending.clear(); };
      loadTimer = setTimeout(() => { fail('la IA en segundo plano tardó demasiado en cargar'); try { w.terminate(); } catch {} }, WORKER_LOAD_MS);
      w.onerror = e => fail(e.message || 'el worker falló');
      w.onmessage = ev => {
        const m = ev.data;
        if (m.type === 'ready') {
          clearTimeout(loadTimer); settled = true; backendName = m.backend;
          ok({
            detect(video, max) {
              const k = Math.min(1, DETECT_W / video.videoWidth);
              const rw = Math.max(1, Math.round(video.videoWidth * k)), rh = Math.max(1, Math.round(video.videoHeight * k));
              return createImageBitmap(video, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'low' }).then(bitmap => new Promise((res, rej) => {
                const id = nextId++;
                pending.set(id, { ok: preds => res(preds.map(p => ({ ...p, bbox: p.bbox.map(v => v / k) }))), ko: rej });
                w.postMessage({ type: 'detect', id, bitmap, max }, [bitmap]);
              }));
            },
            terminate() { w.terminate(); },
          });
        } else if (m.type === 'result') {
          const p = pending.get(m.id); if (p) { pending.delete(m.id); p.ok(m.preds); }
        } else if (m.type === 'error') {
          if (m.id) { const p = pending.get(m.id); if (p) { pending.delete(m.id); p.ko(new Error(m.message)); } }
          else fail(m.message);
        }
      };
      const abs = u => location.origin + u;
      w.postMessage({ type: 'load', tf: abs(LIB.tf), coco: abs(LIB.coco), model: abs(LIB.model) });
    });
  }

  async function makeMainDetector() {
    await loadScript(LIB.tf);
    await loadScript(LIB.coco);
    if (typeof tf !== 'undefined') { try { await tf.ready(); } catch {} }
    const m = await cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: LIB.model });
    backendName = typeof tf !== 'undefined' && tf.getBackend ? tf.getBackend() : null;
    let warmed = false;
    return {
      async detect(video, max) {
        if (!warmed) { cb.status('Preparando la IA…'); await new Promise(r => setTimeout(r, 30)); }
        const r = await m.detect(video, max);
        if (!warmed) { warmed = true; cb.status(''); }
        return r;
      },
    };
  }

  function ensureModel() {
    if (det) return Promise.resolve(det);
    if (!modelP) {
      cb.status('Cargando la IA en tu celular (solo la primera vez)…');
      modelP = (async () => {
        let d = null;
        if (workerOK && !workerBroken) {
          try { d = await makeWorkerDetector(); }
          catch (e) { workerBroken = true; noteError('IA en segundo plano: ' + e.message); console.warn('worker de IA no disponible, se usa el hilo principal:', e.message); }
        }
        if (!d) d = await makeMainDetector();
        det = d; firstDetect = true;
        return d;
      })().finally(() => cb.status('')).catch(e => { modelP = null; throw e; });
    }
    return modelP;
  }
  // precarga en segundo plano, con el dispositivo en reposo
  function preload() {
    const go = () => { ensureModel().catch(() => {}); };
    setTimeout(() => { if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 15000 }); else go(); }, 3000);
  }

  // ---- cámara ----
  const wantRes = m => (TEXT_MODES.has(m) ? { width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 640 }, height: { ideal: 480 } });

  function syncOverlay() {
    if (!video || !overlay || !video.videoWidth) return;
    if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) { overlay.width = video.videoWidth; overlay.height = video.videoHeight; }
  }

  async function start(opts) {
    Object.assign(cb, opts);
    if (starting) return starting;                      // doble toque: reutiliza la apertura en curso
    starting = (async () => {
      video = document.getElementById('video');
      overlay = document.getElementById('overlay');
      camEl = document.getElementById('cam');
      ctx = overlay.getContext('2d');
      halt();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Este dispositivo no permite usar la cámara (se requiere HTTPS o la app instalada).');
      const my = ++gen;
      const t0 = performance.now();
      const saved = Camera.load();
      const r = await Camera.open({ facing, res: wantRes(mode), saved: saved.facing === facing ? saved : {} });
      if (my !== gen) { r.stream.getTracks().forEach(t => t.stop()); return; }   // se canceló mientras abría
      stream = r.stream; camInfo = r; facing = r.facing;
      watchTrack(stream.getVideoTracks()[0]);
      video.srcObject = stream;
      video.onresize = syncOverlay;
      await video.play();
      openMs = Math.round(performance.now() - t0);
      syncOverlay();
      camEl.classList.add('on');
      camEl.classList.toggle('mirror', r.mirrored);     // solo si la cámara abierta es de verdad la frontal
      Camera.save({ facing: r.facing, deviceId: r.deviceId });
      running = true;
      Scene.reset();
      begin();                                          // no se espera: el botón no queda bloqueado
    })().finally(() => { starting = null; });
    return starting;
  }

  // la cámara que se corta sola (otra app, el sistema) se reabre una vez
  function watchTrack(t) {
    if (!t) return;
    const lost = () => {
      if (!running || reopening || !stream || stream.getVideoTracks()[0] !== t) return;
      reopening = true;
      noteError('La cámara se detuvo sola');
      cb.narrate('La cámara se detuvo. La vuelvo a abrir.');
      start({ ...cb })
        .catch(e => { const m = Camera.explain(e); noteError(m); cb.state(false); cb.hud(m); cb.narrate(m, { interrupt: true }); })
        .finally(() => { reopening = false; });
    };
    t.addEventListener('ended', lost);
    t.addEventListener('mute', () => { clearTimeout(muteTimer); muteTimer = setTimeout(() => { if (t.muted) lost(); }, MUTE_MS); });
    t.addEventListener('unmute', () => clearTimeout(muteTimer));
  }

  // detiene bucle y libera la cámara
  function halt() {
    running = false; paused = false;
    gen++;
    readToken++;
    clearTimeout(timer); timer = null; busy = false;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    if (video) { video.srcObject = null; video.onresize = null; }
    if (camEl) camEl.classList.remove('on');
    if (ctx && overlay) ctx.clearRect(0, 0, overlay.width, overlay.height);
  }

  // la IA no carga (ni en segundo plano ni de respaldo): se dice qué hacer y el ojo vuelve a «Escanear»
  function aiFailed(e) {
    noteError('No se pudo cargar la IA: ' + ((e && e.message) || e));
    halt();
    cb.state(false);
    cb.hud('No se pudo cargar la IA. Pulsa el ojo para intentarlo de nuevo; si se repite, ve a Ajustes → Diagnóstico → Reintentar.');
    cb.narrate('No se pudo cargar la inteligencia artificial. Pulsa el ojo para intentarlo de nuevo.', { interrupt: true });
  }

  async function begin() {
    gen++;
    clearTimeout(timer); timer = null;
    if (!running) return;
    const g = gen;
    if (mode === 'escena' || mode === 'alerta') {
      try { await ensureModel(); }
      catch (e) { if (g === gen) aiFailed(e); return; }
      if (g !== gen) return;
    }
    if (TEXT_MODES.has(mode)) {
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      cb.hud(mode === 'medicina' ? 'Apunta a la caja y pulsa «Leer medicina».' : 'Apunta al texto y pulsa «Leer».');
      return;
    }
    tick(g);
  }

  async function tick(g) {
    if (g !== gen || !running) return;
    const t0 = performance.now();
    if (!busy) {
      busy = true;
      try {
        if (mode === 'color') colorTick(); else { await detectTick(g); detFails = 0; }
      } catch (e) {
        console.error(e);
        noteError(e.message || String(e));
        // si el worker falla varias veces seguidas, se pasa al hilo principal
        if (++detFails >= 3 && det && det.terminate && !workerBroken) {
          workerBroken = true; try { det.terminate(); } catch {}
          det = null; modelP = null; detFails = 0;
          if (running) ensureModel().catch(e => { if (g === gen) aiFailed(e); });
        }
      }
      if (g === gen) busy = false;
    }
    infer = infer * 0.6 + (performance.now() - t0) * 0.4;
    // pausa adaptativa: nunca más del 40 % del tiempo en inferencia
    const delay = mode === 'color' ? 600 : Math.min(1200, Math.max(250, infer * 1.5));
    if (g === gen && running) timer = setTimeout(() => tick(g), delay);
  }

  function throttle(key, ms) {
    const now = Date.now();
    if ((lastSpoken.get(key) || 0) + ms > now) return false;
    lastSpoken.set(key, now); return true;
  }

  function colorTick() {
    const c = Scene.centerColor(video);
    if (!c) return;
    cb.swatch(c.rgb);
    const text = [c.name, c.light].filter(Boolean).join(', ');
    cb.hud(text);
    if (c.name !== lastColor && throttle('color', 1500)) { lastColor = c.name; cb.narrate(text, { interrupt: true }); }
  }

  async function detectTick(g) {
    if (!det || !video.videoWidth) return;             // sin detector (cargando el respaldo): no hay nada que analizar
    syncOverlay();
    const W = overlay.width, H = overlay.height;
    const all = await Guard.withTimeout(det.detect(video, 20), firstDetect ? FIRST_DETECT_MS : DETECT_MS, 'Análisis de la imagen');
    firstDetect = false;
    if (g !== gen || !running) return;
    const preds = all.filter(p => (p.score >= (p.class === 'person' ? 0.5 : 0.55)) && (p.bbox[2] * p.bbox[3]) / (W * H) >= 0.015);
    draw(preds);

    if (mode === 'alerta') {
      const d = preds.map(p => ({ p, area: (p.bbox[2] * p.bbox[3]) / (W * H) }))
        .filter(({ p, area }) => (Scene.DANGER.has(p.class) && area > 0.15) || (p.class === 'person' && area > 0.3))
        .sort((a, b) => b.area - a.area)[0];
      if (!d) { cb.hud('Sin peligros cercanos.'); return; }
      const cx = d.p.bbox[0] + d.p.bbox[2] / 2;
      const txt = Scene.alertPhrase(d.p.class, d.area, camInfo && camInfo.mirrored ? W - cx : cx, W);
      cb.hud(txt);
      if (throttle('alert:' + d.p.class, 3000)) {
        cb.narrate(txt, { urgent: true }); Speech.buzz([300, 100, 300, 100, 300]); Speech.flash();
        cb.save('alerta', txt, Scene.name(d.p.class), d.p.score);
      }
      return;
    }

    const r = Scene.update(preds, video, W, H, { flipX: !!(camInfo && camInfo.mirrored) });
    cb.hud(r.hud);
    if (r.speak) {
      cb.narrate(r.speak, { urgent: !!r.urgent });
      if (r.urgent) { Speech.buzz([300, 100, 300]); Speech.flash(); }
      if (Date.now() - lastSaved > 15000) { lastSaved = Date.now(); cb.save('escena', r.speak, r.label || 'escena', 0.8); }
    }
  }

  function draw(preds) {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.lineWidth = 3; ctx.font = '600 20px system-ui'; ctx.strokeStyle = '#0a84ff'; ctx.fillStyle = '#0a84ff';
    const mirror = camEl.classList.contains('mirror');
    for (const p of preds) {
      const [x, y, w, h] = p.bbox;
      ctx.strokeRect(x, y, w, h);
      const label = `${Scene.name(p.class)} ${Math.round(p.score * 100)}%`;
      ctx.save();
      if (mirror) { ctx.translate(x * 2 + w, 0); ctx.scale(-1, 1); }   // contra-espejar el texto en cámara frontal
      ctx.fillText(label, x + 4, Math.max(20, y - 6));
      ctx.restore();
    }
  }

  function snapshot(maxW = 640) {
    if (!stream || !video.videoWidth) return null;
    const k = Math.min(1, maxW / video.videoWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c;
  }

  // ---- lectura de texto ----
  async function getTess() {
    clearTimeout(tessIdle);
    if (!tessWorker) {
      tessP = tessP || (async () => {
        await loadScript(LIB.tess);
        OCR.loadDict(LIB.words);                          // diccionario en paralelo
        // Android descomprime los .gz del APK y les quita la extensión: en la app se pide el idioma sin comprimir
        const native = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
        return Tesseract.createWorker('spa+eng', 1, {
          workerPath: LIB.worker, corePath: LIB.core, langPath: LIB.lang, gzip: !native,
          logger: m => { if (m.status && m.progress != null && readToken) cb.status(`Leyendo texto… ${Math.round(m.progress * 100)}%`); },
        });
      })();
      try { tessWorker = await tessP; } catch (e) { tessP = null; throw e; }
      curPsm = '';
    }
    return tessWorker;
  }
  function scheduleTessRelease() {
    clearTimeout(tessIdle);
    tessIdle = setTimeout(() => { releaseTess(); }, OCR_IDLE_MS);
  }
  function releaseTess() {
    const w = tessWorker;
    tessWorker = null; tessP = null; curPsm = '';
    if (w) { try { w.terminate(); } catch {} }
  }
  const nextFrame = () => new Promise(r => setTimeout(r, 0));

  // lee 1 a 3 pasadas y vota; devuelve el texto o '' si no hay nada creíble
  // foto para leer: la de más resolución que dé la cámara (ImageCapture) o, si no, el cuadro actual completo
  async function captureStill() {
    if (!stream || !video.videoWidth) throw new Error('La cámara aún no está lista, espera un momento.');
    lastStill = null;                                      // suelta la foto anterior antes de tomar otra
    const track = stream.getVideoTracks()[0];
    const portrait = video.videoHeight > video.videoWidth;
    let c = null;
    if (typeof ImageCapture !== 'undefined' && track) {
      try {
        const blob = await Guard.withTimeout(new ImageCapture(track).takePhoto(), 3000, 'Foto');
        const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        // solo si viene igual de orientada que el video y con más resolución
        if ((bmp.height > bmp.width) === portrait && bmp.width > video.videoWidth) {
          const k = Math.min(1, STILL_MAX / Math.max(bmp.width, bmp.height));
          c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
          c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        }
        if (bmp.close) bmp.close();
      } catch { /* sin foto: se usa el cuadro del video */ }
    }
    if (!c) {
      c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
    }
    lastStill = c;
    return c;
  }
  // copia chica (lado mayor ≤ 320 px) para medir luz y nitidez
  function smallData(src) {
    const k = Math.min(1, 320 / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, 0, 0, c.width, c.height);
    return g.getImageData(0, 0, c.width, c.height);
  }

  // foto de alta resolución → revisión de luz y nitidez → 1 a 3 pasadas → bloques en orden
  async function readText() {
    if (!stream) throw new Error('Inicia la cámara primero.');
    if (!video.videoWidth) throw new Error('La cámara aún no está lista, espera un momento.');
    const token = ++readToken;
    cb.status('Preparando imagen…');
    lastAdvice = '';
    try {
      const still = await captureStill();
      if (token !== readToken || !running) return '';
      const q = OCR.quality(smallData(still));
      if (q.dark) { lastLines = []; lastAdvice = q.advice; cb.hud(q.advice); return ''; }   // a oscuras no hay nada que leer

      const worker = await Guard.withTimeout(getTess(), READ_STEP_MS, 'Preparar el lector');
      if (token !== readToken || !running) return '';
      const psm = mode === 'medicina' ? '11' : '3';       // 11: texto disperso (cajas) · 3: bloques automáticos
      if (curPsm !== psm) { try { await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' }); curPsm = psm; } catch {} }
      const CROP = [0.04, 0.04, 0.92, 0.92];
      const passes = [];
      const pass = async (img, label) => {
        cb.status(label);
        const { data } = await Guard.withTimeout(worker.recognize(img), READ_STEP_MS, 'Leer el texto');
        let ls = OCR.linesWithConf(data);
        if (psm === '11') ls = OCR.orderLines(ls);
        passes.push(ls);
        return data;
      };
      const good = d => OCR.avgConf(d) >= 78 && OCR.plausible(OCR.clean(d));
      const d1 = await pass(OCR.preprocess(still, { maxSide: 1800, binarize: true, crop: CROP }), 'Leyendo texto…');
      if (token !== readToken || !running) return '';
      if (!good(d1)) {                                     // dudosa: otra pasada sin binarizar
        await nextFrame();
        const d2 = await pass(OCR.preprocess(still, { maxSide: 1800, binarize: false, crop: CROP }), 'Verificando la lectura (2/3)…');
        if (token !== readToken || !running) return '';
        if (!good(d2) && OCR.cleanLines(d1).join('|') !== OCR.cleanLines(d2).join('|')) {   // no coinciden: una foto nueva
          const still2 = await captureStill();
          await pass(OCR.preprocess(still2, { maxSide: 1800, binarize: true, crop: CROP }), 'Verificando la lectura (3/3)…');
        }
      }
      if (token !== readToken) return '';
      let lines = passes.length === 1 ? passes[0].map(l => ({ text: l.text, block: l.block })) : OCR.vote(passes, { keep: true });
      const fixed = OCR.correct(lines.map(l => l.text));
      lines = lines.map((l, i) => ({ text: fixed[i], block: l.block }));
      const text = OCR.toSpeech(lines), flat = text.replace(/\s+/g, ' ').trim();
      if (!OCR.plausible(flat)) {
        lastLines = [];
        lastAdvice = q.advice || 'No pude leer texto claro. Acerca la cámara, evita reflejos y mejora la luz.';
        cb.hud(lastAdvice);
        return '';
      }
      lastLines = lines.map(l => l.text);
      cb.hud(flat);
      return text;
    } catch (e) {
      noteError('Lectura: ' + (e.message || e));
      releaseTess();                                       // worker en mal estado: se recrea en la próxima lectura
      if (e.timeout) throw new Error('La lectura tardó demasiado. Vuelve a intentarlo; si se repite, usa Ajustes → Diagnóstico → Reintentar.');
      throw e;
    } finally {
      if (token === readToken) cb.status('');
      scheduleTessRelease();
    }
  }

  async function setMode(m) {
    if (m === mode) return;
    const prevText = TEXT_MODES.has(mode);
    mode = m;
    lastSpoken.clear(); lastColor = '';
    if (TEXT_MODES.has(m)) getTess().then(scheduleTessRelease, () => {});   // el lector queda listo mientras se apunta
    Scene.reset();
    cb.swatch(null);
    if (running) {
      // texto y medicina piden más resolución: reabre la cámara solo si hace falta
      if (prevText !== TEXT_MODES.has(m) && stream) {
        const t = stream.getVideoTracks()[0];
        try { await t.applyConstraints(wantRes(m)); syncOverlay(); } catch { /* el dispositivo decide */ }
      }
      await begin();
    }
  }

  // cambia de cámara; same: se abrió el mismo dispositivo (solo hay una)
  async function flip() {
    const prev = camInfo && camInfo.deviceId, prevFacing = facing;
    facing = facing === 'environment' ? 'user' : 'environment';
    if (!running) { Camera.save({ facing }); return { facing, same: false }; }
    try { await start({ ...cb }); }
    catch (e) {                                            // la otra cámara no abrió: se vuelve a la de antes
      facing = prevFacing;
      try { await start({ ...cb }); } catch { /* sin cámara */ }
      return { facing, same: false, failed: true, error: e };
    }
    const same = !!prev && !!camInfo && camInfo.deviceId === prev;
    if (same) { facing = prevFacing; Camera.save({ facing, deviceId: prev }); }
    return { facing, same };
  }

  // Ajustes → Reintentar: se olvida el detector (y el fallo del worker) y se vuelve a cargar
  async function resetAI() {
    if (det && det.terminate) { try { det.terminate(); } catch {} }
    det = null; modelP = null; workerBroken = false; detFails = 0; lastError = null;
    releaseTess();
    await ensureModel();
    if (running) await begin();
  }

  // el panel tapa la cámara: se detiene el análisis y se congela el video, sin cerrar la cámara
  function pause() {
    if (!running || paused) return;
    paused = true; gen++; clearTimeout(timer); timer = null; busy = false;
    try { video.pause(); } catch { /* sin video */ }
  }
  function resume() {
    if (!paused) return;
    paused = false;
    if (!running) return;
    video.play().catch(() => {});
    begin();
  }

  function diagnose() {
    return {
      model: !!det, loading: !!modelP && !det, ocr: !!tessWorker,
      backend: backendName,
      camera: !!stream, mode, ms: Math.round(infer), worker: !!(det && det.terminate), fails: detFails, lastError,
      camLabel: camInfo ? camInfo.label : '', facing, mirrored: !!(camInfo && camInfo.mirrored),
      res: stream && video && video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : '', openMs,
    };
  }

  return {
    start, stop: halt, flip, setMode, readText, captureStill, snapshot, diagnose, resetAI, preload, pause, resume, summary: () => Scene.summary(),
    get running() { return running; }, get paused() { return paused; }, get mode() { return mode; }, get facing() { return facing; }, get lastLines() { return lastLines; }, get lastAdvice() { return lastAdvice; }, get lastStill() { return lastStill; },
  };
})();
