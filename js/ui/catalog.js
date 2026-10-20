// Catálogo de funciones de la app: lo que muestran el panel de herramientas y «Todas las funciones».
// No toca el navegador al cargar: se prueba en Node.
const Catalog = (() => {
  const L = (id, t, d, ic, go, simple, k) => ({ id, t, d, ic, go, simple, k });
  const LIST = [
    L('escanear', 'Escanear', 'Describe lo que tienes delante.', 'i-eye', { screen: 's-see', mode: 'escena', scan: true }, true, 'camara describir escena'),
    L('leer', 'Leer', 'Lee carteles, cartas y pantallas.', 'i-text', { screen: 's-see', mode: 'texto', scan: true }, true, 'texto cartel letras'),
    L('medicina', 'Medicina', 'Tu botiquín y leer cajas.', 'i-pill', { screen: 's-med' }, true, 'botiquin pastilla caja caducidad'),
    L('lupa', 'Lupa', 'Zoom, contraste y realce de colores.', 'i-lupa', { screen: 's-lupa' }, false, 'zoom ampliar'),
    L('oir', 'Oír', 'Voz a texto, alertas de sonido y amplificador.', 'i-ear', { screen: 's-voice' }, true, 'escuchar sordera subtitulos'),
    L('hablar', 'Hablar', 'Frases y pictogramas que hablan por ti.', 'i-chat', { screen: 's-aac' }, true, 'hablar frases pictogramas'),
    L('comunicar', 'Comunicar', 'Pictogramas y frases que hablan por ti.', 'i-chat', { screen: 's-aac' }, true, 'hablar frases pictogramas'),
    L('traducir', 'Traducir', 'Texto, voz y cámara en 12 idiomas.', 'i-globe', { screen: 's-translate' }, false, 'idioma ingles'),
    L('lector', 'Lector', 'Texto fácil de leer, con voz y resaltado.', 'i-text', { screen: 's-reader' }, false, 'leer voz resaltado'),
    L('personas', 'Personas', 'Quién es quién: familia y cuidadores.', 'i-people', { screen: 's-people' }, false, 'familia contactos cuidadores'),
    L('quiensoy', '¿Quién soy?', 'Tu ficha y el botón «Estoy perdido».', 'i-id', { screen: 's-id' }, false, 'ficha perdido'),
    L('rutinas', 'Rutinas', 'Recordatorios de medicina y tareas.', 'i-clock', { screen: 's-remind' }, false, 'recordatorios alarmas'),
    L('donde', '¿Dónde estoy?', 'Te dice tu dirección actual.', 'i-pin', { screen: 's-where' }, false, 'ubicacion direccion'),
    L('crisis', 'Crisis', 'Cronómetro, guía y pedir ayuda.', 'i-bolt', { screen: 's-crisis' }, false, 'epilepsia convulsion'),
    L('calma', 'Calma', 'Respiración guiada y tarjeta de silencio.', 'i-calm', { screen: 's-calm' }, false, 'respirar ansiedad'),
    L('sos', 'SOS', 'Pide ayuda con tu ubicación.', 'i-sos', { screen: 's-sos' }, true, 'ayuda emergencia'),
    L('historial', 'Historial', 'Lo que has escaneado y traducido.', 'i-list', { screen: 's-hist' }, false, 'registros'),
    L('ajustes', 'Ajustes', 'Voz, narración, pantalla, accesibilidad y datos.', 'i-gear', { screen: 's-set' }, true, 'configuracion voz letra tema'),
  ];
  const BY = Object.fromEntries(LIST.map(x => [x.id, x]));
  const PANEL_MAIN = ['leer', 'medicina', 'oir', 'hablar', 'lupa', 'traducir'];
  const PANEL_MORE = ['personas', 'quiensoy', 'rutinas'];
  const GROUPS = [
    { t: 'Ver', ids: ['escanear', 'leer', 'medicina', 'lupa'] },
    { t: 'Oír y comunicar', ids: ['oir', 'comunicar', 'traducir', 'lector'] },
    { t: 'Recordar y ayuda', ids: ['personas', 'quiensoy', 'rutinas', 'donde', 'crisis', 'calma', 'sos'] },
    { t: 'Tu cuenta', ids: ['historial', 'ajustes'] },
  ];

  // sin acentos ni mayúsculas: «oir» encuentra «Oír»
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const item = id => BY[id];

  // grupos con las funciones que coinciden (todas las palabras, en título, descripción o palabras clave)
  function search(q = '', { simple = false } = {}) {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return GROUPS.map(g => ({
      t: g.t,
      items: g.ids.map(item).filter(it => (!simple || it.simple) && words.every(w => fold(`${it.t} ${it.d} ${it.k}`).includes(w))),
    })).filter(g => g.items.length);
  }

  return { item, search, PANEL_MAIN, PANEL_MORE, GROUPS };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Catalog;
