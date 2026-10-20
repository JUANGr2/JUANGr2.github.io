// Motor de voz: en el APK, la voz del propio celular (plugin nativo), porque el WebView de Android
// no trae speechSynthesis; en la web, la del navegador. También decide por dónde va la narración
// cuando hay lector de pantalla. No toca el navegador al cargar: se prueba en Node.
const TTS = (() => {
  const SPANISH = ['es-mx', 'es-us', 'es-419', 'es-es'];
  const norm = s => String(s || '').replace(/_/g, '-');

  function pick({ isNative, hasPlugin, hasWeb }) {
    return isNative && hasPlugin ? 'native' : hasWeb ? 'web' : 'none';
  }

  // el idioma pedido si existe; si no, el más cercano (para español, primero los de América)
  function bestLang(supported, want) {
    const list = (supported || []).map(norm), lc = list.map(l => l.toLowerCase());
    const w = norm(want), wl = w.toLowerCase(), base = wl.split('-')[0];
    let i = lc.indexOf(wl);
    if (i < 0 && base === 'es') i = SPANISH.map(c => lc.indexOf(c)).find(j => j >= 0) ?? -1;
    if (i < 0) i = lc.findIndex(l => l.split('-')[0] === base);
    return i >= 0 ? list[i] : w;
  }

  // con lector de pantalla, la narración la lee el lector (región viva) y la app no habla encima
  function route({ screenReader, urgent = false } = {}) {
    return screenReader ? { speak: false, live: urgent ? 'assertive' : 'polite' } : { speak: true, live: null };
  }

  const isNative = () => typeof window !== 'undefined' && !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  return {
    pick, bestLang, route,
    get native() { return isNative(); },
    get plugin() { return isNative() ? ((window.Capacitor.Plugins || {}).TextToSpeech || null) : null; },
    screenReaderOn: false,
    // en el APK, sigue si TalkBack está activo; en la web no se puede saber y queda en false
    async watchScreenReader() {
      const P = isNative() ? (window.Capacitor.Plugins || {}).ScreenReader : null;
      if (!P) return;
      try { const r = await P.isEnabled(); this.screenReaderOn = !!(r && r.value); } catch { /* sin plugin */ }
      try { P.addListener('stateChange', s => { this.screenReaderOn = !!(s && s.value); }); } catch { /* sin plugin */ }
    },
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TTS;
