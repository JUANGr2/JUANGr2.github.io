// Historial de la app: la cámara es la base (profundidad 0); cada función y el panel abierto suman una entrada.
// Así el botón Atrás vuelve a la cámara, cierra el panel y nunca saca de la app desde una función.
// No toca el navegador: dice qué hacer con el historial y app.js lo hace. Se prueba en Node.
const Nav = (() => {
  const HOME = 's-see';
  const norm = s => (s && typeof s === 'object' && typeof s.screen === 'string'
    ? { screen: s.screen, panel: !!s.panel, depth: s.depth > 0 ? Math.floor(s.depth) : 0 }
    : { screen: HOME, panel: false, depth: 0 });

  // ir a la pantalla `id` estando en la entrada `state` (history.state):
  // { op: 'push' | 'replace', state } · { op: 'unwind', steps } (history.go(-steps)) · { op: 'none' }
  function go(state, id) {
    const s = norm(state);
    if (id === HOME) return s.depth > 0 ? { op: 'unwind', steps: s.depth } : { op: 'none' };
    if (s.panel) return { op: 'replace', state: { screen: id, depth: s.depth } };   // la función ocupa la entrada del panel
    if (s.screen === id) return { op: 'none' };
    return { op: 'push', state: { screen: id, depth: s.depth + 1 } };
  }

  // la entrada que se apila al abrir el panel
  function panel(state) {
    const s = norm(state);
    return { screen: s.screen, panel: true, depth: s.depth + 1 };
  }

  // botón Atrás del celular: 'history' (deshacer la última entrada), 'panel' (cerrarlo), 'home' (a la cámara) o 'minimize' (app al fondo)
  function back({ state, screen, panelOpen = false }) {
    if (norm(state).depth > 0) return 'history';
    if (panelOpen) return 'panel';
    return screen !== HOME ? 'home' : 'minimize';
  }

  return { HOME, go, panel, back };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Nav;
