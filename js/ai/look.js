// Look: decide qué nombrar a partir del vector de la imagen (MobileCLIP) y las etiquetas de labels.json.
// Prefiere callar antes que inventar: los distractores (kind 'other') absorben confusiones y nunca se dicen.
// No toca el navegador: se prueba en Node.
const Look = (() => {
  const DEFAULTS = { minScore: 0.45, minMargin: 0.15, placeMin: 0.25, top: 3 };
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const unit = v => { const n = Math.hypot(...v) || 1; return Array.from(v, x => x / n); };

  // probabilidades: softmax del parecido × 100 (la escala de CLIP)
  function probs(vec, labels) {
    const v = unit(vec), s = labels.map(l => dot(v, l.vec) * 100), mx = Math.max(...s);
    const e = s.map(x => Math.exp(x - mx)), sum = e.reduce((a, b) => a + b, 0);
    return labels.map((l, i) => ({ label: l, p: e[i] / sum })).sort((a, b) => b.p - a.p);
  }

  // { main: etiqueta|null, score, ranked: [{ id, p }] }
  function classify(vec, labels, opts = {}) {
    const o = { ...DEFAULTS, ...opts }, r = probs(vec, labels);
    const [a, b] = r, gap = a.p - (b ? b.p : 0);
    const ok = a.label.kind !== 'other' && a.p >= o.minScore && gap >= o.minMargin;
    return { main: ok ? a.label : null, score: a.p, ranked: r.slice(0, o.top).map(x => ({ id: x.label.id, p: x.p })) };
  }

  // partes del lugar con suficiente probabilidad: { piso: { label, p }, … }
  function place(vec, labels, opts = {}) {
    const o = { ...DEFAULTS, ...opts }, out = {};
    for (const x of probs(vec, labels)) if (x.label.kind === 'place' && x.p >= o.placeMin) out[x.label.id] = { label: x.label, p: x.p };
    return out;
  }

  // el mismo id en los últimos n análisis (no nulo)
  function stable(history, n = 2) {
    if (history.length < n) return null;
    const last = history.slice(-n);
    return last[0] != null && last.every(x => x === last[0]) ? last[0] : null;
  }

  return { DEFAULTS, classify, place, stable, probs };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Look;
