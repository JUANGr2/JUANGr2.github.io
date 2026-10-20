// Preferencias de accesibilidad del dispositivo: tema, botones grandes, modo seguro, filtro de temblor, barrido y voz.
const A11y = (() => {
  const KEY = 'va_ui';
  const DEF = { theme: 'auto', big: false, safe: false, tremor: false, scan: false };
  let ui = { ...DEF };
  const read = () => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEF }; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ui)); } catch {} };

  // el color de la barra del sistema sigue al tema activo
  function syncThemeColor() {
    try {
      const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
      const metas = document.querySelectorAll('meta[name=theme-color]');
      metas.forEach(m => { m.removeAttribute('media'); if (bg) m.setAttribute('content', bg); });
    } catch {}
  }

  function apply() {
    const b = document.body, h = document.documentElement;
    if (ui.theme === 'auto') h.removeAttribute('data-theme'); else h.setAttribute('data-theme', ui.theme);
    b.classList.toggle('big-targets', !!ui.big);
    b.classList.toggle('safe', !!ui.safe);
    Speech.noFlash = !!ui.safe;
    setupTremor(); setupScan();
    syncThemeColor();
  }

  // --- filtro de temblor: ignora toques repetidos sobre el mismo botón ---
  let tremorOn = false, lastClick = new WeakMap();
  function onClickCapture(e) {
    const t = e.target.closest && e.target.closest('button, .btn, a.btn');
    if (!t) return;
    const now = Date.now(), prev = lastClick.get(t) || 0;
    if (now - prev < 700) { e.stopPropagation(); e.preventDefault(); return; }
    lastClick.set(t, now);
  }
  function setupTremor() {
    if (ui.tremor && !tremorOn) { document.addEventListener('click', onClickCapture, true); tremorOn = true; }
    if (!ui.tremor && tremorOn) { document.removeEventListener('click', onClickCapture, true); tremorOn = false; }
  }

  // --- modo de barrido: recorre los botones; cualquier toque en el fondo (o tecla) elige ---
  let scanTimer = 0, scanIdx = -1, scanEls = [];
  function targets() {
    const root = document.querySelector('.screen.active') || document.body;
    const own = [...root.querySelectorAll('button:not([disabled]), a.btn')];
    const nav = [...document.querySelectorAll('.appbar [data-back], #cam-row button, #panel-tab')];   // volver a la cámara, su fila y el panel
    return [...new Set([...own, ...nav])].filter(el => el.offsetParent !== null && !el.closest('[hidden]'));
  }
  function stepScan() {
    scanEls.forEach(el => el.classList.remove('scan-focus'));
    scanEls = targets();
    if (!scanEls.length) return;
    scanIdx = (scanIdx + 1) % scanEls.length;
    const el = scanEls[scanIdx];
    el.classList.add('scan-focus');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const label = el.getAttribute('aria-label') || el.textContent.trim().slice(0, 40);
    if (label) Speech.speak(label);
  }
  function pick(e) {
    if (!ui.scan) return;
    if (e.target.closest && e.target.closest('.scan-focus')) return;      // toque directo: comportamiento normal
    const el = scanEls[scanIdx];
    if (el) { e.preventDefault(); el.classList.remove('scan-focus'); el.click(); }
  }
  function onKey(e) { if (ui.scan && (e.key === ' ' || e.key === 'Enter') && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { e.preventDefault(); pick({ target: document.body, preventDefault() {} }); } }
  function setupScan() {
    clearInterval(scanTimer);
    document.removeEventListener('click', pick);
    document.removeEventListener('keydown', onKey);
    scanEls.forEach(el => el.classList.remove('scan-focus'));
    document.body.classList.toggle('switch-scan', !!ui.scan);
    if (!ui.scan) return;
    scanIdx = -1;
    scanTimer = setInterval(stepScan, 2200);
    document.addEventListener('click', pick);
    document.addEventListener('keydown', onKey);
  }

  // teclado abierto: marca body.kbd mientras se escribe en un campo
  function keyboardWatch() {
    const isField = el => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !['checkbox', 'radio', 'range', 'file'].includes(el.type);
    document.addEventListener('focusin', e => { if (isField(e.target)) document.body.classList.add('kbd'); });
    document.addEventListener('focusout', () => setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove('kbd'); }, 100));
  }

  function init() {
    ui = read();
    keyboardWatch();
    apply();
    const bind = (id, key, isSel) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (isSel) { el.value = ui[key]; el.onchange = () => { ui[key] = el.value; save(); apply(); }; }
      else { el.checked = !!ui[key]; el.onchange = () => { ui[key] = el.checked; save(); apply(); }; }
    };
    bind('u-theme', 'theme', true);
    bind('u-big', 'big'); bind('u-safe', 'safe'); bind('u-tremor', 'tremor'); bind('u-scan', 'scan');
  }

  return { init, get ui() { return ui; }, get safe() { return !!ui.safe; } };
})();
