// Ajustes → Diagnóstico: estado de la cámara, de cada modelo, de la voz y el último error, en palabras.
// ok: true (bien), false (falla: dice qué hacer) o null (neutro). No toca el navegador al cargar: se prueba en Node.
const Diag = (() => {
  const hhmm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  function lines({ scanner: s = {}, voice = {}, screenReader = false, online = true, clip } = {}) {
    const rows = [];
    rows.push(s.camera
      ? { label: 'Cámara', value: `Activa: ${s.facing === 'user' ? 'frontal' : 'trasera'} (${s.camLabel || 'sin nombre'}), ${s.res}, abrió en ${s.openMs} ms`, ok: true }
      : { label: 'Cámara', value: 'Apagada', ok: null });
    rows.push(s.model
      ? { label: 'Detector de objetos', value: `Listo (${s.backend || 'motor desconocido'}, ${s.worker ? 'en segundo plano' : 'en la página'}), ${s.ms} ms por cuadro`, ok: true }
      : { label: 'Detector de objetos', value: s.loading ? 'Cargando…' : 'Sin cargar', ok: null });
    rows.push(s.ocr ? { label: 'Lectura de texto', value: 'Lista', ok: true } : { label: 'Lectura de texto', value: 'Se carga al leer', ok: null });
    rows.push(voice.engine !== 'none' && voice.ok === false ? { label: 'Voz', value: 'La voz no responde: instala o activa una voz en español en los ajustes del celular (texto a voz)', ok: false }
      : voice.engine === 'native' ? { label: 'Voz', value: `Voz del celular (${voice.lang})`, ok: true }
      : voice.engine === 'web' ? { label: 'Voz', value: `Voz del navegador (${voice.lang})`, ok: true }
      : { label: 'Voz', value: 'Sin voz: instala o activa una voz en español en el celular', ok: false });
    rows.push(screenReader ? { label: 'Lector de pantalla', value: 'Activo: la narración la lee tu lector', ok: true } : { label: 'Lector de pantalla', value: 'No detectado', ok: null });
    rows.push(online ? { label: 'Internet', value: 'Con conexión', ok: true } : { label: 'Internet', value: 'Sin conexión (todo lo esencial funciona igual)', ok: null });
    rows.push(s.lastError ? { label: 'Último error', value: `${s.lastError.msg} (${hhmm(s.lastError.at)})`, ok: false } : { label: 'Último error', value: 'Ninguno', ok: true });
    const c = clip && clip.state;
    rows.push(c === 'listo' ? { label: 'Reconocimiento del lugar', value: `Listo, ${clip.inferMs} ms por imagen`, ok: true }
      : c === 'cargando' ? { label: 'Reconocimiento del lugar', value: 'Cargando… (la primera vez se descarga)', ok: null }
      : c === 'lento' ? { label: 'Reconocimiento del lugar', value: 'Apagado en este teléfono (es lento): la app sigue describiendo con el detector de objetos', ok: null }
      : c === 'sin-soporte' ? { label: 'Reconocimiento del lugar', value: 'Este navegador no lo admite: la app sigue describiendo con el detector de objetos', ok: null }
      : c === 'falla' ? { label: 'Reconocimiento del lugar', value: 'No se pudo cargar (¿sin internet la primera vez?): la app sigue con el detector de objetos', ok: false }
      : { label: 'Reconocimiento del lugar', value: 'Se activa al abrir la cámara', ok: null });
    return rows;
  }
  const text = state => lines(state).map(r => `${r.label}: ${r.value}`).join('\n');

  return { lines, text };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Diag;
