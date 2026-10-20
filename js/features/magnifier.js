// Lupa: cámara con zoom, linterna, contraste y realce de color. Todo en el dispositivo.
const Lupa = (() => {
  const FILTERS = {
    normal: 'none',
    contraste: 'contrast(1.9) saturate(1.2)',
    invertido: 'invert(1) hue-rotate(180deg) contrast(1.3)',
    gris: 'grayscale(1) contrast(1.7)',
    amarillo: 'grayscale(1) contrast(2) sepia(1) saturate(4) hue-rotate(-10deg)',
    rojoverde: 'url(#f-rg) contrast(1.15)',     // realce rojo-verde (protanopia/deuteranopia)
    azulamarillo: 'url(#f-by) contrast(1.15)',  // realce azul-amarillo (tritanopia)
  };
  let stream = null, video = null, track = null, zoom = 1, filter = 'normal', torch = false, hwZoom = false;

  const el = id => document.getElementById(id);

  function apply() {
    if (!video) return;
    video.style.filter = FILTERS[filter] || 'none';
    video.style.transform = hwZoom ? '' : `scale(${zoom})`;
  }

  async function start() {
    stop();
    video = el('lupa-video');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('La cámara no está disponible en este dispositivo.');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream;
    try { await video.play(); } catch (e) { stop(); throw e; }
    track = stream.getVideoTracks()[0];
    const caps = (track.getCapabilities && track.getCapabilities()) || {};
    hwZoom = !!caps.zoom;
    const zr = el('lupa-zoom');
    if (hwZoom) { zr.min = caps.zoom.min; zr.max = Math.min(caps.zoom.max, 8); zr.step = caps.zoom.step || 0.1; }
    else { zr.min = 1; zr.max = 6; zr.step = 0.1; }
    zoom = Math.max(Number(zr.min), 1);
    zr.value = zoom;
    el('lupa-torch').hidden = !caps.torch;
    torch = false;
    el('lupa-cam').classList.add('on');
    setZoom(zoom);
    apply();
  }

  function stop() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; track = null;
    if (video) { video.srcObject = null; video.style.transform = ''; video.style.filter = ''; }
    const c = el('lupa-cam');
    if (c) c.classList.remove('on');
  }

  async function setZoom(v) {
    zoom = Number(v) || 1;
    el('lupa-zoom-v').textContent = zoom.toFixed(1) + '×';
    if (hwZoom && track) { try { await track.applyConstraints({ advanced: [{ zoom }] }); } catch { hwZoom = false; } }
    apply();
  }

  async function toggleTorch() {
    if (!track) return;
    torch = !torch;
    try { await track.applyConstraints({ advanced: [{ torch }] }); } catch { torch = false; }
    el('lupa-torch').setAttribute('aria-pressed', String(torch));
  }

  function freeze() {
    if (!video) return false;
    if (video.paused) { video.play().catch(() => {}); return false; }
    video.pause();
    return true;
  }

  function sayColor() {
    const c = video && Scene.centerColor(video);
    if (!c) return null;
    return `${c.name}`;
  }

  return { start, stop, setZoom, toggleTorch, freeze, sayColor, setFilter(f) { filter = f; apply(); }, get running() { return !!stream; } };
})();
