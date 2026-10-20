// Landing: sesión, instalación, recorrido 3D (carga diferida) y esquina en miniatura.
document.getElementById('y').textContent = new Date().getFullYear();

// sesión abierta → el botón lleva al panel
api('/auth/me').then(u => {
  const a = $('#cta-nav');
  a.textContent = 'Mi panel';
  a.href = u.role === 'admin' ? '/admin.html' : '/app.html';
}).catch(() => {});

// app instalada (modo local): directo a la app o al acceso, sin landing
if (typeof LOCAL !== 'undefined' && LOCAL) {
  api('/auth/me').then(() => location.replace('/app.html')).catch(() => location.replace('/login.html'));
}

let deferredInstall;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('#install').hidden = false; });
$('#install').onclick = () => { if (deferredInstall) deferredInstall.prompt(); $('#install').hidden = true; };

// crédito de la foto que se muestra si el dispositivo no tiene 3D
fetch('/assets/photos/credits.json').then(r => r.json()).then(c => {
  const v = c.calle;
  if (v) $('#credits').textContent = `Foto de respaldo: «${v.title.replace(/\.jpe?g$/i, '')}», de ${v.author || 'autor desconocido'} (${v.license}, Wikimedia Commons).`;
}).catch(() => {});

// ---- recorrido 3D: Three.js y el módulo se cargan después del primer pintado ----
(function () {
  const canvas = $('#walk');
  if (!canvas) return;
  const fail = () => document.body.classList.add('no3d');
  const start = () => import('/js/pages/walk3d.js').then(m => {
    const p = { theme: document.documentElement.dataset.theme, hc: document.body.classList.contains('hc'), calm: document.body.classList.contains('calm') };
    window.Walk = m.mount({ canvas, labelsEl: $('#walk-labels'), prefs: p });
    if (!window.Walk) return fail();
    document.body.classList.add('has3d');
    dispatchEvent(new Event('va:walk-ready'));
  }).catch(fail);
  if (document.readyState === 'complete') start(); else addEventListener('load', start, { once: true });
})();

// ---- esquina en miniatura: se carga cuando se acerca a la pantalla ----
(function () {
  const root = $('#street');
  if (!root) return;
  let started = false;
  const go = () => {
    if (started) return; started = true;
    import('/js/pages/street3d.js').then(m => { root.st3d = m.mount(root); if (!root.st3d) root.classList.add('st-off'); })
      .catch(() => root.classList.add('st-off'));
  };
  if (!('IntersectionObserver' in window)) return go();
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '400px' });
  io.observe(root);
})();
