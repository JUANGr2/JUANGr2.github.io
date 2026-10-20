// Interpreta el texto leído de una caja de medicina: nombre, dosis, forma, lote y caducidad.
// Es conservador: ante la duda deja el dato vacío en lugar de inventarlo.
(function (root) {
  const MONTHS = { ene: 1, enero: 1, jan: 1, january: 1, feb: 2, febrero: 2, february: 2, mar: 3, marzo: 3, march: 3, abr: 4, abril: 4, apr: 4, april: 4,
    may: 5, mayo: 5, jun: 6, junio: 6, june: 6, jul: 7, julio: 7, july: 7, ago: 8, agosto: 8, aug: 8, august: 8, sep: 9, sept: 9, septiembre: 9, september: 9,
    oct: 10, octubre: 10, october: 10, nov: 11, noviembre: 11, november: 11, dic: 12, diciembre: 12, dec: 12, december: 12 };
  const FORMS = ['tabletas', 'tableta', 'comprimidos', 'comprimido', 'cápsulas', 'capsulas', 'cápsula', 'capsula', 'grageas', 'jarabe', 'solución', 'solucion',
    'suspensión', 'suspension', 'crema', 'gel', 'ungüento', 'unguento', 'pomada', 'gotas', 'inyectable', 'ampolletas', 'polvo', 'parches', 'supositorios',
    'óvulos', 'ovulos', 'aerosol', 'spray', 'colirio', 'sobres', 'tablets', 'capsules', 'syrup', 'cream', 'drops'];
  const NOISE = /(lote|\blot\b|batch|\bexp|\bcad|vence|venc|contiene|\bcada\b|v[ií]a\b|\buso\b|adulto|ni[ñn]os|agitar|conservar|mant[eé]ng|farmac|laborator|\breg\b|sanitario|consulte|m[eé]dico|prescrip|receta|precauc|temperatura|fecha|fabric|importa|distribu|\bpieza|contenido|neto|www|http|\bcon\b|\bpara\b|\bmanufact|made in|hecho en)/i;
  const UNIT_AFTER = /^\s*(mg|mcg|µg|ug|g|ml|ui|iu|%|l|kg)\b/i;

  const pad = n => String(n).padStart(2, '0');
  const fullYear = y => (y < 100 ? 2000 + y : y);
  const strip = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // devuelve { iso:'2027-05', year, month } o null
  function findExpiry(text, now = new Date()) {
    const t = String(text || '');
    const y0 = now.getFullYear();
    const plausible = y => y >= y0 - 15 && y <= y0 + 12;
    const labelRe = /\b(?:exp(?:ira|iry|\.)?|cad(?:ucidad|uca|\.)?|vence|venc(?:imiento)?|best\s*before|use\s*by|fecha\s*de\s*caducidad|f\.?\s*cad)(?![a-zA-ZáéíóúÁÉÍÓÚ])\s*[:.\-]?\s*([^\n]{0,26})/gi;
    const parse = (c, loose) => {
      let r;
      // MM/AA o MM/AAAA
      const re1 = /(?:^|[^\d])(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})(?!\d)/g;
      while ((r = re1.exec(c))) {
        const mo = +r[1], y = fullYear(+r[2]);
        const after = c.slice(r.index + r[0].length);
        if (mo < 1 || mo > 12 || !plausible(y)) continue;
        if (!loose || r[2].length === 4) {
          if (!loose || !UNIT_AFTER.test(after)) return { year: y, month: mo, iso: `${y}-${pad(mo)}` };
        }
      }
      // AAAA-MM
      if ((r = /(?:^|[^\d])(20\d{2})\s*[\/\-.]\s*(\d{1,2})(?!\d)/.exec(c)) && +r[2] >= 1 && +r[2] <= 12) {
        const y = +r[1];
        if (plausible(y) && !UNIT_AFTER.test(c.slice(r.index + r[0].length))) return { year: y, month: +r[2], iso: `${y}-${pad(+r[2])}` };
      }
      // MES AAAA
      const re3 = /\b([A-Za-zÁÉÍÓÚáéíóú]{3,10})\.?\s*[\/\-.]?\s*(\d{4}|\d{2})(?!\d)/g;
      while ((r = re3.exec(c))) {
        const mo = MONTHS[strip(r[1])];
        const y = fullYear(+r[2]);
        if (mo && plausible(y) && (!loose || r[2].length === 4)) return { year: y, month: mo, iso: `${y}-${pad(mo)}` };
      }
      return null;
    };
    // 1) con etiqueta (más fiable)
    let m;
    while ((m = labelRe.exec(t))) { const e = parse(m[1], false); if (e) return e; }
    // 2) sin etiqueta: solo fechas de 4 dígitos y plausibles, sin unidad pegada
    return parse(t, true);
  }

  // estado respecto a hoy: 'vencida' | 'por_vencer' | 'vigente' | 'desconocida' (el mes de caducidad cuenta completo)
  function expiryStatus(iso, now = new Date()) {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(iso || '');
    if (!m) return { status: 'desconocida' };
    const end = m[3] ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59) : new Date(+m[1], +m[2], 0, 23, 59, 59);
    const days = Math.floor((end - now) / 86400000);
    if (days < 0) return { status: 'vencida', days };
    if (days <= 60) return { status: 'por_vencer', days };
    return { status: 'vigente', days };
  }

  function findDoses(text) {
    const out = [];
    const re = /(\d+(?:[.,]\d+)?)\s?(mg\/ml|mg\/5\s?ml|mg|mcg|µg|ug|g|ml|ui|iu|%)(?![a-zA-Z])/gi;
    let m;
    while ((m = re.exec(text)) && out.length < 4) {
      const v = `${m[1].replace(',', '.')} ${m[2].toLowerCase().replace(/\s+/g, '')}`;
      if (!out.includes(v)) out.push(v);
    }
    return out;
  }

  // la forma que aparece primero en el texto
  function findForm(text) {
    const low = ' ' + String(text).toLowerCase() + ' ';
    let best = '', pos = Infinity;
    for (const f of FORMS) {
      const m = new RegExp('[^a-záéíóúñ]' + f + '[^a-záéíóúñ]').exec(low);
      if (m && m.index < pos) { pos = m.index; best = f; }
    }
    return best;
  }

  function findLot(text) {
    const m = /\b(?:lote|lot|batch|l)\s*[:.\-#]?\s*([A-Z0-9][A-Z0-9\-]{2,14})\b/i.exec(text);
    return m && /\d/.test(m[1]) ? m[1].toUpperCase() : '';
  }

  const isFormLine = l => FORMS.some(f => strip(l).trim() === strip(f));
  // nombre: primera línea limpia, corta y con letras; evita formas, dosis y datos de fabricante
  function guessName(lines) {
    for (const raw of lines) {
      const l = String(raw).replace(/[|_~]+/g, ' ').replace(/\s+/g, ' ').trim();
      const letters = (l.match(/\p{L}/gu) || []).length;
      if (letters < 4 || l.length > 40) continue;
      if (NOISE.test(l) || isFormLine(l)) continue;
      if (/\d{3,}/.test(l)) continue;
      if (/\d+\s?(mg|ml|g|%)/i.test(l)) continue;
      const words = l.split(' ').filter(w => /\p{L}/u.test(w)).slice(0, 3);
      if (words.length) return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
    return '';
  }

  // lines: arreglo de líneas (si no hay, se parte el texto)
  function parse(input, now = new Date()) {
    const lines = Array.isArray(input) ? input : String(input || '').split(/\r?\n|\s{3,}/);
    const text = lines.join('\n');
    const exp = findExpiry(text, now);
    const doses = findDoses(text);
    const form = findForm(text);
    const lot = findLot(text);
    const name = guessName(lines);
    const found = [name, doses[0], exp, form].filter(Boolean).length;
    return {
      name, dose: doses.join(' · '), form, lot,
      expiry: exp ? exp.iso : '',
      confidence: found >= 3 ? 'alta' : found === 2 ? 'media' : 'baja',
    };
  }

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function expiryPhrase(iso, now = new Date()) {
    const m = /^(\d{4})-(\d{2})/.exec(iso || '');
    if (!m) return 'No encontré la fecha de caducidad';
    const when = `${MESES[+m[2] - 1]} de ${m[1]}`;
    const st = expiryStatus(iso, now);
    if (st.status === 'vencida') return `Atención: caducó en ${when}. No la uses`;
    if (st.status === 'por_vencer') return `Caduca pronto, en ${st.days <= 1 ? 'menos de un día' : st.days + ' días'} (${when})`;
    return `Caduca en ${when}`;
  }

  // frase para decir en voz alta
  function speak(p, now = new Date()) {
    const parts = [];
    parts.push(p.name ? `Medicina: ${p.name}.` : 'No pude leer el nombre con claridad.');
    if (p.dose) parts.push(`Dosis indicada en la caja: ${p.dose}.`);
    if (p.form) parts.push(`Presentación: ${p.form}.`);
    parts.push(expiryPhrase(p.expiry, now) + '.');
    if (p.confidence === 'baja') parts.push('No estoy seguro de la lectura; verifica en la caja.');
    return parts.join(' ');
  }

  const api = { parse, findExpiry, expiryStatus, expiryPhrase, speak, findDoses, findForm, findLot, guessName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MedParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
