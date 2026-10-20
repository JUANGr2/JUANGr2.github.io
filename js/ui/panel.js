// Panel de herramientas de la cámara: tres posiciones (cerrado, medio, completo), sigue al dedo y se maneja
// también con su pestaña (botón con estado) y con Esc. Las decisiones del arrastre salen de Gestures.snap.
// En PC (≥ 1024 px) queda acoplado a la derecha de la cámara: siempre abierto, sin pestaña ni arrastre.
const Panel = (() => {
  const VIEWS = { half: 'panel-half', full: 'panel-full' };
  const WIDE = '(min-width:1024px)';
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('safe');

  // onChange(pos, prev, docked)
  function mount({ root, tab, onChange = () => {} }) {
    const body = root.querySelector('.panel-body');
    const mq = matchMedia(WIDE);
    let pos = 'closed', hideTimer = 0, dragged = false, docked = false;

    function show(view) {
      for (const [k, id] of Object.entries(VIEWS)) { const el = document.getElementById(id); if (el) el.hidden = k !== view; }
    }
    function set(next, { focus = true } = {}) {
      if (docked && next === 'closed') next = 'half';             // acoplado: «cerrar» vuelve a la vista media
      if (next === pos) return;
      const prev = pos;
      pos = next;
      clearTimeout(hideTimer);
      if (next === 'closed') {
        root.dataset.pos = 'closed';
        tab.setAttribute('aria-expanded', 'false');
        hideTimer = setTimeout(() => { if (pos === 'closed') body.hidden = true; }, reduce() ? 0 : 260);
        if (focus) tab.focus();
      } else {
        body.hidden = false;
        show(next);
        body.scrollTop = 0;                                       // cada vista empieza arriba, en su título
        root.dataset.pos = next;
        tab.setAttribute('aria-expanded', 'true');
        if (focus) { const h = document.querySelector(`#${VIEWS[next]} .panel-h`); if (h) h.focus({ preventScroll: true }); }
      }
      onChange(next, prev, docked);
    }
    function dock(on) {
      const before = pos, hadFocus = root.contains(document.activeElement);
      docked = on;
      root.classList.toggle('docked', on);
      if (on) set(pos === 'full' ? 'full' : 'half', { focus: false });
      else set('closed', { focus: hadFocus });                  // el foco que estaba dentro vuelve a la pestaña
      if (pos === before) onChange(pos, pos, docked);           // misma vista, otro modo: la cámara deja de estar tapada
    }

    // arrastre: el panel sigue al dedo y al soltar se detiene donde diga Gestures.snap
    function stops() {
      const H = innerHeight, tabH = tab.getBoundingClientRect().height || 48;
      const bottom = parseFloat(getComputedStyle(root).getPropertyValue('--panel-bottom')) || 0;
      return { closed: H - tabH - bottom, half: Math.round(H * 0.38), full: 8 };
    }
    let start = null;
    tab.addEventListener('pointerdown', e => {
      if (docked) return;
      const s = stops();
      start = { y: e.clientY, top: s[pos], t: performance.now(), last: e.clientY, lastT: performance.now(), vy: 0, s };
      dragged = false;
      tab.setPointerCapture(e.pointerId);
    });
    tab.addEventListener('pointermove', e => {
      if (!start) return;
      const dy = e.clientY - start.y;
      if (!dragged && Math.abs(dy) < 6) return;
      if (!dragged) { dragged = true; body.hidden = false; show(pos === 'full' ? 'full' : 'half'); root.classList.add('dragging'); }
      const now = performance.now();
      start.vy = (e.clientY - start.last) / Math.max(1, now - start.lastT);
      start.last = e.clientY; start.lastT = now;
      const y = Math.min(start.s.closed, Math.max(start.s.full, start.top + dy));
      root.style.transform = `translateY(${y}px)`;
    });
    const end = e => {
      if (!start) return;
      const s = start; start = null;
      if (!dragged) return;                                       // fue un toque: lo resuelve el clic
      root.classList.remove('dragging');
      root.style.transform = '';
      const y = Math.min(s.s.closed, Math.max(s.s.full, s.top + (e.clientY - s.y)));
      const next = Gestures.snap({ y, vy: s.vy, stops: s.s });
      if (next === pos) { root.dataset.pos = pos; if (pos === 'closed') body.hidden = true; } else set(next);
    };
    tab.addEventListener('pointerup', end);
    tab.addEventListener('pointercancel', end);
    tab.addEventListener('click', () => { if (dragged) { dragged = false; return; } set(pos === 'closed' ? 'half' : 'closed'); });

    root.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || pos === 'closed' || (docked && pos === 'half')) return;
      if (e.target.matches && e.target.matches('input[type=search]') && e.target.value) return;   // primero borra la búsqueda
      e.preventDefault();
      set(docked ? 'half' : 'closed');
    });

    root.dataset.pos = 'closed';
    body.hidden = true;
    mq.addEventListener('change', e => dock(e.matches));
    if (mq.matches) dock(true);
    return {
      open: (p = 'half', opts) => set(p, opts),
      close: opts => set('closed', opts),
      toggle: () => set(pos === 'closed' ? 'half' : 'closed'),
      get pos() { return pos; },
      get docked() { return docked; },
    };
  }

  return { mount };
})();
