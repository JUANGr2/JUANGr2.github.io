// Control por voz manos libres. Solo reacciona a órdenes cortas y claras para evitar falsos positivos.
const VoiceControl = (() => {
  let on = false, pendingSOS = 0;
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
  const waitFor = (fn, ms = 6000) => new Promise(ok => {
    const t0 = Date.now();
    (function poll() { if (fn()) return ok(true); if (Date.now() - t0 > ms) return ok(false); setTimeout(poll, 150); })();
  });

  async function openScan(m) {
    show('s-see');
    await setSeeMode(m);
    if (!Scanner.running) $('#btn-cam').click();
    return waitFor(() => Scanner.running);
  }

  // Cada orden: frases exactas (la enunciación completa, ≤4 palabras) → acción
  const COMMANDS = [
    { name: 'Detener', say: ['detener', 'detente', 'parar', 'alto', 'para', 'termina', 'detener escaneo', 'parar escaneo', 'apagar camara'],
      run: () => { if (Scanner.running) $('#btn-cam').click(); else Speech.stopSpeaking(); } },
    { name: 'Escanear', say: ['escanear', 'escanea', 'escanear escena', 'iniciar escaneo', 'empieza', 'empezar', 'describe', 'describe el entorno', 'que hay enfrente'],
      run: () => openScan('escena') },
    { name: 'Leer texto', say: ['leer texto', 'lee texto', 'lee esto', 'leer', 'lee'],
      run: async () => { if (await openScan('texto')) setTimeout(() => $('#btn-read').click(), 600); } },
    { name: 'Medicina', say: ['medicina', 'medicamento', 'leer medicina', 'escanear medicina', 'lee la caja'],
      run: async () => { await openScan('medicina'); } },
    { name: 'SOS', say: ['sos', 'emergencia', 'auxilio', 'socorro', 'pedir ayuda', 'necesito ayuda'],
      run: () => {
        show('s-sos');
        // confirmación hablada: se enciende solo si repite «sí» o «confirmo» en 6 s
        Speech.speak('Voy a preparar la alerta de emergencia. Di sí para confirmar.');
        pendingSOS = Date.now();
      } },
    { name: 'Ayuda', say: ['ayuda'], run: () => { show('s-sos'); Speech.speak('Para pedir auxilio di S O S, o toca el botón rojo.'); } },
    { name: 'Estoy perdido', say: ['estoy perdido', 'me perdi', 'perdido'], run: () => { show('s-id'); setTimeout(() => $('#id-lost').click(), 300); } },
    { name: 'Lupa', say: ['lupa', 'ampliar', 'amplia'], run: () => show('s-lupa') },
    { name: 'Calma', say: ['calma', 'respirar', 'respira', 'necesito calma'], run: () => show('s-calm') },
    { name: 'Cámara', say: ['inicio', 'casa', 'volver', 'camara'], run: () => show('s-see') },
    { name: 'Más funciones', say: ['menu', 'mas', 'herramientas', 'mas funciones'], run: () => toolsOnCamera('full') },
    { name: 'Dónde estoy', say: ['donde estoy', 'ubicacion', 'mi ubicacion'], run: () => { show('s-where'); setTimeout(() => $('#wh-go').click(), 300); } },
    { name: 'Comunicar', say: ['comunicar', 'hablar', 'tarjetas'], run: () => show('s-aac') },
  ];
  const INDEX = new Map();
  COMMANDS.forEach(c => c.say.forEach(p => INDEX.set(p, c)));

  function handle(text) {
    const t = norm(text);
    if (!t) return false;
    const words = t.split(' ');
    const chip = $('#vc-last');
    // confirmación de SOS
    if (pendingSOS && Date.now() - pendingSOS < 6000 && ['si', 'confirmo', 'si confirmo', 'confirmar'].includes(t)) {
      pendingSOS = 0;
      if (chip) chip.textContent = `«${t}» → SOS confirmado`;
      Speech.buzz([100]);
      $('#btn-sos').click();
      return true;
    }
    // coincidencia exacta; si la frase es corta, se acepta con una palabra de relleno («por favor», «ahora»)
    let cmd = INDEX.get(t);
    if (!cmd && words.length <= 4) {
      const stripped = words.filter(w => !['por', 'favor', 'ahora', 'la', 'el', 'una', 'un', 'camara', 'app', 'porfa'].includes(w)).join(' ');
      cmd = INDEX.get(stripped);
    }
    if (chip) chip.textContent = cmd ? `«${t}» → ${cmd.name}` : `«${t}»`;
    if (!cmd) return false;
    Speech.buzz([40]);
    Promise.resolve().then(cmd.run).catch(() => {});
    return true;
  }

  function start() {
    if (!Speech.supported) { toast('Tu dispositivo no permite reconocimiento de voz.'); return false; }
    const ok = Speech.listen(fin => { if (fin && fin.trim()) handle(fin); }, (s, d) => {
      if (s === 'error' && d === 'not-allowed') { toast('Permiso de micrófono denegado'); stop(); }
      if (s === 'error' && (d === 'sin-conexion' || d === 'network')) toast('El reconocimiento de voz necesita internet en este dispositivo.');
      if (s === 'stop' && on) { on = false; render(); }
    });
    on = !!ok;
    render();
    if (on) Speech.speak('Control por voz activado. Di escanear, detener, leer texto o medicina.');
    return on;
  }
  function stop() { on = false; pendingSOS = 0; Speech.stopListen(); render(); }
  function render() {
    const b = $('#vc-toggle');
    if (b) { b.setAttribute('aria-pressed', String(on)); b.classList.toggle('primary', on); const s = b.querySelector('span'); if (s) s.textContent = on ? 'Voz activa' : 'Control por voz'; }
    const c = $('#vc-last'); if (c) { c.hidden = !on; if (!on) c.textContent = ''; }
  }
  function init() { $('#vc-toggle').onclick = () => (on ? stop() : start()); }
  return { init, stop, get on() { return on; }, handle, _norm: norm };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = VoiceControl;
