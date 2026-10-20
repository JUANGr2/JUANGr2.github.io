// Gestos: qué deslizamiento hizo el dedo y dónde se detiene el panel al soltarlo.
// No toca el navegador al cargar: se prueba en Node.
const Gestures = (() => {
  const MIN_PX = 48, MAX_MS = 700, RATIO = 1.5, FLING = 0.5;   // FLING en px/ms
  const ORDER = ['full', 'half', 'closed'];                      // paradas de arriba abajo

  // 'left' | 'right' | 'up' | 'down' | null: largo, rápido y con un eje claramente dominante
  function swipe({ dx, dy, dt }) {
    if (dt > MAX_MS) return null;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < MIN_PX) return null;
    if (ax >= ay * RATIO) return dx < 0 ? 'left' : 'right';
    if (ay >= ax * RATIO) return dy < 0 ? 'up' : 'down';
    return null;
  }

  // la parada más cercana a y; con un gesto rápido, la siguiente en su sentido
  function snap({ y, vy, stops }) {
    const near = ORDER.reduce((b, k) => (Math.abs(stops[k] - y) < Math.abs(stops[b] - y) ? k : b), 'closed');
    if (Math.abs(vy) < FLING) return near;
    const i = ORDER.indexOf(near) + (vy < 0 ? -1 : 1);
    return ORDER[Math.max(0, Math.min(ORDER.length - 1, i))];
  }

  return { swipe, snap };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Gestures;
