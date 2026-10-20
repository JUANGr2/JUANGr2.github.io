// Entrada de VISUALAPP: el ojo se abre y salen las tres ondas de voz (unos 1,2 s). Una vez por sesión;
// un toque o una tecla la saltan. No sale con movimiento reducido ni en modo seguro.
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let safe = false;
  try { safe = !!JSON.parse(localStorage.getItem('va_ui') || '{}').safe; } catch {}
  if (reduce || safe) return;
  try {
    if (sessionStorage.getItem('va_intro')) return;
    const landing = /^\/(index\.html)?$/.test(location.pathname);
    if (landing && typeof LOCAL !== 'undefined' && LOCAL) return;   // en el APK la portada solo redirige
    sessionStorage.setItem('va_intro', '1');
  } catch {}

  const el = document.createElement('div');
  el.className = 'eye-intro';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<svg viewBox="0 0 46 32"><path class="ei-lid" d="M2 16C8 6 24 6 30 16C24 26 8 26 2 16Z"/>' +
    '<circle class="ei-pupil" cx="16" cy="16" r="4.6"/><path class="ei-wave w1" d="M33.5 12.5A5 5 0 0 1 33.5 19.5"/>' +
    '<path class="ei-wave w2" d="M36.4 9.6A9 9 0 0 1 36.4 22.4"/><path class="ei-wave w3" d="M39.2 6.8A13 13 0 0 1 39.2 25.2"/></svg>' +
    '<p class="ei-name">VISUALAPP</p>';
  document.body.appendChild(el);

  let closed = false;
  const close = quick => {
    if (closed) return; closed = true;
    if (quick) { el.classList.add('skip'); setTimeout(() => el.remove(), 150); } else el.remove();   // sin saltar, el CSS ya la desvaneció
  };
  el.addEventListener('pointerdown', () => close(true));
  addEventListener('keydown', () => close(true), { once: true });
  setTimeout(() => close(false), 1200);
})();
