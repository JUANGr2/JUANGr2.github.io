// Lectura de texto: preprocesa la imagen, reconoce con Tesseract, filtra ruido, vota entre pasadas
// y corrige confusiones típicas del OCR con un diccionario español.
(function (root) {
  const LETTERS = /[\p{L}\p{N}]/gu;
  const SINGLE_OK = new Set(['a', 'y', 'o', 'e', 'u', 'A', 'Y', 'O', 'E', 'U']);
  const UNIT_SINGLE = new Set(['g', 'l', 'c', 'G', 'L', 'C', 'k', 'K', 'm', 'M']);   // «500 g», «1 L», «vitamina C»

  // ¿tiene la palabra pinta de palabra real? prevHasDigit permite unidades sueltas tras un número
  function goodWord(text, conf, prevHasDigit) {
    const t = String(text || '').trim();
    if (!t) return false;
    const alnum = (t.match(LETTERS) || []).length;
    if (!alnum) return false;
    if (alnum / t.length < 0.55) return false;                       // «|a_~» y similares
    if (t.length === 1 && !SINGLE_OK.has(t) && !/\d/.test(t) && !(prevHasDigit && UNIT_SINGLE.has(t))) return false;
    if (/^(.)\1{3,}$/u.test(t)) return false;                        // «llll», «----»
    const min = /\d/.test(t) ? 35 : 50;                              // números y dosis: más permisivo
    if (conf != null && conf < min) return false;
    return true;
  }

  const trimJunk = s => s
    .replace(/^[^\p{L}\p{N}¿¡"(+#]+/u, '')
    .replace(/[^\p{L}\p{N}.,;:!?)"%°+/]+$/u, '');

  // Tesseract entrega el bloque de cada línea como copia: se reconoce por su caja
  const sameBox = (a, b) => !!a && !!b && a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
  function blockIndex(data, ln) {
    const bs = (data && data.blocks) || [];
    let i = ln.block ? bs.indexOf(ln.block) : -1;
    if (i < 0 && ln.block && ln.block.bbox) i = bs.findIndex(b => sameBox(b.bbox, ln.block.bbox));
    return i < 0 ? 0 : i;
  }

  // líneas con confianza: [{ text, conf, bbox?, block }]
  function linesWithConf(data) {
    const out = [];
    if (data && Array.isArray(data.lines) && data.lines.length) {
      for (const ln of data.lines) {
        let prevDigit = false;
        const keep = [];
        for (const w of ln.words || []) {
          const ok = goodWord(w.text, w.confidence, prevDigit);
          prevDigit = /\d/.test(w.text || '');
          if (!ok) continue;
          const t = trimJunk(w.text.trim());
          if (t) keep.push({ t, c: w.confidence == null ? 60 : w.confidence });
        }
        if (!keep.length) continue;
        const text = keep.map(k => k.t).join(' ');
        if (keep.length === 1 && text.length < 3 && !/\d/.test(text)) continue;   // una palabra de 1-2 letras: ruido
        out.push({ text, conf: keep.reduce((s, k) => s + k.c, 0) / keep.length, ...(ln.bbox ? { bbox: ln.bbox } : {}), block: blockIndex(data, ln) });
      }
    }
    return out;
  }

  // cuando solo hay texto plano
  function fromText(raw) {
    const keep = [];
    for (const l of String(raw || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
      const alnum = (l.match(LETTERS) || []).length;
      if (alnum < 3 || alnum / l.length < 0.55) continue;
      let prevDigit = false;
      const words = [];
      for (const w of l.split(/\s+/)) {
        if (goodWord(w, null, prevDigit)) { const t = trimJunk(w); if (t) words.push(t); }
        prevDigit = /\d/.test(w);
      }
      if (words.length) keep.push(words.join(' '));
    }
    return keep.join(' ').replace(/\s+/g, ' ').trim();
  }

  const fromLines = lines => linesWithConf({ lines }).map(l => l.text).join(' ').replace(/\s+/g, ' ').trim();

  function cleanLines(data) {
    const l = linesWithConf(data);
    if (l.length) return l.map(x => x.text);
    return String(data && data.text || '').split(/\r?\n/).map(x => fromText(x)).filter(Boolean);
  }
  function clean(data) {
    if (!data) return '';
    const t = linesWithConf(data).map(l => l.text).join(' ').replace(/\s+/g, ' ').trim();
    return t || fromText(data.text);
  }
  const avgConf = data => {
    const l = linesWithConf(data);
    return l.length ? l.reduce((s, x) => s + x.conf, 0) / l.length : 0;
  };

  // ¿el texto es creíble? (mínimo de letras y proporción)
  function plausible(text) {
    const t = String(text || '');
    const letters = (t.match(/\p{L}/gu) || []).length;
    const compact = t.replace(/\s/g, '').length;
    return letters >= 4 && compact > 0 && letters / compact >= 0.55;
  }

  // ---- votación entre varias pasadas ----
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return Math.max(m, n);
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const similar = (a, b) => { const na = norm(a), nb = norm(b); const L = Math.max(na.length, nb.length); return L > 0 && 1 - lev(na, nb) / L >= 0.78; };

  // passes: [[{text,conf},...], ...]  ->  [texto, ...] en orden de lectura
  // keep: devuelve { text, block } para leer por bloques
  function vote(passes, { keep = false } = {}) {
    const clusters = [];
    passes.forEach((lines, pi) => {
      lines.forEach((ln, li) => {
        let c = clusters.find(k => similar(k.rep, ln.text));
        if (!c) { c = { rep: ln.text, items: [], pos: pi * 1000 + li, block: ln.block || 0 }; clusters.push(c); }
        c.items.push(ln);
      });
    });
    const n = passes.length;
    const out = [];
    for (const c of clusters) {
      // la variante que más se repite; empate: la de mayor confianza
      const tally = new Map();
      for (const it of c.items) {
        const key = it.text;
        const t = tally.get(key) || { text: key, count: 0, conf: 0 };
        t.count++; t.conf = Math.max(t.conf, it.conf);
        tally.set(key, t);
      }
      const best = [...tally.values()].sort((a, b) => b.count - a.count || b.conf - a.conf)[0];
      const avg = c.items.reduce((s, x) => s + x.conf, 0) / c.items.length;
      // con varias pasadas, una línea aislada y poco confiable se descarta
      if (n > 1 && c.items.length < 2 && avg < 70) continue;
      out.push({ text: best.text, pos: c.pos, block: c.block });
    }
    const sorted = out.sort((a, b) => a.pos - b.pos);
    return keep ? sorted.map(o => ({ text: o.text, block: o.block })) : sorted.map(o => o.text);
  }

  // orden de lectura para texto disperso: filas de arriba abajo y, en cada fila, de izquierda a derecha
  function orderLines(lines) {
    const boxed = lines.filter(l => l.bbox), rest = lines.filter(l => !l.bbox);
    if (!boxed.length) return lines.slice();
    const hs = boxed.map(l => l.bbox.y1 - l.bbox.y0).sort((a, b) => a - b);
    const tol = hs[hs.length >> 1] / 2;
    const cy = l => (l.bbox.y0 + l.bbox.y1) / 2;
    const rows = [];
    for (const l of boxed.slice().sort((a, b) => cy(a) - cy(b))) {
      const r = rows[rows.length - 1];
      if (r && Math.abs(cy(l) - r.cy) < tol) r.items.push(l); else rows.push({ cy: cy(l), items: [l] });
    }
    return rows.flatMap(r => r.items.sort((a, b) => a.bbox.x0 - b.bbox.x0)).concat(rest);
  }

  // texto para la voz: las líneas de un bloque seguidas; entre bloques, una pausa
  function toSpeech(lines) {
    const out = [];
    for (const l of lines) {
      const cur = out[out.length - 1];
      if (cur && cur.block === l.block) cur.parts.push(l.text); else out.push({ block: l.block, parts: [l.text] });
    }
    return out.map((b, i) => { const t = b.parts.join(' '); return i < out.length - 1 && !/[.!?:;]$/.test(t) ? t + '.' : t; }).join('\n');
  }

  // ---- calidad de la imagen antes de leer: luz y nitidez (varianza del laplaciano) ----
  const LIGHT_MIN = 0.15, LIGHT_MAX = 0.93, SHARP_MIN = 60;   // nitidez medida en una imagen de lado mayor ≤ 320 px
  function quality(img) {
    const { data: d, width: w, height: h } = img, n = w * h;
    const g = new Float32Array(n);
    let sum = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) { const v = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]; g[i] = v; sum += v; }
    const light = sum / n / 255;
    let s1 = 0, s2 = 0, m = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      s1 += lap; s2 += lap * lap; m++;
    }
    const sharp = m ? s2 / m - (s1 / m) ** 2 : 0;
    const advice = light < LIGHT_MIN ? 'Falta luz, enciende la linterna o una lámpara.'
      : light > LIGHT_MAX ? 'Hay mucho brillo o un reflejo. Inclina un poco el celular.'
      : sharp < SHARP_MIN ? 'La imagen salió borrosa. Acércate al texto y mantén el celular quieto.' : '';
    return { light, sharp, dark: light < LIGHT_MIN, ok: !advice, advice };
  }

  // ---- corrección con diccionario ----
  let dict = null;
  const setDict = set => { dict = set; };
  async function loadDict(url) {
    if (dict) return dict;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      dict = new Set((await r.text()).split('\n'));
    } catch { /* sin diccionario: no se corrige */ }
    return dict;
  }
  const SUBS = [['0', 'o'], ['1', 'l'], ['1', 'i'], ['5', 's'], ['8', 'b'], ['6', 'g'], ['rn', 'm'], ['vv', 'w'], ['|', 'l']];
  const matchCase = (orig, fix) => (orig === orig.toUpperCase() && /[A-Z]/.test(orig) ? fix.toUpperCase() : /^[A-ZÁÉÍÓÚÑ]/.test(orig) ? fix.charAt(0).toUpperCase() + fix.slice(1) : fix);

  function fixToken(tok) {
    const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(tok);
    const core = m[2];
    if (!dict || core.length < 3) return tok;
    const low = core.toLowerCase();
    if (dict.has(low)) return tok;
    const hasDigit = /\d/.test(core), hasLetter = /\p{L}/u.test(core);
    // «500mg», «1,5», fechas: no tocar; solo palabras con dígitos o signos dentro de letras
    const lettersOnly = !hasDigit && /^[\p{L}]+$/u.test(core);
    if (hasDigit && !(hasLetter && /\p{L}[0-9]|[0-9]\p{L}/u.test(core)) ) return tok;
    if (hasDigit && /^\d+[.,]?\d*\s?(mg|mcg|ml|g|ui|%|l|kg)$/i.test(core)) return tok;
    for (const [from, to] of SUBS) {
      if (!low.includes(from)) continue;
      const cand = low.split(from).join(to);
      if (dict.has(cand)) return m[1] + matchCase(core, cand) + m[3];
    }
    return tok;
  }
  function correct(lines) {
    if (!dict) return lines;
    return lines.map(l => l.split(' ').map(fixToken).join(' '));
  }

  // ---- solo navegador: preprocesado (gris, contraste, umbral adaptativo) ----
  function preprocess(src, { maxSide = 1200, binarize = true, crop = null } = {}) {
    const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
    const cx = crop ? Math.round(sw * crop[0]) : 0, cy = crop ? Math.round(sh * crop[1]) : 0;
    const cw = crop ? Math.round(sw * crop[2]) : sw, ch = crop ? Math.round(sh * crop[3]) : sh;
    const k = Math.min(2, maxSide / Math.max(cw, ch));
    const w = Math.max(1, Math.round(cw * k)), h = Math.max(1, Math.round(ch * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, cx, cy, cw, ch, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h), d = img.data, n = w * h;
    const g = new Uint8ClampedArray(n);
    const hist = new Uint32Array(256);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const v = (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) | 0;
      g[i] = v; hist[v]++;
    }
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < n; i++) g[i] = Math.max(0, Math.min(255, ((g[i] - lo) * 255) / span));

    let outG = g;
    if (binarize) {
      const W1 = w + 1;
      const integ = new Int32Array(W1 * (h + 1));
      for (let y = 1; y <= h; y++) {
        let row = 0;
        for (let x = 1; x <= w; x++) {
          row += g[(y - 1) * w + (x - 1)];
          integ[y * W1 + x] = integ[(y - 1) * W1 + x] + row;
        }
      }
      const s = Math.max(15, (w / 14) | 0), half = s >> 1, t = 0.12;
      outG = new Uint8ClampedArray(n);
      for (let y = 0; y < h; y++) {
        const y1 = Math.max(0, y - half), y2 = Math.min(h - 1, y + half);
        for (let x = 0; x < w; x++) {
          const x1 = Math.max(0, x - half), x2 = Math.min(w - 1, x + half);
          const cnt = (x2 - x1 + 1) * (y2 - y1 + 1);
          const sum = integ[(y2 + 1) * W1 + x2 + 1] - integ[y1 * W1 + x2 + 1] - integ[(y2 + 1) * W1 + x1] + integ[y1 * W1 + x1];
          outG[y * w + x] = g[y * w + x] * cnt <= sum * (1 - t) ? 0 : 255;
        }
      }
    }
    for (let i = 0, p = 0; i < n; i++, p += 4) { d[p] = d[p + 1] = d[p + 2] = outG[i]; d[p + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  const api = { goodWord, fromLines, fromText, clean, cleanLines, linesWithConf, avgConf, plausible, vote, orderLines, toSpeech, quality, correct, fixToken, setDict, loadDict, preprocess, lev };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OCR = api;
})(typeof window !== 'undefined' ? window : globalThis);
