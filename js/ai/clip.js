// Clip: la IA que reconoce el lugar (MobileCLIP-S0) en su propio worker, para no trabar la cámara ni la voz.
// Se carga al abrir la cámara (no antes), analiza a un ritmo que se adapta al teléfono y, si el teléfono no puede
// (carga de más de 60 s, tres análisis de más de 4 s o error), se apaga hasta cerrar la app: plan B, sigue COCO-SSD.
// Las decisiones de qué decir las toma Look. Reloj, temporizadores y worker inyectables: se prueba en Node.
const Clip = (() => {
  const LOAD_MAX_MS = 60000, SLOW_MS = 4000, SLOW_RUNS = 3, MIN_GAP_MS = 1000;
  const L = typeof Look !== 'undefined' ? Look : (typeof require === 'function' ? require('./look.js') : null);
  let state = 'apagado', stats = { loadMs: 0, inferMs: 0 };
  let worker = null, labels = null, o = null, timer = 0, loadTimer = 0, gen = 0, slow = 0, busy = false, active = false, t0 = 0;

  const defaults = () => ({
    now: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: id => clearTimeout(id),
    makeWorker: () => new Worker('/js/ai/clip.worker.js', { type: 'module' }),
    labels: null,
  });

  function off(next) {                                  // apagado definitivo en esta sesión
    state = next; active = false;
    if (o) { o.clearTimer(timer); o.clearTimer(loadTimer); }
    if (worker) { try { worker.terminate(); } catch { /* ya cerrado */ } }
    worker = null;
  }
  const final = () => state === 'lento' || state === 'falla' || state === 'sin-soporte';

  function schedule(ms) { o.clearTimer(timer); timer = o.setTimer(tick, ms); }
  async function tick() {
    if (!active || state !== 'listo' || busy) return;
    let bitmap = null;
    try { bitmap = await o.grab(); } catch { bitmap = null; }
    if (!active || state !== 'listo') return;
    if (!bitmap) return schedule(MIN_GAP_MS);
    busy = true; t0 = o.now();
    worker.postMessage({ type: 'embed', bitmap, gen }, bitmap && bitmap.close ? [bitmap] : undefined);
  }

  function onMessage(e) {
    const m = e.data || {};
    if (m.type === 'ready') {
      o.clearTimer(loadTimer);
      state = 'listo'; stats.loadMs = Math.round(o.now() - t0);
      if (active) schedule(MIN_GAP_MS);
    } else if (m.type === 'unsupported') {
      off('sin-soporte');
    } else if (m.type === 'error') {
      busy = false;
      off('falla');
    } else if (m.type === 'vec') {
      busy = false;
      const ms = o.now() - t0;
      stats.inferMs = Math.round(ms);
      slow = ms > SLOW_MS ? slow + 1 : 0;
      if (slow >= SLOW_RUNS) return off('lento');
      if (m.gen === gen && active && labels) {
        const vec = Array.from(m.vec);
        const r = L.classify(vec, labels);
        o.onResult({ main: r.main, score: r.score, ranked: r.ranked, place: L.place(vec, labels), at: Date.now() });
      }
      if (active) schedule(Math.max(MIN_GAP_MS, 1.5 * ms));
    }
  }

  // empieza a analizar (carga el modelo la primera vez). opts: { grab: async () => ImageBitmap|null, onResult, …inyectables }
  function start(opts) {
    o = { ...defaults(), ...opts };
    if (final()) return;
    active = true;
    if (o.labels) labels = o.labels;
    if (worker) { if (state === 'listo') schedule(MIN_GAP_MS); return; }
    try { worker = o.makeWorker(); } catch { return off('sin-soporte'); }
    worker.onmessage = onMessage;
    worker.onerror = () => off('falla');
    state = 'cargando'; t0 = o.now();
    loadTimer = o.setTimer(() => { if (state === 'cargando') off('lento'); }, LOAD_MAX_MS);
    if (!labels && typeof fetch === 'function') fetch('/vendor/clip/labels.json').then(r => r.json()).then(j => { labels = j.labels; }).catch(() => off('falla'));
    worker.postMessage({ type: 'load' });
  }
  // deja de analizar (al detener la cámara); el modelo queda cargado para la próxima vez
  function stop() { active = false; if (o) o.clearTimer(timer); gen++; }
  // cambió el modo o la cámara: lo que esté en camino ya no sirve
  function bump() { gen++; }
  // solo para pruebas: vuelve al estado inicial
  function reset() { off('apagado'); labels = null; stats = { loadMs: 0, inferMs: 0 }; slow = 0; busy = false; gen = 0; }

  return { start, stop, bump, reset, get state() { return state; }, get stats() { return stats; } };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Clip;
