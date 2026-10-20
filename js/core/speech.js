// Voz: síntesis en cola con troceo (Android corta textos largos) y reconocimiento con reintentos acotados.
const LANG_TTS = { es: 'es-MX', en: 'en-US', fr: 'fr-FR', pt: 'pt-BR', de: 'de-DE', it: 'it-IT', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', ar: 'ar-SA', ru: 'ru-RU', hi: 'hi-IN' };

// Plugin nativo de dictado (el WebView de Android no trae webkitSpeechRecognition)
const NativeSR = {
  get plugin() { return window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ? (window.Capacitor.Plugins || {}).SpeechRecognition : null; },
};

const CHUNK_MAX = 170;

// parte un texto en trozos de frase (con su posición) de a lo sumo CHUNK_MAX caracteres
function splitSpeech(text) {
  const out = [];
  const src = String(text || '');
  const re = /[^.!?…;:\n]+[.!?…;:]*\s*/g;
  let m;
  while ((m = re.exec(src))) {
    let seg = m[0], at = m.index;
    while (seg.length > CHUNK_MAX) {
      let cut = seg.lastIndexOf(',', CHUNK_MAX);
      if (cut < 60) cut = seg.lastIndexOf(' ', CHUNK_MAX);
      if (cut < 30) cut = CHUNK_MAX;
      out.push({ text: seg.slice(0, cut + 1).trim(), at });
      seg = seg.slice(cut + 1); at += cut + 1;
    }
    if (seg.trim()) out.push({ text: seg.trim(), at });
  }
  return out;
}

const Speech = {
  rate: 1,
  vibrate: true,
  noFlash: false,
  _q: [], _cur: null, _gen: 0, _voices: [], _engine: null, _nativeFails: 0, _langsP: null, _langs: null,

  // 'native' (voz del celular, en el APK), 'web' (voz del navegador) o 'none'
  get engine() {
    if (!this._engine) this._engine = TTS.pick({ isNative: TTS.native, hasPlugin: !!TTS.plugin, hasWeb: 'speechSynthesis' in window });
    return this._engine;
  },
  // idioma real de la voz en español
  get lang() {
    if (this.engine === 'native') return TTS.bestLang(this._langs || [], 'es-MX');
    if (this.engine === 'web') { const v = this._pickVoice('es'); return v ? v.lang : 'es-MX'; }
    return '';
  },
  // ¿se oye la voz? false sin motor, si la voz nativa falló dos veces seguidas o si el celular no tiene voz en español
  get ok() {
    if (this.engine === 'none') return false;
    if (this.engine !== 'native') return true;
    const noSpanish = Array.isArray(this._langs) && this._langs.length > 0 && !this._langs.some(l => /^es/i.test(String(l)));
    return this._nativeFails < 2 && !noSpanish;
  },
  onfail: null,                                        // la interfaz avisa (una vez) cuando la voz deja de oírse
  // la cola propia manda: speechSynthesis.speaking puede quedarse en true en Android y dejar la narración muda
  get busy() { return !!this._cur || this._q.length > 0; },

  _pickVoice(lang) {
    const want = (LANG_TTS[lang] || lang).toLowerCase();
    const base = want.split('-')[0];
    const vs = this._voices.length ? this._voices : (this._voices = speechSynthesis.getVoices());
    return vs.find(v => v.lang.toLowerCase() === want) || vs.find(v => v.lang.toLowerCase().replace('_', '-').startsWith(base)) || null;
  },
  _nativeLangs() {
    return (this._langsP = this._langsP || Promise.resolve().then(() => TTS.plugin.getSupportedLanguages())
      .then(r => (this._langs = (r && r.languages) || []), () => (this._langs = []))
      .then(l => { if (!l.length) this._langsP = null; return l; }));   // lista vacía: se vuelve a pedir
  },

  // interrupt=true corta lo que se diga y empieza de nuevo; false lo encola.
  // onend: al terminar todo. onchunk(trozo): al empezar cada trozo. onword(indiceGlobal): si el motor emite límites.
  speak(text, { interrupt = true, lang = 'es', onend, onchunk, onword } = {}) {
    if (this.engine === 'none' || !text) { if (onend) onend(); return; }
    if (interrupt) this.stopSpeaking();
    const chunks = splitSpeech(text);
    if (!chunks.length) { if (onend) onend(); return; }
    const gen = this._gen;
    chunks.forEach((c, i) => this._q.push({ ...c, lang, last: i === chunks.length - 1, onend, onchunk, onword, gen }));
    if (!this._cur) setTimeout(() => this._pump(), interrupt ? 60 : 0);   // pequeña pausa tras cancel(): evita fallos en Android
  },

  _pump() {
    if (this._cur || !this._q.length) return;
    const it = this._q.shift();
    if (it.gen !== this._gen) return this._pump();
    const native = this.engine === 'native';
    let done = false, guard = 0;
    const next = ok => {
      if (done) return; done = true;
      clearTimeout(guard);
      if (this._cur === it) this._cur = null;
      // la voz nativa que falla dos veces seguidas se cambia por la del navegador, si existe
      if (native) {
        if (ok === false && ++this._nativeFails >= 2 && 'speechSynthesis' in window) this._engine = 'web';
        else if (ok !== false) this._nativeFails = 0;
        if (!this.ok && !this._failTold) { this._failTold = true; if (this.onfail) { try { this.onfail(); } catch {} } }
      }
      if (it.gen === this._gen) {
        if (it.last && it.onend) { try { it.onend(); } catch {} }
        this._pump();
      }
    };
    // seguro: si el motor nunca termina, continuar
    guard = setTimeout(() => next(true), Math.max(4000, it.text.length * 140 / this.rate));
    this._cur = it;
    if (it.onchunk) { try { it.onchunk(it); } catch {} }
    if (native) {
      this._nativeLangs()
        .then(langs => TTS.plugin.speak({ text: it.text, lang: TTS.bestLang(langs, LANG_TTS[it.lang] || it.lang), rate: Math.min(2, Math.max(0.5, this.rate)), pitch: 1, volume: 1, category: 'playback', queueStrategy: 0 }))
        .then(() => next(true), () => next(false));
      return;
    }
    const u = new SpeechSynthesisUtterance(it.text);
    u.lang = LANG_TTS[it.lang] || it.lang;
    const v = this._pickVoice(it.lang);
    if (v) u.voice = v;
    u.rate = this.rate;
    u.onend = () => next(true);
    u.onerror = () => next(true);
    if (it.onword) u.onboundary = e => { if (!e.name || e.name === 'word') it.onword(it.at + e.charIndex); };
    try { speechSynthesis.speak(u); } catch { next(true); }
  },

  stopSpeaking() {
    this._gen++;
    this._q = [];
    this._cur = null;
    if (this.engine === 'native') Promise.resolve().then(() => TTS.plugin.stop()).catch(() => {});
    else if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch {} }
  },

  buzz(pattern = [200, 100, 200]) { if (this.vibrate && navigator.vibrate) navigator.vibrate(pattern); },
  flash() {
    if (!this.vibrate || this.noFlash) return;
    const f = document.getElementById('flash');
    if (!f) return;
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  },

  get supported() { return !!NativeSR.plugin || 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window; },
  rec: null,
  _want: false,

  // reconocimiento continuo; onState('start'|'stop'|'error', detalle)
  listen(onText, onState, lang = 'es') {
    if (NativeSR.plugin) return this._listenNative(onText, onState, lang);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;
    this.stopListen();
    const r = new SR();
    r.lang = LANG_TTS[lang] || lang;
    r.continuous = true;
    r.interimResults = true;
    let fatal = false, fails = 0, gotResult = false;
    r.onresult = e => {
      gotResult = true; fails = 0;
      let fin = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      onText(fin, interim);
    };
    r.onerror = e => {
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) fatal = true;
      if (e.error === 'network') fails += 2;
      if (e.error !== 'no-speech' && e.error !== 'aborted') onState('error', e.error);
    };
    r.onend = () => {
      if (this.rec === r && this._want && !fatal) {
        if (!gotResult) fails++;
        gotResult = false;
        if (fails <= 6) {
          // retroceso exponencial (300 ms … 4 s) para no entrar en bucle
          setTimeout(() => { if (this.rec === r && this._want) { try { r.start(); } catch {} } }, Math.min(4000, 300 * 2 ** Math.max(0, fails - 1)));
          return;
        }
        onState('error', 'sin-conexion');
      }
      if (this.rec === r) { this.rec = null; this._want = false; }
      onState('stop');
    };
    this._want = true;
    this.rec = r;
    try { r.start(); } catch { this.rec = null; this._want = false; return false; }
    onState('start');
    return true;
  },

  // dictado con el motor de Android (Capacitor)
  _listenNative(onText, onState, lang) {
    const P = NativeSR.plugin;
    const code = LANG_TTS[lang] || lang;
    let last = '', empties = 0, permitted = false;
    this._want = true;
    this.rec = { native: true };
    const stopAll = () => { this._want = false; this.rec = null; };
    const begin = async () => {
      try {
        if (!permitted) {
          const perm = await P.requestPermissions();
          if (perm && perm.speechRecognition && perm.speechRecognition !== 'granted') { onState('error', 'not-allowed'); stopAll(); onState('stop'); return; }
          permitted = true;
        }
        await P.start({ language: code, partialResults: true, popup: false, maxResults: 1 });
      } catch (e) { onState('error', String((e && e.message) || e)); stopAll(); onState('stop'); }
    };
    this._nativeHandles = [];
    P.addListener('partialResults', d => { last = (d.matches && d.matches[0]) || ''; onText('', last); }).then(h => this._nativeHandles.push(h));
    P.addListener('listeningState', d => {
      if (d.status !== 'stopped') return;
      if (last) { onText(last + ' ', ''); last = ''; empties = 0; } else empties++;
      if (this._want && empties < 8) setTimeout(begin, Math.min(2000, 250 * empties + 250));
      else { if (this._want) onState('error', 'sin-voz'); stopAll(); onState('stop'); }
    }).then(h => this._nativeHandles.push(h));
    onState('start');
    begin();
    return true;
  },

  stopListen() {
    if (this.rec && this.rec.native) {
      this._want = false;
      const P = NativeSR.plugin;
      this.rec = null;
      try { P.stop(); } catch {}
      (this._nativeHandles || []).forEach(h => { try { h.remove(); } catch {} });
      this._nativeHandles = [];
      return;
    }
    this._want = false;
    const r = this.rec;
    this.rec = null;
    try { r && r.stop(); } catch {}
  },
};

if ('speechSynthesis' in window) {
  const refresh = () => { try { Speech._voices = speechSynthesis.getVoices(); } catch {} };
  refresh();
  speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', refresh);
}
if (typeof module !== 'undefined' && module.exports) module.exports = { splitSpeech };
