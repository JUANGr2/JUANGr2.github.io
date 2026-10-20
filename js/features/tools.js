// Módulos: traducción, lector, comunicador (CAA), recordatorios, detector de sonidos, ubicación
const LANGS = { es: 'Español', en: 'English', fr: 'Français', pt: 'Português', de: 'Deutsch', it: 'Italiano', zh: '中文', ja: '日本語', ko: '한국어', ar: 'العربية', ru: 'Русский', hi: 'हिन्दी' };
const msgBox = (el, text, ok = false) => { el.innerHTML = text ? `<div class="msg ${ok ? 'ok' : 'err'}">${esc(text)}</div>` : ''; };

// ---------------- Traducción ----------------
// Frases frecuentes disponibles sin internet (es -> en)
const PHRASEBOOK = {
  'hola': 'Hello', 'gracias': 'Thank you', 'por favor': 'Please', 'sí': 'Yes', 'no': 'No', 'ayuda': 'Help',
  'quiero agua': 'I want water', 'tengo hambre': 'I am hungry', 'necesito ir al baño': 'I need to go to the bathroom',
  'necesito ayuda': 'I need help', 'me duele': 'It hurts', 'necesito un médico': 'I need a doctor',
  'no entiendo': 'I do not understand', 'más despacio, por favor': 'Slower, please', 'buenos días': 'Good morning',
  'buenas tardes': 'Good afternoon', 'buenas noches': 'Good night', 'dónde está el baño': 'Where is the bathroom',
  'cuánto cuesta': 'How much is it', 'adiós': 'Goodbye',
};
const Translate = (() => {
  let convOn = false;
  const fill = sel => { sel.innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join(''); };

  async function run(text) {
    const from = $('#tr-from').value, to = $('#tr-to').value;
    try {
      const r = await api('/translate', { method: 'POST', body: { text, from, to } });
      return r.text;
    } catch (e) {
      // sin internet: solo frases comunes es -> en
      const hit = from === 'es' && to === 'en' ? PHRASEBOOK[text.trim().toLowerCase().replace(/[¿?¡!.]+/g, '')] : null;
      if (hit) return hit;
      if (e.network) throw new Error('Sin internet: solo puedo traducir frases comunes del español al inglés (por ejemplo «necesito ayuda»).');
      throw e;
    }
  }
  async function doTranslate(speak = true) {
    const text = $('#tr-in').value.trim();
    if (!text) return;
    const out = $('#tr-out');
    out.textContent = '…';
    try {
      const t = await run(text);
      out.textContent = t;
      msgBox($('#tr-msg'), '');
      if (speak) Speech.speak(t, { lang: $('#tr-to').value });
      api('/scans', { method: 'POST', body: { type: 'traduccion', result: `${text} → ${t}`.slice(0, 900), label: `${$('#tr-from').value}→${$('#tr-to').value}` } }).catch(() => {});
    } catch (e) { out.textContent = '—'; msgBox($('#tr-msg'), e.message); }
  }

  function init() {
    fill($('#tr-from')); fill($('#tr-to'));
    $('#tr-from').value = 'es'; $('#tr-to').value = 'en';
    $('#tr-go').onclick = () => doTranslate(true);
    $('#tr-swap').onclick = () => {
      const f = $('#tr-from'), t = $('#tr-to'); [f.value, t.value] = [t.value, f.value];
      if ($('#tr-out').textContent !== '—') { $('#tr-in').value = $('#tr-out').textContent; $('#tr-out').textContent = '—'; }
    };
    $('#tr-say').onclick = () => { const t = $('#tr-out').textContent; if (t && t !== '—') Speech.speak(t, { lang: $('#tr-to').value }); };
    $('#tr-mic').onclick = () => {
      const b = $('#tr-mic');
      if (Speech.rec) { Speech.stopListen(); b.textContent = 'Dictar'; return; }
      if (!Speech.supported) return msgBox($('#tr-msg'), 'Tu navegador no soporta dictado. Usa Chrome en Android.');
      let acc = '';
      Speech.listen(async (fin, interim) => {
        if (convOn) {
          if (fin.trim()) { $('#tr-in').value = fin.trim(); await doTranslate(true); }
          return;
        }
        acc += fin; $('#tr-in').value = (acc + interim).trim();
      }, (s, d) => {
        if (s === 'start') b.textContent = 'Detener';
        if (s === 'stop') { b.textContent = 'Dictar'; if (!convOn && $('#tr-in').value.trim()) doTranslate(false); }
        if (s === 'error') msgBox($('#tr-msg'), d === 'not-allowed' ? 'Permiso de micrófono denegado' : 'Error de micrófono: ' + d);
      }, $('#tr-from').value);
    };
    $('#tr-conv').onchange = e => { convOn = e.target.checked; };
  }
  return { init, run };
})();

// ---------------- Lector ----------------
const Reader = (() => {
  let words = [], utter = 0;
  function render(text, hi = -1) {
    const out = $('#rd-out');
    out.innerHTML = words.map((w, i) => i === hi ? `<mark>${esc(w.t)}</mark>` : esc(w.t)).join('');
    if (hi >= 0) out.querySelector('mark')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function split(text) {
    const arr = []; const re = /\S+\s*/g; let m;
    while ((m = re.exec(text))) arr.push({ t: m[0], at: m.index });
    return arr;
  }
  function style() {
    const out = $('#rd-out');
    out.style.fontFamily = $('#rd-font').value || '';
    out.style.setProperty('--ls', ($('#rd-ls').value / 100) + 'em');
    out.style.setProperty('--lh', $('#rd-lh').value / 10);
    const [bg, fg] = ($('#rd-bg').value || '|').split('|');
    out.style.background = bg || ''; out.style.color = fg || '';
  }
  function wordAt(i) {
    let idx = -1;
    for (let k = 0; k < words.length; k++) { if (words[k].at <= i) idx = k; else break; }
    return idx;
  }
  function play() {
    const text = $('#rd-in').value.trim();
    if (!text) return;
    Speech.stopSpeaking();
    words = split(text);
    render(text);
    const mine = ++utter;
    Speech.speak(text, {
      interrupt: true,
      onchunk: c => { if (mine === utter) render(text, wordAt(c.at)); },        // resalta el inicio de cada trozo
      onword: i => { if (mine === utter) { const k = wordAt(i); if (k >= 0) render(text, k); } },  // y la palabra si el motor la informa
      onend: () => { if (mine === utter) render(text); },
    });
  }
  function setText(t) { $('#rd-in').value = t; words = split(t); render(t); }
  function init() {
    $('#rd-play').onclick = play;
    $('#rd-stop').onclick = () => { utter++; Speech.stopSpeaking(); render($('#rd-in').value); };
    ['rd-font', 'rd-ls', 'rd-lh', 'rd-bg'].forEach(id => $('#' + id).addEventListener('input', style));
    $('#rd-in').addEventListener('input', () => { words = split($('#rd-in').value); render(''); });
    style();
  }
  return { init, setText };
})();

// ---------------- Comunicador (CAA) ----------------
const AAC = (() => {
  const BASE = {
    'Necesito': [['💧', 'Quiero agua'], ['🍽', 'Tengo hambre'], ['🚻', 'Necesito ir al baño'], ['😴', 'Quiero descansar'], ['💊', 'Necesito mi medicina'], ['🩹', 'Me duele'], ['🌡', 'Tengo frío o calor']],
    'Siento': [['😀', 'Estoy feliz'], ['😢', 'Estoy triste'], ['😡', 'Estoy enojado'], ['😨', 'Tengo miedo'], ['😖', 'Estoy abrumado, necesito silencio'], ['🥰', 'Te quiero']],
    'Social': [['👋', 'Hola'], ['🙏', 'Gracias'], ['✅', 'Sí'], ['❌', 'No'], ['🤔', 'No entiendo, repite por favor'], ['⏳', 'Espera un momento'], ['🆘', 'Necesito ayuda']],
    'Lugares': [['🏠', 'Quiero ir a casa'], ['🏥', 'Quiero ir al médico'], ['🛒', 'Quiero ir a la tienda'], ['🚌', 'Necesito transporte'], ['🏫', 'Quiero ir a la escuela']],
  };
  let cat = 'Necesito', mine = [];
  const speak = (text, emoji) => {
    $('#aac-out').textContent = `${emoji} ${text}`;
    Speech.speak(text); Speech.buzz([40]);
  };
  function draw() {
    $('#aac-cats').innerHTML = [...Object.keys(BASE), 'Mis frases'].map(c => `<button data-c="${esc(c)}" aria-selected="${c === cat}">${esc(c)}</button>`).join('');
    const items = cat === 'Mis frases' ? mine.map(p => [p.emoji, p.text, p.id]) : BASE[cat].map(([e, t]) => [e, t]);
    $('#aac-grid').innerHTML = items.map(([e, t, id], i) => `<button data-i="${i}"><span class="e">${esc(e)}</span>${esc(t)}${id ? `<span class="btn sm danger" data-del="${id}" role="button" aria-label="Eliminar">✕</span>` : ''}</button>`).join('')
      || '<p class="mute">Aún no tienes frases propias.</p>';
    $$('#aac-cats button').forEach(b => b.onclick = () => { cat = b.dataset.c; draw(); });
    $$('#aac-grid button[data-i]').forEach(b => b.onclick = ev => {
      const del = ev.target.closest('[data-del]');
      if (del) { api('/phrases/' + del.dataset.del, { method: 'DELETE' }).then(load).catch(x => msgBox($('#ph-msg'), x.message)); return; }
      const it = items[+b.dataset.i]; speak(it[1], it[0]);
    });
  }
  async function load() { mine = await api('/phrases').catch(() => []); draw(); }
  function init() {
    $('#f-phrase').onsubmit = async e => {
      e.preventDefault();
      try {
        await api('/phrases', { method: 'POST', body: { emoji: $('#ph-emoji').value, text: $('#ph-text').value } });
        e.target.reset(); msgBox($('#ph-msg'), ''); cat = 'Mis frases'; load();
      } catch (x) { msgBox($('#ph-msg'), x.message); }
    };
    load();
  }
  return { init, load };
})();

// ---------------- Recordatorios ----------------
const Reminders = (() => {
  let list = [];
  const localDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const todayKey = () => 'va_fired_' + localDay(new Date());
  const fired = () => { try { return JSON.parse(localStorage.getItem(todayKey()) || '{}'); } catch { return {}; } };
  const markFired = id => { try { const f = fired(); f[id] = 1; localStorage.setItem(todayKey(), JSON.stringify(f)); } catch {} };

  function ring(r) {
    Speech.speak(`Recordatorio: ${r.title}`);
    Speech.buzz([400, 150, 400, 150, 400]); Speech.flash();
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification('VISUALAPP', { body: r.title, tag: 'rem' + r.id }); } catch {}
    const b = document.createElement('div');
    b.className = 'banner'; b.setAttribute('role', 'alertdialog');
    b.innerHTML = `<b style="font-size:1.2em">${esc(r.title)}</b><div class="row" style="margin-top:12px"><button class="btn primary" style="flex:1">Listo</button></div>`;
    b.querySelector('button').onclick = () => { b.classList.add('out'); setTimeout(() => b.remove(), 200); Speech.stopSpeaking(); };
    document.body.appendChild(b);
  }
  // suena si ya pasó la hora de hoy (hasta 10 min antes, para no perderlo si la pestaña estuvo dormida)
  function check() {
    const d = new Date();
    const nowMin = d.getHours() * 60 + d.getMinutes();
    const f = fired();
    list.filter(r => r.active && !f[r.id]).forEach(r => {
      const [h, m] = r.time.split(':').map(Number);
      const diff = nowMin - (h * 60 + m);
      if (diff >= 0 && diff <= 10) { markFired(r.id); ring(r); }
    });
  }
  function draw() {
    $('#rm-list').innerHTML = list.map(r => `<li><span><b>${esc(r.time)}</b> · ${esc(r.title)}</span>
      <span class="row"><button class="btn sm ${r.active ? '' : 'gray'}" data-t="${r.id}" data-a="${r.active ? 0 : 1}">${r.active ? 'Activo' : 'Pausado'}</button>
      <button class="btn sm danger" data-d="${r.id}" aria-label="Eliminar"><svg class="ic" aria-hidden="true"><use href="/icons/sprite.svg#i-x"/></svg></button></span></li>`).join('') || '<li class="empty"><span>Sin recordatorios.</span><button class="btn sm primary" data-focus="#rm-title">Crear el primero</button></li>';
    $$('[data-t]').forEach(b => b.onclick = async () => { try { await api('/reminders/' + b.dataset.t, { method: 'PATCH', body: { active: b.dataset.a === '1' } }); load(); } catch (x) { msgBox($('#rm-msg'), x.message); } });
    $$('[data-d]').forEach(b => b.onclick = async () => { try { await api('/reminders/' + b.dataset.d, { method: 'DELETE' }); load(); } catch (x) { msgBox($('#rm-msg'), x.message); } });
  }
  // En Android: alarmas reales diarias (suenan con la app cerrada)
  async function scheduleNative() {
    const LN = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ? (window.Capacitor.Plugins || {}).LocalNotifications : null;
    if (!LN) return;
    try {
      const perm = await LN.requestPermissions();
      if (perm.display !== 'granted') return;
      const pend = await LN.getPending();
      if (pend.notifications && pend.notifications.length) await LN.cancel({ notifications: pend.notifications.map(n => ({ id: n.id })) });
      const items = list.filter(r => r.active && /^\d+$/.test(String(r.id))).map(r => {
        const [h, m] = r.time.split(':').map(Number);
        return { id: Number(r.id), title: 'VISUALAPP', body: r.title, schedule: { on: { hour: h, minute: m }, allowWhileIdle: true } };
      });
      if (items.length) await LN.schedule({ notifications: items });
    } catch (e) { console.warn('notificaciones', e); }
  }
  async function load() { list = await api('/reminders').catch(() => []); draw(); scheduleNative(); }
  function init() {
    $('#f-remind').onsubmit = async e => {
      e.preventDefault();
      try {
        await api('/reminders', { method: 'POST', body: { title: $('#rm-title').value, time: $('#rm-time').value } });
        e.target.reset(); msgBox($('#rm-msg'), ''); load();
      } catch (x) { msgBox($('#rm-msg'), x.message); }
    };
    $('#rm-notif').onclick = async () => {
      if (!('Notification' in window)) return msgBox($('#rm-msg'), 'Tu navegador no soporta notificaciones');
      const p = await Notification.requestPermission();
      msgBox($('#rm-msg'), p === 'granted' ? 'Notificaciones activadas' : 'Permiso no concedido', p === 'granted');
    };
    load();
    setInterval(check, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }
  return { init, load };
})();

// ---------------- Detector de sonidos ----------------
const Sound = (() => {
  let ac, stream, an, raf, base = 0.01, lastAlert = 0, on = false, starting = false;
  function stop() {
    on = false; cancelAnimationFrame(raf);
    stream?.getTracks().forEach(t => t.stop()); stream = null;
    ac?.close().catch(() => {}); ac = null;
    $('#snd-bar').style.width = '0';
    $('#btn-snd').textContent = 'Activar';
  }
  async function start() {
    if (starting || on) return;
    starting = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) { starting = false; $('#snd-desc').textContent = 'No se pudo usar el micrófono: ' + (e.name === 'NotAllowedError' ? 'permiso denegado' : e.message); return; }
    starting = false;
    ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') { try { await ac.resume(); } catch {} }
    an = ac.createAnalyser(); an.fftSize = 1024;
    ac.createMediaStreamSource(stream).connect(an);
    const td = new Uint8Array(an.fftSize), fd = new Uint8Array(an.frequencyBinCount);
    on = true; base = 0.01;
    $('#btn-snd').textContent = 'Detener';
    const loop = () => {
      if (!on) return;
      an.getByteTimeDomainData(td);
      let s = 0; for (const v of td) { const x = (v - 128) / 128; s += x * x; }
      const rms = Math.sqrt(s / td.length);
      $('#snd-bar').style.width = Math.min(100, rms * 260) + '%';
      base = base * 0.98 + rms * 0.02;
      const sens = 11 - Number($('#snd-sens').value);          // 1..10 → factor
      const now = Date.now();
      const floor = 0.02 + sens * 0.006;                         // más sensible = umbral más bajo
      if (rms > floor && rms > base * (1.2 + sens * 0.35) && now - lastAlert > 2500) {
        lastAlert = now;
        an.getByteFrequencyData(fd);
        let mx = 0, mi = 0; fd.forEach((v, i) => { if (v > mx) { mx = v; mi = i; } });
        const hz = mi * ac.sampleRate / an.fftSize;
        const kind = hz < 250 ? 'grave (golpe, motor, trueno)' : hz < 1200 ? 'medio (voz, ladrido, puerta)' : hz < 3000 ? 'agudo (timbre, alarma, claxon)' : 'muy agudo (pitido, alarma)';
        Speech.buzz([500, 150, 500]); Speech.flash();
        const li = document.createElement('li');
        li.innerHTML = `<span><b>Sonido fuerte</b><br><small>${esc(kind)}</small></span><small>${new Date().toLocaleTimeString()}</small>`;
        $('#snd-log').prepend(li);
        while ($('#snd-log').children.length > 15) $('#snd-log').lastChild.remove();
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
  }
  function init() { $('#btn-snd').onclick = () => (on ? stop() : start()); }
  return { init, stop };
})();

// ---------------- ¿Dónde estoy? ----------------
const Where = {
  init() {
    const btn = $('#wh-go');
    btn.onclick = () => {
      const out = $('#wh-out');
      if (!navigator.geolocation) { out.textContent = 'Este dispositivo no permite ubicación.'; return; }
      btn.disabled = true;
      out.textContent = 'Buscando tu ubicación…';
      const done = () => { btn.disabled = false; };
      navigator.geolocation.getCurrentPosition(async pos => {
        const { latitude: la, longitude: lo, accuracy } = pos.coords;
        $('#wh-acc').textContent = `Precisión aproximada: ${Math.round(accuracy)} metros.`;
        let said;
        try {
          const r = await api(`/geo/reverse?lat=${la}&lon=${lo}`);
          out.textContent = r.address || `Latitud ${la.toFixed(5)}, longitud ${lo.toFixed(5)}`;
          said = r.address ? 'Estás cerca de: ' + r.address : 'Tu ubicación se obtuvo, pero no pude conocer la dirección.';
        } catch {
          out.textContent = `Latitud ${la.toFixed(5)}, longitud ${lo.toFixed(5)}`;
          said = 'Tu ubicación se obtuvo, pero necesito internet para decirte la dirección.';
        }
        Speech.speak(said);
        done();
      }, err => {
        const msg = err.code === 1 ? 'Permiso de ubicación denegado.' : err.code === 3 ? 'La ubicación tardó demasiado. Intenta en un lugar abierto.' : 'No se pudo obtener la ubicación.';
        out.textContent = msg; Speech.speak(msg); done();
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 });
    };
  },
};
