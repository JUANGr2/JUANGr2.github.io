let prefs = { voice_rate: 1, contrast: 0, font_size: 18, vibration: 1 };
let user = null, contacts = [], cloudVision = false;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- avisos breves ----------
let toastTimer = 0;
function toast(msg, ms = 2800) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// insignias de las funciones en el panel (las pone el botiquín al cargar)
const badges = {};
function setBadge(id, text) { badges[id] = text; paintBadges(); }

// ---------- panel de herramientas (sobre la cámara) ----------
const fnTile = it => `<button class="tile" data-fn="${it.id}" data-screen="${it.go.screen}"><svg class="ic" aria-hidden="true"><use href="/icons/sprite.svg#${it.ic}"/></svg><span class="tt">${esc(it.t)}</span><span class="bd" hidden></span></button>`;
const fnRow = it => `<button class="frow" data-fn="${it.id}" data-screen="${it.go.screen}"><svg class="ic" aria-hidden="true"><use href="/icons/sprite.svg#${it.ic}"/></svg><span class="ft"><b>${esc(it.t)}</b><small>${esc(it.d)}</small></span><span class="bd" hidden></span></button>`;
function renderPanel() {
  const simple = document.body.classList.contains('simple');
  const pick = ids => ids.map(Catalog.item).filter(it => !simple || it.simple);
  $('#panel-main').innerHTML = pick(Catalog.PANEL_MAIN).map(fnTile).join('');
  const more = pick(Catalog.PANEL_MORE);
  $('#panel-more-tiles').innerHTML = more.map(fnTile).join('');
  $('#panel-sub').hidden = !more.length;
  renderFnList();
}
function renderFnList() {
  const groups = Catalog.search($('#fn-search').value, { simple: document.body.classList.contains('simple') });
  $('#fn-list').innerHTML = groups.length
    ? groups.map(g => `<section class="fgroup"><h3 class="panel-sub">${esc(g.t)}</h3>${g.items.map(fnRow).join('')}</section>`).join('')
    : '<p class="mute">No encontré esa función.</p>';
  paintBadges();
}
function paintBadges() {
  for (const [id, t] of Object.entries(badges)) $$(`#panel [data-screen="${id}"] .bd`).forEach(el => { el.textContent = t || ''; el.hidden = !t; });
}
// abre una función del catálogo: su pantalla, o la cámara en su modo
async function goFn(id) {
  const it = Catalog.item(id);
  if (!it) return;
  if (it.go.screen !== 's-see') return show(it.go.screen);   // show cierra el panel y la función ocupa su entrada del historial
  panel.close({ focus: false });                              // se queda en la cámara: el panel deja el historial
  await pickMode($(`#see-modes [data-mode="${it.go.mode}"]`));  // dice «Modo …» y vibra
  $('#btn-cam').focus();                                      // el foco no se pierde al ocultarse el panel
  if (it.go.scan && !Scanner.running) $('#btn-cam').click();
}
// Más funciones desde cualquier pantalla (voz): si hay que deshacer el historial, el panel se abre al terminar,
// porque history.go() es asíncrono y le ganaría a la entrada del panel
function toolsOnCamera(pos = 'full') {
  if (current === 's-see') return panel.open(pos);
  const unwinding = Nav.go(history.state, 's-see').op === 'unwind';
  show('s-see');
  if (unwinding) addEventListener('popstate', () => panel.open(pos), { once: true });
  else panel.open(pos);
}
// el panel abierto es una entrada del historial (Atrás lo cierra); «quietly» lo mueve sin tocar el historial:
// cuando ya lo hizo Atrás, o cuando una función ocupa la entrada del panel
let quietPanel = false;
const quietly = fn => { quietPanel = true; try { fn(); } finally { quietPanel = false; } };
const panel = Panel.mount({
  root: $('#panel'), tab: $('#panel-tab'),
  onChange: (pos, prev, docked) => {
    const open = pos !== 'closed', covers = open && !docked;   // acoplado (PC) queda al lado: no tapa ni pausa la cámara
    $('#cam').classList.toggle('paused', covers);               // la cámara queda detrás, desenfocada y en pausa
    if (covers) { Scanner.pause(); if (prev === 'closed') Speech.buzz([15]); }
    else Scanner.resume();
    if (Scanner.running) keepAwake(!covers);                    // tapada, la cámara no necesita la pantalla encendida
    if (pos !== 'full' && $('#fn-search').value) { $('#fn-search').value = ''; renderFnList(); }   // al volver, la lista completa
    if (quietPanel || docked) return;
    if (open && prev === 'closed') { try { history.pushState(Nav.panel(history.state), '', here()); } catch {} }
    else if (!open && history.state && history.state.panel) history.back();
  },
});
$('#panel').addEventListener('click', e => { const b = e.target.closest('[data-fn]'); if (b) goFn(b.dataset.fn); });
// si el panel guarda un aviso (medicinas vencidas, preparar la app, descarga de la IA), la pestaña lo muestra
function paintNotes() {
  const any = [...$('#panel-notes').children].some(el => !el.hidden);
  $('#panel-tab').classList.toggle('note', any);
  $('#panel-tab-sr').textContent = any ? ', hay avisos' : '';
}
new MutationObserver(paintNotes).observe($('#panel-notes'), { subtree: true, attributes: true, attributeFilter: ['hidden'] });
paintNotes();
$('#panel-more').onclick = () => panel.open('full');
$('#panel-back').onclick = () => panel.open('half');
$('#fn-search').addEventListener('input', renderFnList);
renderPanel();

const HINT = 'Pulsa el ojo, abajo en el centro, para empezar a describir lo que tienes delante.';
function cleanup(leaving) {
  if (leaving === 's-see') { Scanner.stop(); Meds.stopBarcode(); setScan(false); $('#hud').textContent = HINT; }
  if (leaving === 's-voice') { Speech.stopListen(); Sound.stop(); Amp.stop(); $('#btn-listen').textContent = 'Escuchar'; $('#amp-go').textContent = 'Activar amplificador'; }
  if (leaving === 's-translate') { Speech.stopListen(); $('#tr-mic').textContent = 'Dictar'; }
  if (leaving === 's-reader') Speech.stopSpeaking();
  if (leaving === 's-lupa') { Lupa.stop(); $('#lupa-go').textContent = 'Abrir lupa'; }
  if (leaving === 's-calm') Calm.stop();
}
// la cámara es la pantalla principal; cada función se abre encima y el historial (Nav) maneja el botón Atrás.
// Las entradas no llevan #: al volver a una dirección con #, el navegador quita el foco (lo manda al cuerpo de la página).
let current = 's-see';
const isScreen = id => { const el = document.getElementById(id); return !!el && el.classList.contains('screen'); };
const here = () => location.pathname + location.search;
// focus: el foco va al título de la pantalla nueva (TalkBack la anuncia); no al cargar la app
function show(id, { push = true, focus = true } = {}) {
  if (!isScreen(id)) return;
  if (id === current) { if (id !== 's-see') scrollTo({ top: 0 }); else if (push && panel.pos !== 'closed') panel.close(); return; }
  if (push) {
    const step = Nav.go(history.state, id);
    try {
      if (step.op === 'push') history.pushState(step.state, '', here());
      else if (step.op === 'replace') history.replaceState(step.state, '', here());
      else if (step.op === 'unwind') history.go(-step.steps);
    } catch { /* sin historial: igual cambia de pantalla */ }
  }
  if (panel.pos !== 'closed') quietly(() => panel.close({ focus: false }));
  cleanup(current);
  current = id;
  document.body.dataset.screen = id;
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  const h = document.querySelector(`#${id} .large-title`);
  $('#top-title').textContent = h ? h.textContent : '';
  watchTitle(h);
  scrollTo({ top: 0 });
  if (focus) { const t = id === 's-see' ? $('#see-h') : h; if (t) { t.tabIndex = -1; t.focus({ preventScroll: true }); } }
  if (id === 's-see') enterCamera();
  if (id === 's-hist') loadHistory(true);
  if (id === 's-sos') loadContacts();
  if (id === 's-people') People.load();
  if (id === 's-id') MedicalID.load();
  if (id === 's-crisis') Crisis.list();
  if (id === 's-med') Meds.load();
  if (id === 's-set') renderDiag();
}
// el título chico de la barra aparece cuando el grande sale de la vista
const titleObs = 'IntersectionObserver' in window
  ? new IntersectionObserver(([e]) => document.body.classList.toggle('title-up', !e.isIntersecting), { rootMargin: '-72px 0px 0px 0px' }) : null;
function watchTitle(h) {
  document.body.classList.remove('title-up');
  if (!titleObs) return;
  titleObs.disconnect();
  if (h) titleObs.observe(h);
}
$$('[data-back]').forEach(b => b.onclick = () => show('s-see'));
addEventListener('popstate', e => {
  const st = e.state && typeof e.state === 'object' ? e.state : {};
  if (!st.panel && panel.pos !== 'closed') quietly(() => panel.close());
  show(st.screen || (isScreen(location.hash.slice(1)) ? location.hash.slice(1) : 's-see'), { push: false });
  if (st.panel && panel.pos === 'closed' && current === 's-see') quietly(() => panel.open('half'));
});
// al cargar: la cámara es la base del historial; con #s-xxx en la dirección, esa función se abre encima
function startNav() {
  const st = history.state;
  if (st && typeof st === 'object' && isScreen(st.screen)) {     // recarga: se respeta el historial que ya había
    show(st.screen, { push: false, focus: false });
    if (current === 's-see') { if (st.panel) quietly(() => panel.open('half', { focus: false })); enterCamera(); }
    return;
  }
  const hash = location.hash.slice(1);
  try { history.replaceState({ screen: 's-see', depth: 0 }, '', here()); } catch {}
  if (hash !== 's-see' && isScreen(hash)) show(hash, { focus: false }); else enterCamera();
}
// botón Atrás de Android (@capacitor/app): deshace el historial; en la cámara, la app pasa al fondo
(function nativeBack() {
  const App = window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && (Capacitor.Plugins || {}).App;
  if (!App) return;
  App.addListener('backButton', () => {
    if (!$('#quiet').hidden) { $('#quiet').click(); return; }          // primero se cierra la tarjeta de silencio
    const what = Nav.back({ state: history.state, screen: current, panelOpen: panel.docked ? panel.pos === 'full' : panel.pos !== 'closed' });
    if (what === 'history') history.back();
    else if (what === 'panel') panel.close();
    else if (what === 'home') show('s-see');
    else App.minimizeApp();
  });
})();
$('#logout').onclick = async () => { cleanup(current); VoiceControl.stop(); await api('/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/'; };

// ---------- inicio ----------
(async function init() {
  try { user = await api('/auth/me'); } catch { return (location.href = '/login.html'); }
  $('#admin-link').hidden = user.role !== 'admin';
  try { prefs = await api('/me/settings'); } catch {}
  document.body.classList.toggle('simple', store.get('va_simple') === '1');
  applyPrefs(prefs);
  Speech.rate = prefs.voice_rate; Speech.vibrate = !!prefs.vibration;
  Scene.configure({ verbosity: store.get('va_narr') || 'normal' });
  TTS.watchScreenReader();
  fillSettings();
  A11y.init();
  Translate.init(); Reader.init(); AAC.init(); Reminders.init(); Sound.init(); Where.init();
  People.init(); MedicalID.init(); Crisis.init(); Calm.init(); Meds.init(); VoiceControl.init();
  api('/vision/status').then(r => { cloudVision = r.cloud; updateSeeButtons(); }).catch(() => {});
  setupOnboarding();
  Meds.load();
  Scanner.preload();
  startNav();
})();

// acciones de los estados vacíos
document.addEventListener('click', e => {
  const f = e.target.closest('[data-focus]');
  if (f) { const el = $(f.dataset.focus); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } return; }
  if (e.target.closest('[data-go-see]')) { show('s-see'); setSeeMode('escena').then(() => { if (!Scanner.running) $('#btn-cam').click(); }); }
});
$('#med-scan').onclick = async () => { show('s-see'); await setSeeMode('medicina'); if (!Scanner.running) $('#btn-cam').click(); };

async function setupOnboarding() {
  const card = $('#onb');
  const mark = (k, ok) => { const li = $(`#onb-list [data-k="${k}"]`); if (li) li.classList.toggle('done', ok); };
  async function permsOk() {
    if (isNative()) return store.get('va_camok') === '1';     // Android dice «prompt» aunque la app tenga el permiso: vale la cámara que ya abrió
    try {
      const r = await Promise.all(['camera', 'microphone'].map(n => navigator.permissions.query({ name: n })));
      return r.every(x => x.state === 'granted');
    } catch { return false; }
  }
  async function refresh() {
    if (store.get('va_onb') === '1') { card.hidden = true; return; }
    const perm = await permsOk();
    const sos = (await api('/me/contacts').catch(() => [])).length > 0;
    mark('perm', perm); mark('sos', sos);
    if (perm && sos) { store.set('va_onb', '1'); card.hidden = true; return; }
    card.hidden = false;
  }
  $('#onb-done').onclick = () => { store.set('va_onb', '1'); card.hidden = true; };
  $('#onb-sos').onclick = () => show('s-sos');
  $('#onb-perm').onclick = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      s.getTracks().forEach(t => t.stop());
      toast('Permisos concedidos');
    } catch { toast('No se concedieron. Cámbialos en los ajustes del teléfono.'); }
    refresh();
  };
  addEventListener('focus', refresh);
  refresh();
}

// ---------- ver (escáner) ----------
let lastLog = '', lastLogAt = 0;
const hud = t => {
  $('#hud').textContent = t;
  const now = Date.now();
  if (!Scanner.running || t === lastLog || now - lastLogAt < 2500 || /^(Sin peligros|No detecto|Cámara|Apunta|Abriendo|Escuchando)/.test(t)) return;
  lastLog = t; lastLogAt = now;
  const ul = $('#see-log');
  if (ul.firstElementChild && !ul.firstElementChild.dataset.e) ul.innerHTML = '';
  const li = document.createElement('li');
  li.dataset.e = '1';
  li.innerHTML = `<span>${esc(t)}</span><small>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small>`;
  ul.prepend(li);
  while (ul.children.length > 30) ul.lastChild.remove();
};
const status = t => { const l = $('#see-status'); l.hidden = !t; l.textContent = t; };
function setChip(id, cls, text) { const c = $(id); if (c) { c.className = 'chip ' + cls; c.textContent = text; } }
function refreshChips() {
  const d = Scanner.diagnose();
  setChip('#chip-cam', d.camera ? 'ok' : '', d.camera ? 'Cámara activa' : 'Cámara apagada');
  setChip('#chip-ai', d.model ? 'ok' : (d.loading ? 'wait' : ''), d.model ? `IA lista${d.backend ? ' · ' + d.backend : ''}` : (d.loading ? 'IA cargando…' : 'IA sin cargar'));
  setChip('#chip-ocr', d.ocr ? 'ok' : '', d.ocr ? 'Lectura lista' : 'Lectura sin cargar');
}
setInterval(() => { if (current === 's-see' && !document.hidden) refreshChips(); }, 1500);
// narración: por voz, o por la región viva si hay lector de pantalla (así TalkBack la lee una sola vez)
function narrate(text, { urgent = false, interrupt = urgent } = {}) {
  const r = TTS.route({ screenReader: TTS.screenReaderOn, urgent });
  if (r.live) {
    const el = $(r.live === 'assertive' ? '#narr-alert' : '#narr-live');
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = text; });   // vaciar antes: un resumen repetido también se anuncia
  }
  if (r.speak) Speech.speak(text, { interrupt });
}
const cbs = {
  hud, status, narrate, state: on => setScan(on),
  swatch: rgb => { $('#swatch').style.background = rgb ? `rgb(${rgb.join(',')})` : ''; },
  save: (type, result, label, confidence) => api('/scans', { method: 'POST', body: { type, result, label, confidence } }).catch(() => {}),
};
// botones de la cámara según el modo; con la cámara apagada no sirven y no se muestran
function syncCamButtons() {
  const m = Scanner.mode, on = Scanner.running;
  const rd = $('#btn-read');
  rd.hidden = !on || !(m === 'texto' || m === 'traducir' || m === 'medicina');
  rd.textContent = m === 'traducir' ? 'Leer y traducir' : m === 'medicina' ? 'Leer medicina' : 'Leer texto';
  $('#btn-detail').hidden = !on || !(m === 'escena' && cloudVision);
  $('#btn-what').hidden = !on || m !== 'escena';
  $('#color-row').hidden = !on || m !== 'color';
}
function updateSeeButtons() {
  syncCamButtons();
  const m = Scanner.mode;
  $('#see-actions').hidden = true;
  if (m !== 'medicina') { $('#med-result').hidden = true; Meds.stopBarcode(); }
}
async function setSeeMode(m) {
  $$('#see-modes button').forEach(x => { const on = x.dataset.mode === m; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; });
  try { await Scanner.setMode(m); } catch (e) { hud(e.message); }
  updateSeeButtons();
  if (m === 'medicina' && Scanner.running) startMedBarcode();
}
async function pickMode(b, { focus = false } = {}) {
  if (!b) return;
  await setSeeMode(b.dataset.mode);
  if (focus) b.focus();
  b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  narrate('Modo ' + b.textContent.trim(), { interrupt: true });
  Speech.buzz([15]);
}
// paso de modo: +1 el siguiente, -1 el anterior (da la vuelta)
function stepMode(dir, opts) {
  const list = $$('#see-modes button'), i = list.findIndex(x => x.getAttribute('aria-selected') === 'true');
  return pickMode(list[(i + dir + list.length) % list.length], opts);
}
$$('#see-modes button').forEach(b => b.onclick = () => pickMode(b));
$('#see-modes').addEventListener('keydown', e => {
  const list = $$('#see-modes button');
  const go = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (go) { e.preventDefault(); stepMode(go, { focus: true }); }
  else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); pickMode(list[e.key === 'Home' ? 0 : list.length - 1], { focus: true }); }
});
// deslizar a la izquierda o a la derecha sobre la imagen o la narración cambia de modo (en los botones, no).
// El tiempo sale de los eventos: con la cámara analizando, el manejador puede correr tarde.
let swipe0 = null, swipedAt = 0;
$('#s-see').addEventListener('pointerdown', e => {
  const zone = e.isPrimary && e.target.closest('#cam, .narr-card') && !e.target.closest('button, a, input, select, textarea');
  swipe0 = zone ? { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId } : null;
});
$('#s-see').addEventListener('pointerup', e => {
  const s = swipe0; swipe0 = null;
  if (!s || e.pointerId !== s.id) return;
  const d = Gestures.swipe({ dx: e.clientX - s.x, dy: e.clientY - s.y, dt: e.timeStamp - s.t });
  if (d === 'left' || d === 'right') { swipedAt = performance.now(); stepMode(d === 'left' ? 1 : -1); }
  else if (d === 'up' && !panel.docked) { swipedAt = performance.now(); panel.open('half'); }
});
$('#s-see').addEventListener('pointercancel', () => { swipe0 = null; });
$('#btn-more').onclick = () => panel.open('full');
$('#cam-sos').onclick = () => show('s-sos');

// botón del ojo: Escanear / Detener
function setScan(on) {
  const b = $('#btn-cam');
  if (!b) return;
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('scanning', on);
  const label = on ? 'Detener' : 'Escanear';
  $('#eye-label').textContent = label;
  b.setAttribute('aria-label', on ? 'Detener escaneo' : 'Escanear');
  syncCamButtons();
  keepAwake(on && (panel.pos === 'closed' || panel.docked));
}
// pantalla encendida mientras escanea: si se apaga, la narración se corta (el sistema la suelta al pasar a segundo plano)
let wake = null;
async function keepAwake(on) {
  try {
    if (on && !wake && navigator.wakeLock && !document.hidden) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
      if (!Scanner.running) keepAwake(false);                     // se detuvo mientras se pedía
    } else if (!on && wake) { const w = wake; wake = null; await w.release(); }
  } catch { wake = null; }
}
// al entrar en la cámara: empieza sola si hay permiso y la persona no la detuvo; nunca pide el permiso por su cuenta
const isNative = () => !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
async function enterCamera() {
  const idle = () => current === 's-see' && !Scanner.running && !$('#btn-cam').disabled;
  if (!idle()) return;
  let permission = null;
  try { permission = (await navigator.permissions.query({ name: 'camera' })).state; } catch { /* sin consulta de permisos */ }
  if (!idle()) return;                                            // cambió mientras se consultaba
  const what = Camera.autoStart({ intent: store.get('va_autoscan'), permission, camok: store.get('va_camok'), native: isNative() });
  if (what === 'start') return $('#btn-cam').click();
  if (what === 'denied') {
    const m = Camera.explain({ name: 'NotAllowedError' });
    hud(m);
    try { if (sessionStorage.getItem('va_denied') !== '1') { sessionStorage.setItem('va_denied', '1'); narrate(m); } } catch { narrate(m); }
    return;
  }
  hud(HINT);
  if (store.get('va_hint') !== '1') { store.set('va_hint', '1'); narrate(HINT); }   // se dice una sola vez
}
function startMedBarcode() {
  Meds.startBarcode($('#video'), (code, known) => {
    const msg = known ? `Reconocí ${known.name} de tu botiquín.` : `Código de barras leído: ${code}.`;
    hud(msg); Speech.speak(msg); Speech.buzz([60]);
    const bc = $('#mr-barcode'); if (bc) bc.value = code;
  });
}
$('#btn-cam').onclick = async () => {
  const btn = $('#btn-cam');
  if (Scanner.running) {
    store.set('va_autoscan', '0');                               // la detuvo la persona: no vuelve a empezar sola
    Scanner.stop(); Meds.stopBarcode(); setScan(false);
    hud('Escaneo detenido.'); Speech.stopSpeaking(); Speech.speak('Escaneo detenido'); Speech.buzz([40]);
    return;
  }
  btn.disabled = true;
  store.set('va_autoscan', '1');
  try {
    hud('Abriendo cámara…');
    await Scanner.start(cbs);
    if (!Scanner.running) { setScan(false); return; }           // se canceló: la persona salió de la cámara mientras abría
    store.set('va_camok', '1');
    if (panel.pos !== 'closed' && !panel.docked) Scanner.pause();   // volvió de segundo plano con el panel abierto
    setScan(true);
    Speech.buzz([40]);
    const front = Scanner.facing === 'user' ? 'Usando la cámara frontal. ' : '';
    if (Scanner.mode === 'escena') { hud('Escuchando el entorno…'); Speech.speak(front + 'Escaneo iniciado. Voy a describir lo que veo.', { interrupt: false }); }
    else if (Scanner.mode === 'medicina') { hud('Apunta a la caja y pulsa «Leer medicina».'); Speech.speak(front + 'Apunta a la caja de la medicina y pulsa leer.', { interrupt: false }); startMedBarcode(); }
    else if (Scanner.mode === 'texto' || Scanner.mode === 'traducir') Speech.speak(front + 'Apunta al texto y pulsa leer.', { interrupt: false });
    else if (front) Speech.speak(front, { interrupt: false });
  } catch (e) {
    setScan(false);
    const m = Camera.explain(e);
    hud(m); Speech.speak(m);
    status('');
  } finally { btn.disabled = false; }
};
// «¿Qué hay?»: repite lo que hay delante aunque ya se haya dicho
function whatIsThere() {
  if (!Scanner.running) { hud('Primero pulsa el ojo para empezar.'); Speech.speak('Primero pulsa el ojo para empezar.'); return; }
  const s = Scanner.summary();
  hud(s); narrate(s, { interrupt: true });
}
$('#btn-what').onclick = whatIsThere;
$('#hud').addEventListener('click', () => { if (Scanner.mode === 'escena' && performance.now() - swipedAt > 500) whatIsThere(); });   // tras deslizar, no
$('#btn-flip').onclick = async () => {
  try {
    const r = await Scanner.flip();
    setScan(Scanner.running);
    if (r.failed) {
      const m = 'No pude abrir la otra cámara. ' + (Scanner.running ? `Sigo con la ${r.facing === 'user' ? 'frontal' : 'trasera'}.` : Camera.explain(r.error));
      hud(m); Speech.speak(m);
      return;
    }
    Speech.speak(r.same ? 'Solo encontré una cámara.' : r.facing === 'user' ? 'Cámara frontal.' : 'Cámara trasera.');
  } catch (e) { setScan(Scanner.running); const m = Camera.explain(e); hud(m); Speech.speak(m); }
};

// idioma de origen al traducir con cámara: inglés si el texto lo parece, si no el elegido
const guessLang = t => (/\b(the|and|of|to|is|are|with|for|you|your|this|that)\b/i.test(t) ? 'en' : ($('#tr-from').value || 'es'));

async function cloudRead(mode) {
  const c = Scanner.snapshot(1280);
  if (!c) return '';
  const r = await api('/vision/describe', { method: 'POST', body: { mode, image: c.toDataURL('image/jpeg', 0.8) } });
  return (r.text || '').trim();
}

$('#btn-read').onclick = async () => {
  const b = $('#btn-read'); b.disabled = true;
  // quien no ve la pantalla sabe que la app está trabajando
  narrate(Scanner.mode === 'medicina' ? 'Leyendo la caja…' : 'Leyendo…', { interrupt: true });
  const slow = setTimeout(() => narrate('Sigo leyendo…'), 8000);
  try { await readNow(); }
  catch (e) { hud(e.message); Speech.speak(e.message); }   // también por voz: la persona puede no ver la pantalla
  finally { clearTimeout(slow); status(''); b.disabled = false; }   // pase lo que pase, el botón vuelve a servir
};
async function readNow() {
  const isMed = Scanner.mode === 'medicina';
  let text = await Scanner.readText();
  if (!text && cloudVision) {
    status('Leyendo con IA en la nube…');
    try { text = await cloudRead(isMed ? 'medicine' : 'read'); if (text) hud(text); }
    catch (e) { hud(e.message); }
  }
  if (!text) {
    Speech.speak(Scanner.lastAdvice || (isMed ? 'No pude leer la caja. Acércala, evita reflejos y mejora la luz.' : 'No pude leer texto. Acerca la cámara y mejora la luz.'));
    return;
  }
  if (isMed) {
    const parsed = MedParse.parse(Scanner.lastLines && Scanner.lastLines.length ? Scanner.lastLines : text);
    parsed.barcode = ($('#mr-barcode') && $('#mr-barcode').value) || (await Meds.barcodeFrom(Scanner.lastStill)) || '';
    Meds.showScan(parsed);
    $('#mr-ai').hidden = !cloudVision;
    Speech.speak(MedParse.speak(parsed));
    cbs.save('texto', 'Medicina: ' + (parsed.name || 'sin nombre') + ' ' + (parsed.dose || ''), 'medicina', 0.7);
    return;
  }
  cbs.save('texto', text.slice(0, 900), 'texto', 0.8);
  $('#see-actions').hidden = false;
  $('#see-actions').dataset.text = text;
  if (Scanner.mode === 'traducir') {
    const to = $('#tr-to').value || 'en', from = guessLang(text);
    if (from === to) { hud(text); Speech.speak(text, { lang: to }); return; }
    status('Traduciendo…');
    try {
      const t = await api('/translate', { method: 'POST', body: { text: text.slice(0, 800), from, to } });
      hud(t.text); Speech.speak(t.text, { lang: to });
    } catch (e) {
      const msg = e.network ? 'Sin internet: no puedo traducir esto. Te leo el texto original.' : e.message;
      hud(msg + ' ' + text); Speech.speak(msg); if (e.network) Speech.speak(text, { interrupt: false });
    }
  } else Speech.speak(text);
}
$('#mr-ai').onclick = async () => {
  status('Analizando la caja con IA…');
  try {
    const text = await cloudRead('medicine');
    if (!text) throw new Error('La cámara no está activa.');
    $('#mr-summary').textContent = text + ' (Información orientativa; consulta a tu médico o farmacéutico.)';
    Speech.speak(text);
  } catch (e) { toast(e.message); }
  status('');
};
$('#btn-detail').onclick = async () => {
  const c = Scanner.snapshot(640);
  if (!c) return hud('Inicia la cámara primero.');
  const b = $('#btn-detail'); b.disabled = true; status('Analizando con IA…');
  try {
    const r = await api('/vision/describe', { method: 'POST', body: { image: c.toDataURL('image/jpeg', 0.7) } });
    hud(r.text); Speech.speak(r.text);
    cbs.save('escena', r.text.slice(0, 900), 'detalle', 0.9);
  } catch (e) { hud(e.message); Speech.speak('No pude obtener la descripción detallada.'); }
  status(''); b.disabled = false;
};
$('#a-reader').onclick = () => { Reader.setText($('#see-actions').dataset.text || ''); show('s-reader'); };
$('#a-translate').onclick = () => { $('#tr-in').value = $('#see-actions').dataset.text || ''; show('s-translate'); };
$('#tr-cam').onclick = async () => { show('s-see'); await setSeeMode('traducir'); };
$('#rd-cam').onclick = async () => { show('s-see'); await setSeeMode('texto'); };

// ---------- lupa ----------
$('#lupa-go').onclick = async () => {
  const b = $('#lupa-go');
  if (Lupa.running) { Lupa.stop(); b.textContent = 'Abrir lupa'; return; }
  try { await Lupa.start(); b.textContent = 'Cerrar lupa'; }
  catch (e) { toast('No se pudo abrir la cámara: ' + (e.name === 'NotAllowedError' ? 'permiso denegado' : e.message)); }
};
$('#lupa-zoom').addEventListener('input', e => Lupa.setZoom(e.target.value));
$('#lupa-filter').onchange = e => Lupa.setFilter(e.target.value);
$('#lupa-freeze').onclick = e => { const f = Lupa.freeze(); e.currentTarget.textContent = f ? 'Continuar' : 'Congelar'; };
$('#lupa-torch').onclick = () => Lupa.toggleTorch();
$('#lupa-color').onclick = () => { const c = Lupa.sayColor(); if (c) { toast(c); Speech.speak(c); } };

// ---------- oír ----------
$$('#voice-tabs button').forEach(b => b.onclick = () => {
  $$('#voice-tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
  $('#v-text').hidden = b.dataset.v !== 'text';
  $('#v-sound').hidden = b.dataset.v !== 'sound';
  $('#v-amp').hidden = b.dataset.v !== 'amp';
  if (b.dataset.v !== 'text') { Speech.stopListen(); $('#btn-listen').textContent = 'Escuchar'; }
  if (b.dataset.v !== 'sound') Sound.stop();
  if (b.dataset.v !== 'amp') { Amp.stop(); $('#amp-go').textContent = 'Activar amplificador'; }
});
$('#amp-go').onclick = async () => {
  const b = $('#amp-go');
  if (Amp.running) { Amp.stop(); b.textContent = 'Activar amplificador'; return; }
  try { await Amp.start(Number($('#amp-gain').value)); b.textContent = 'Detener amplificador'; }
  catch (e) { toast('No se pudo usar el micrófono: ' + (e.name === 'NotAllowedError' ? 'permiso denegado' : e.message)); }
};
$('#amp-gain').addEventListener('input', e => { $('#amp-gain-v').textContent = Number(e.target.value).toFixed(1) + '×'; Amp.setGain(e.target.value); });

let finalText = '';
const tEl = $('#transcript');
const renderT = interim => {
  tEl.innerHTML = (finalText || interim) ? `${esc(finalText)}<span class="interim">${esc(interim || '')}</span>` : '<span class="interim">Pulsa «Escuchar» y la conversación aparecerá aquí.</span>';
};
$('#btn-listen').onclick = () => {
  const btn = $('#btn-listen');
  if (Speech.rec) { Speech.stopListen(); btn.textContent = 'Escuchar'; return; }
  if (!Speech.supported) { tEl.textContent = 'Tu navegador no soporta reconocimiento de voz. Usa Chrome en Android.'; return; }
  Speech.listen((fin, interim) => { finalText += fin; renderT(interim); }, (s, err) => {
    if (s === 'start') btn.textContent = 'Detener';
    if (s === 'stop') btn.textContent = 'Escuchar';
    if (s === 'error') tEl.innerHTML = `<span class="interim">Error de micrófono: ${esc(err === 'not-allowed' ? 'permiso denegado' : err)}</span>`;
  });
  Speech.buzz([60]);
};
$('#btn-clear').onclick = () => { finalText = ''; renderT(''); };
$('#btn-copy').onclick = () => navigator.clipboard && navigator.clipboard.writeText(finalText).catch(() => {});

// ---------- SOS ----------
async function loadContacts() {
  contacts = await api('/me/contacts').catch(() => []);
  $('#contacts').innerHTML = contacts.length ? contacts.map(c => `<li><span><b>${esc(c.name)}</b><br><small>${esc(c.phone)}</small></span>
    <span class="row"><a class="btn sm primary" href="tel:${esc(c.phone)}" aria-label="Llamar a ${esc(c.name)}"><svg class="ic" aria-hidden="true"><use href="/icons/sprite.svg#i-phone"/></svg></a>
    <button class="btn sm danger" data-del="${c.id}" aria-label="Eliminar ${esc(c.name)}"><svg class="ic" aria-hidden="true"><use href="/icons/sprite.svg#i-x"/></svg></button></span></li>`).join('')
    : '<li><small>Aún no tienes contactos. Agrega al menos uno.</small></li>';
  $$('#contacts [data-del]').forEach(b => b.onclick = async () => { await api('/me/contacts/' + b.dataset.del, { method: 'DELETE' }); loadContacts(); });
}
$('#f-contact').onsubmit = async e => {
  e.preventDefault();
  try {
    await api('/me/contacts', { method: 'POST', body: { name: $('#c-name').value, phone: $('#c-phone').value } });
    e.target.reset(); $('#c-msg').innerHTML = ''; loadContacts();
  } catch (x) { $('#c-msg').innerHTML = `<div class="msg err">${esc(x.message)}</div>`; }
};
$('#btn-sos').onclick = async () => {
  if (!contacts.length) await loadContacts();
  const c = contacts[0];
  const out = $('#sos-out'); out.hidden = false;
  Speech.buzz([500, 200, 500]); Speech.speak('Preparando mensaje de emergencia');
  const doc = await api('/medical').catch(() => ({}));
  const send = pos => {
    const loc = pos ? ` Mi ubicación: https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}` : '';
    const med = [doc.blood && `Sangre ${doc.blood}`, doc.allergies && `Alergias: ${doc.allergies}`, doc.conditions && `Condiciones: ${doc.conditions}`].filter(Boolean).join('. ');
    const body = encodeURIComponent(`Necesito ayuda. Soy ${doc.full_name || user.name}.${med ? ' ' + med + '.' : ''}${loc}`);
    if (!c) { out.className = 'msg err'; out.textContent = 'Agrega primero un contacto de emergencia.'; return; }
    out.className = 'msg ok';
    out.innerHTML = `Listo para ${esc(c.name)}. <a class="btn sm primary" href="sms:${esc(c.phone)}?body=${body}">Enviar SMS</a> <a class="btn sm danger" href="tel:${esc(c.phone)}">Llamar</a>`;
  };
  if (navigator.geolocation) navigator.geolocation.getCurrentPosition(send, () => send(null), { timeout: 6000 });
  else send(null);
};

// ---------- historial ----------
let hPage = 1;
const HLABEL = { escena: 'Escena', objetos: 'Escena', texto: 'Texto', alerta: 'Alerta', traduccion: 'Traducción', color: 'Color' };
async function loadHistory(reset) {
  if (reset) { hPage = 1; $('#history').innerHTML = ''; }
  const [s, h] = await Promise.all([api('/scans/stats'), api(`/scans?page=${hPage}&size=15`)]).catch(() => [null, null]);
  if (!h) return;
  if (s) $('#stats').innerHTML = `<b>${s.total}</b> registros` + (s.top.length ? ` · Lo más frecuente: ${s.top.map(t => `${esc(t.label)} (${t.c})`).join(', ')}` : '');
  $('#history').insertAdjacentHTML('beforeend', h.rows.map(r =>
    `<li><span>${esc(r.result)}<br><small>${esc(r.created_at)}</small></span><span class="pill">${esc(HLABEL[r.type] || r.type)}</span></li>`).join('') || (reset ? '<li class="empty"><span>Sin registros todavía.</span><button class="btn sm primary" data-go-see>Escanear ahora</button></li>' : ''));
  $('#h-more').hidden = hPage * h.size >= h.total;
}
$('#h-more').onclick = () => { hPage++; loadHistory(false); };
$('#h-del').onclick = async () => { if (confirm('¿Borrar todo tu historial?')) { await api('/scans', { method: 'DELETE' }); loadHistory(true); } };

// ---------- ajustes ----------
function fillSettings() {
  $('#s-narr').value = store.get('va_narr') || 'normal';
  $('#s-rate').value = prefs.voice_rate; $('#s-rate-v').textContent = prefs.voice_rate + 'x';
  $('#s-font').value = prefs.font_size; $('#s-font-v').textContent = prefs.font_size;
  $('#s-con').checked = !!prefs.contrast; $('#s-vib').checked = !!prefs.vibration;
  $('#s-simple').checked = document.body.classList.contains('simple');
}
const live = () => {
  prefs = { voice_rate: Number($('#s-rate').value), font_size: Number($('#s-font').value), contrast: $('#s-con').checked ? 1 : 0, vibration: $('#s-vib').checked ? 1 : 0 };
  $('#s-rate-v').textContent = prefs.voice_rate + 'x'; $('#s-font-v').textContent = prefs.font_size;
  applyPrefs(prefs); Speech.rate = prefs.voice_rate; Speech.vibrate = !!prefs.vibration;
};
['s-rate', 's-font', 's-con', 's-vib'].forEach(id => $('#' + id).addEventListener('input', live));
$('#s-simple').onchange = e => {
  document.body.classList.toggle('simple', e.target.checked);
  store.set('va_simple', e.target.checked ? '1' : '0');
  renderPanel();
};
// ---------- diagnóstico ----------
const diagState = () => ({ scanner: Scanner.diagnose(), voice: { engine: Speech.engine, lang: Speech.lang, ok: Speech.ok }, screenReader: TTS.screenReaderOn, online: navigator.onLine });
Speech.onfail = () => toast('La voz no responde. Revisa Ajustes → Diagnóstico.', 6000);
// solo cambia el texto que cambió: reescribir la lista haría que TalkBack pierda el foco
function renderDiag() {
  const rows = Diag.lines(diagState()), ul = $('#diag-list');
  if (ul.children.length !== rows.length) ul.innerHTML = rows.map(() => '<li><span class="dot" aria-hidden="true"></span><span><b></b><span></span></span></li>').join('');
  rows.forEach((r, i) => {
    const li = ul.children[i], dot = li.firstElementChild, b = li.querySelector('b'), v = b.nextElementSibling;
    const cls = 'dot' + (r.ok === true ? ' ok' : r.ok === false ? ' bad' : '');
    if (dot.className !== cls) dot.className = cls;
    if (b.textContent !== r.label) b.textContent = r.label;
    if (v.textContent !== r.value) v.textContent = r.value;
  });
}
setInterval(() => { if (current === 's-set' && !document.hidden) renderDiag(); }, 2000);
$('#diag-retry').onclick = async () => {
  toast('Reiniciando la IA…');
  try { await Scanner.resetAI(); toast('La IA está lista.'); } catch (e) { toast('No se pudo cargar la IA: ' + e.message); }
  renderDiag();
};
$('#diag-copy').onclick = async () => {
  try { await navigator.clipboard.writeText(Diag.text(diagState())); toast('Informe copiado'); }
  catch { toast('No se pudo copiar el informe'); }
};
$('#s-narr').onchange = e => { Scene.configure({ verbosity: e.target.value }); store.set('va_narr', e.target.value); };
$('#s-test').onclick = () => Speech.speak('Así suena la voz con esta velocidad.');
$('#s-save').onclick = async () => {
  try { await api('/me/settings', { method: 'PUT', body: prefs }); $('#s-msg').innerHTML = '<div class="msg ok">Guardado ✔</div>'; }
  catch (x) { $('#s-msg').innerHTML = `<div class="msg err">${esc(x.message)}</div>`; }
};

// exportar / importar mis datos (JSON)
const DATA_LISTS = ['/me/contacts', '/phrases', '/reminders', '/people', '/crises', '/medicines'];
$('#d-export').onclick = async () => {
  const out = { app: 'VISUALAPP', version: 2, exported_at: new Date().toISOString(), user: { name: user.name, disability: user.disability } };
  for (const p of DATA_LISTS) out[p] = await api(p).catch(() => []);
  out['/me/settings'] = await api('/me/settings').catch(() => ({}));
  out['/medical'] = await api('/medical').catch(() => ({}));
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'visualapp-datos.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  $('#d-msg').innerHTML = '<div class="msg ok">Copia creada</div>';
};
$('#d-import').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'VISUALAPP') throw new Error('Archivo no válido');
    let n = 0;
    for (const p of DATA_LISTS) {
      for (const it of (Array.isArray(data[p]) ? data[p] : [])) {
        const { id, ...body } = it;
        try { await api(p, { method: 'POST', body }); n++; } catch {}
      }
    }
    if (data['/medical']) await api('/medical', { method: 'PUT', body: data['/medical'] }).catch(() => {});
    $('#d-msg').innerHTML = `<div class="msg ok">Se importaron ${n} elementos</div>`;
  } catch (x) { $('#d-msg').innerHTML = `<div class="msg err">${esc(x.message)}</div>`; }
  e.target.value = '';
};

// libera cámara/micrófono si la pestaña se oculta
// al volver de segundo plano, el escaneo sigue donde estaba
let resumeScan = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (current === 's-see' && Scanner.running) resumeScan = true;
    if (['s-see', 's-voice', 's-lupa'].includes(current)) cleanup(current);
  } else if (resumeScan) {
    resumeScan = false;
    if (current === 's-see' && !Scanner.running) $('#btn-cam').click();
  }
});

// atajo: barra espaciadora enciende/apaga el escaneo en la pantalla Ver
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && current === 's-see' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName) && !e.target.closest('#panel')) { e.preventDefault(); $('#btn-cam').click(); }
});

// ---------- estado de red, datos pendientes y descarga de la IA ----------
function renderNet() {
  const bar = $('#netbar');
  if (!bar) return;
  let msg = '';
  if (typeof LOCAL !== 'undefined' && LOCAL) msg = '';
  else if (Net.offline) msg = 'Sin conexión · tus datos se guardan en este dispositivo' + (Net.pending ? ` (${Net.pending} por sincronizar)` : '');
  else if (Net.pending) msg = `Sincronizando ${Net.pending} cambio${Net.pending > 1 ? 's' : ''}…`;
  bar.hidden = !msg;
  bar.textContent = msg;
  bar.classList.toggle('off', Net.offline);

  const dl = $('#ai-dl');
  const ai = Net.ai;
  if (dl) {
    if (ai && ai.type === 'ai-progress' && !ai.error && ai.done < ai.total) {
      dl.hidden = false;
      $('#ai-dl-bar').style.width = Math.round(ai.done / ai.total * 100) + '%';
      $('#ai-dl-t').textContent = `Descargando la IA en tu dispositivo… ${ai.done} de ${ai.total}`;
    } else if (ai && ai.type === 'ai-ready') {
      dl.hidden = false;
      $('#ai-dl-bar').style.width = '100%';
      $('#ai-dl-t').textContent = 'Listo: ya puedes usar el escáner y el lector sin internet.';
      setTimeout(() => { dl.hidden = true; }, 6000);
      Net.ai = { type: 'done' };
    } else if (ai && ai.error) {
      dl.hidden = false;
      $('#ai-dl-t').textContent = 'No se pudo terminar la descarga. Se reintentará cuando haya conexión.';
    }
  }
}
Net.listeners.add(renderNet);
renderNet();

// guía para iPhone: no hay botón de instalar en Safari
(function () {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const tip = $('#ios-tip');
  if (tip && ios && !standalone && !(typeof LOCAL !== 'undefined' && LOCAL)) tip.hidden = false;
})();

// al sincronizar, refrescar las listas visibles
addEventListener('va:synced', () => {
  if (current === 's-sos') loadContacts();
  if (current === 's-hist') loadHistory(true);
});
