// Capa de movimiento: entradas escalonadas al hacer scroll. Sin JS el contenido queda visible.
document.documentElement.classList.add('js');
// tema guardado antes del primer pintado (lo comparten la landing y la app); en la landing, también el tamaño de letra
try {
  const h = document.documentElement;
  const ui = JSON.parse(localStorage.getItem('va_ui') || '{}');
  if (ui.theme === 'light' || ui.theme === 'dark') h.setAttribute('data-theme', ui.theme);
  if (h.dataset.page === 'landing') {
    const land = JSON.parse(localStorage.getItem('va_land') || '{}');
    if (land.fs >= 16 && land.fs <= 26) h.style.setProperty('--fs', land.fs + 'px');
  }
} catch {}
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setup() {
    const els = [...document.querySelectorAll('.reveal')];
    // escalonar hermanos
    const counts = new Map();
    els.forEach(el => {
      const p = el.parentElement, n = counts.get(p) || 0;
      counts.set(p, n + 1);
      el.style.setProperty('--i', Math.min(n, 6));
    });
    if (reduce || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    els.forEach(e => io.observe(e));
    // seguro: si algo no se revela en 4s, mostrarlo
    setTimeout(() => els.forEach(e => e.classList.add('in')), 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();
