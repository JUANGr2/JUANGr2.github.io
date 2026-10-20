// Narrador de escena: convierte detecciones en frases correctas en español y solo habla cuando algo cambia.
// Usa seguimiento por IoU para no parpadear ni repetir, y un diccionario con género y plural reales.
const Scene = (() => {
  const HAS_DOM = typeof document !== 'undefined';

  // clase COCO -> [singular, plural, género]
  const N = {
    person: ['persona', 'personas', 'f'], bicycle: ['bicicleta', 'bicicletas', 'f'], car: ['auto', 'autos', 'm'], motorcycle: ['moto', 'motos', 'f'],
    airplane: ['avión', 'aviones', 'm'], bus: ['autobús', 'autobuses', 'm'], train: ['tren', 'trenes', 'm'], truck: ['camión', 'camiones', 'm'],
    boat: ['bote', 'botes', 'm'], 'traffic light': ['semáforo', 'semáforos', 'm'], 'fire hydrant': ['hidrante', 'hidrantes', 'm'],
    'stop sign': ['señal de alto', 'señales de alto', 'f'], 'parking meter': ['parquímetro', 'parquímetros', 'm'], bench: ['banca', 'bancas', 'f'],
    bird: ['pájaro', 'pájaros', 'm'], cat: ['gato', 'gatos', 'm'], dog: ['perro', 'perros', 'm'], horse: ['caballo', 'caballos', 'm'],
    sheep: ['oveja', 'ovejas', 'f'], cow: ['vaca', 'vacas', 'f'], elephant: ['elefante', 'elefantes', 'm'], bear: ['oso', 'osos', 'm'],
    zebra: ['cebra', 'cebras', 'f'], giraffe: ['jirafa', 'jirafas', 'f'], backpack: ['mochila', 'mochilas', 'f'], umbrella: ['paraguas', 'paraguas', 'm'],
    handbag: ['bolso', 'bolsos', 'm'], tie: ['corbata', 'corbatas', 'f'], suitcase: ['maleta', 'maletas', 'f'], frisbee: ['frisbi', 'frisbis', 'm'],
    skis: ['esquí', 'esquís', 'm'], snowboard: ['tabla de nieve', 'tablas de nieve', 'f'], 'sports ball': ['pelota', 'pelotas', 'f'],
    kite: ['cometa', 'cometas', 'f'], 'baseball bat': ['bate', 'bates', 'm'], 'baseball glove': ['guante de béisbol', 'guantes de béisbol', 'm'],
    skateboard: ['patineta', 'patinetas', 'f'], surfboard: ['tabla de surf', 'tablas de surf', 'f'], 'tennis racket': ['raqueta', 'raquetas', 'f'],
    bottle: ['botella', 'botellas', 'f'], 'wine glass': ['copa', 'copas', 'f'], cup: ['taza', 'tazas', 'f'], fork: ['tenedor', 'tenedores', 'm'],
    knife: ['cuchillo', 'cuchillos', 'm'], spoon: ['cuchara', 'cucharas', 'f'], bowl: ['tazón', 'tazones', 'm'], banana: ['plátano', 'plátanos', 'm'],
    apple: ['manzana', 'manzanas', 'f'], sandwich: ['sándwich', 'sándwiches', 'm'], orange: ['naranja', 'naranjas', 'f'], broccoli: ['brócoli', 'brócolis', 'm'],
    carrot: ['zanahoria', 'zanahorias', 'f'], 'hot dog': ['hot dog', 'hot dogs', 'm'], pizza: ['pizza', 'pizzas', 'f'], donut: ['dona', 'donas', 'f'],
    cake: ['pastel', 'pasteles', 'm'], chair: ['silla', 'sillas', 'f'], couch: ['sofá', 'sofás', 'm'], 'potted plant': ['planta', 'plantas', 'f'],
    bed: ['cama', 'camas', 'f'], 'dining table': ['mesa', 'mesas', 'f'], toilet: ['inodoro', 'inodoros', 'm'], tv: ['televisor', 'televisores', 'm'],
    laptop: ['computadora portátil', 'computadoras portátiles', 'f'], mouse: ['ratón', 'ratones', 'm'], remote: ['control remoto', 'controles remotos', 'm'],
    keyboard: ['teclado', 'teclados', 'm'], 'cell phone': ['celular', 'celulares', 'm'], microwave: ['microondas', 'microondas', 'm'],
    oven: ['horno', 'hornos', 'm'], toaster: ['tostadora', 'tostadoras', 'f'], sink: ['lavabo', 'lavabos', 'm'], refrigerator: ['refrigerador', 'refrigeradores', 'm'],
    book: ['libro', 'libros', 'm'], clock: ['reloj', 'relojes', 'm'], vase: ['florero', 'floreros', 'm'], scissors: ['tijeras', 'tijeras', 'f'],
    'teddy bear': ['oso de peluche', 'osos de peluche', 'm'], 'hair drier': ['secadora de pelo', 'secadoras de pelo', 'f'],
    toothbrush: ['cepillo de dientes', 'cepillos de dientes', 'm'],
  };
  const DANGER = new Set(['car', 'bus', 'truck', 'motorcycle', 'bicycle', 'train', 'dog', 'horse']);
  const NUMS = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'];

  const noun = cls => N[cls] || [cls, cls + 's', 'm'];
  const name = cls => noun(cls)[0];
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  // artículo indefinido/definido según género y número
  const indef = (g, plural, n) => (plural ? (n ? NUMS[n] || (g === 'f' ? 'muchas' : 'muchos') : (g === 'f' ? 'unas' : 'unos')) : (g === 'f' ? 'una' : 'un'));
  const def = (g, plural) => (plural ? (g === 'f' ? 'las' : 'los') : (g === 'f' ? 'la' : 'el'));

  // ---- color: nombre y concordancia ----
  const COLORS = [['rojo', 0], ['naranja', 25], ['amarillo', 50], ['verde', 110], ['turquesa', 175], ['azul', 215], ['morado', 270], ['rosa', 320], ['rojo', 360]];
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return [h, s, l];
  }
  // devuelve { base, tone } p. ej. { base:'azul', tone:'oscuro' } | { base:'gris', tone:'' }
  function colorParts(r, g, b) {
    const [h, s, l] = rgb2hsl(r, g, b);
    if (l < 0.13) return { base: 'negro', tone: '' };
    if (l > 0.9 && s < 0.4) return { base: 'blanco', tone: '' };
    if (s < 0.14) return { base: 'gris', tone: l > 0.65 ? 'claro' : l < 0.35 ? 'oscuro' : '' };
    let best = COLORS[0], bd = 999;
    for (const c of COLORS) { const d = Math.abs(h - c[1]); if (d < bd) { bd = d; best = c; } }
    let base = best[0], tone = '';
    if (base === 'naranja' && l < 0.35) { base = 'café'; }
    else if (base === 'rojo' && l > 0.7) base = 'rosa';
    else if (l < 0.28) tone = 'oscuro';
    else if (l > 0.75) tone = 'claro';
    return { base, tone };
  }
  const agree = (w, g, plural) => {
    let s = w;
    if (g === 'f' && /o$/.test(s)) s = s.slice(0, -1) + 'a';
    if (plural) s = /[aeiouáéíóú]$/.test(s) ? s + 's' : /z$/.test(s) ? s.slice(0, -1) + 'ces' : /s$/.test(s) && !/[áéíóú]/.test(s) ? s : s + 'es';
    return s;
  };
  // texto de color concordado: "roja oscura", "azules", "gris"
  function colorText(c, g, plural) {
    if (!c) return '';
    const parts = [agree(c.base, g, plural)];
    if (c.tone) parts.push(agree(c.tone, g, plural));
    return parts.join(' ');
  }
  const colorName = (r, g, b) => { const c = colorParts(r, g, b); return c.base + (c.tone ? ' ' + c.tone : ''); };

  // ---- muestreo de la imagen (solo en el navegador) ----
  const sampler = HAS_DOM ? document.createElement('canvas') : null;
  const sctx = HAS_DOM ? sampler.getContext('2d', { willReadFrequently: true }) : null;
  function dominant(video, x, y, w, h) {
    if (!HAS_DOM || !video || !video.videoWidth) return null;
    try {
      const vw = video.videoWidth, vh = video.videoHeight;
      const cx = Math.max(0, x + w * 0.25), cy = Math.max(0, y + h * 0.25);
      const cw = Math.max(2, Math.min(vw - cx, w * 0.5)), ch = Math.max(2, Math.min(vh - cy, h * 0.5));
      sampler.width = 8; sampler.height = 8;
      sctx.drawImage(video, cx, cy, cw, ch, 0, 0, 8, 8);
      const d = sctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      return [r / n, g / n, b / n];
    } catch { return null; }
  }
  function brightness(video) {
    if (!HAS_DOM || !video || !video.videoWidth) return null;
    try {
      sampler.width = 16; sampler.height = 12;
      sctx.drawImage(video, 0, 0, 16, 12);
      const d = sctx.getImageData(0, 0, 16, 12).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return s / (d.length / 4) / 255;
    } catch { return null; }
  }
  const lightLevel = b => (b == null ? null : b < 0.12 ? 'oscuro' : b < 0.3 ? 'poca' : b < 0.75 ? 'normal' : 'mucha');
  const lightSentence = l => (l === 'oscuro' ? 'Está muy oscuro.' : l === 'poca' ? 'Hay poca luz.' : l === 'mucha' ? 'Hay mucha luz.' : '');

  // ---- seguimiento por IoU ----
  let tracks = [], nextId = 1;
  const iou = (a, b) => {
    const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const u = a[2] * a[3] + b[2] * b[3] - inter;
    return u > 0 ? inter / u : 0;
  };
  function track(preds, now) {
    const used = new Set();
    for (const t of tracks) {
      let best = -1, bi = 0.25;
      preds.forEach((p, i) => {
        if (used.has(i) || p.class !== t.cls) return;
        const v = iou(t.bbox, p.bbox);
        if (v > bi) { bi = v; best = i; }
      });
      if (best >= 0) { used.add(best); t.bbox = preds[best].bbox; t.hits++; t.misses = 0; t.score = preds[best].score; }
      else t.misses++;
    }
    tracks = tracks.filter(t => t.misses <= 3);
    preds.forEach((p, i) => { if (!used.has(i)) tracks.push({ id: nextId++, cls: p.class, bbox: p.bbox, hits: 1, misses: 0, score: p.score, color: null, born: now, colors: [], carry: [] }); });
  }
  // estable: 3 aciertos, o 2 si ya pasó medio segundo (celulares lentos)
  const isStable = (t, now) => t.hits >= 3 || (t.hits >= 2 && now - t.born >= 500);

  const zoneOf = (cx, W) => (cx < W * 0.34 ? 'izq' : cx > W * 0.66 ? 'der' : 'fre');
  const distOf = area => (area > 0.35 ? 'muy cerca' : area > 0.12 ? 'cerca' : area > 0.03 ? 'a media distancia' : 'lejos');
  const DIST_RANK = { 'muy cerca': 0, cerca: 1, 'a media distancia': 2, lejos: 3 };
  const ZONE_INTRO = { fre: 'Al frente hay', izq: 'A tu izquierda hay', der: 'A tu derecha hay' };
  const ZONE_SHORT = { fre: 'al frente', izq: 'a tu izquierda', der: 'a tu derecha' };
  const centerX = (bbox, W, flipX) => (flipX ? W - (bbox[0] + bbox[2] / 2) : bbox[0] + bbox[2] / 2);
  const isMover = cls => cls === 'person' || DANGER.has(cls);      // las que se mueven: se avisa si cambian de lado, se acercan o se van

  // ---- nivel de detalle ----
  const LEVELS = {
    breve: { items: 2, clothes: false, carry: 0, colors: false, hint: false, moves: () => false, bye: () => false, byeEmpty: false },
    normal: { items: 3, clothes: true, carry: 1, colors: true, hint: true, moves: isMover, bye: isMover, byeEmpty: true },
    detallado: { items: 4, clothes: true, carry: 2, colors: true, hint: true, moves: () => true, bye: () => true, byeEmpty: true },
  };
  let level = LEVELS.normal;
  function configure({ verbosity } = {}) { if (LEVELS[verbosity]) level = LEVELS[verbosity]; }

  // agrupa pistas por zona+clase; sampler(x, y, w, h) -> [r, g, b] da el color de los objetos
  function groupsOf(list, W, H, sampler, withColor, flipX = false) {
    const map = new Map();
    for (const t of list) {
      const [, , w, h] = t.bbox;
      const zone = zoneOf(centerX(t.bbox, W, flipX), W), area = (w * h) / (W * H);
      const key = `${zone}:${t.cls}`;
      const g = map.get(key) || { key, zone, cls: t.cls, count: 0, area: 0, dist: 'lejos', color: null, tracks: [] };
      g.count++; g.tracks.push(t);
      if (area > g.area) { g.area = area; g.dist = distOf(area); }
      map.set(key, g);
    }
    const arr = [...map.values()].sort((a, b) => b.area - a.area);
    if (withColor && sampler) {
      arr.slice(0, 4).forEach(g => {
        if (g.cls === 'person' || g.area < 0.04) return;
        const t = g.tracks.reduce((m, x) => (x.bbox[2] * x.bbox[3] > m.bbox[2] * m.bbox[3] ? x : m), g.tracks[0]);
        if (!t.color) { const c = sampler(...t.bbox); if (c) t.color = colorParts(...c); }
        g.color = t.color;
      });
    }
    return arr;
  }

  // ---- personas: ropa de arriba y lo que llevan ----
  const CARRY = new Set(['backpack', 'handbag', 'suitcase', 'umbrella', 'cell phone', 'bottle', 'cup', 'book', 'laptop', 'tie', 'sports ball', 'skateboard', 'tennis racket']);
  // hasta 5 muestras por persona; gana el color más repetido (en empate, el más reciente)
  function sampleClothes(list, W, H, sampler) {
    for (const t of list) {
      const [x, y, w, h] = t.bbox;
      if (t.cls !== 'person' || t.misses || t.colors.length >= 5 || (w * h) / (W * H) < 0.03) continue;
      const c = sampler(x + 0.2 * w, y + 0.2 * h, 0.6 * w, 0.35 * h);
      if (c) t.colors.push(colorParts(...c));
    }
  }
  function clothesOf(t) {
    const tally = new Map();
    (t.colors || []).forEach((c, i) => { const k = c.base + '|' + c.tone; const e = tally.get(k) || { c, n: 0, last: -1 }; e.n++; e.last = i; tally.set(k, e); });
    const best = [...tally.values()].sort((a, b) => b.n - a.n || b.last - a.last)[0];
    return best ? best.c : null;
  }
  // un objeto va con la persona más cercana si su centro cae en la caja de ella (ensanchada un 15 %) y es más chico
  function attach(list) {
    const people = list.filter(t => t.cls === 'person');
    people.forEach(t => { t.carry = []; });
    const attached = new Set();
    for (const o of list) {
      if (!CARRY.has(o.cls)) continue;
      const [ox, oy, ow, oh] = o.bbox, cx = ox + ow / 2, cy = oy + oh / 2;
      let best = null, bd = Infinity;
      for (const p of people) {
        const [x, y, w, h] = p.bbox;
        if (ow * oh >= w * h || cx < x - 0.15 * w || cx > x + 1.15 * w || cy < y - 0.15 * h || cy > y + 1.15 * h) continue;
        const d = Math.hypot(cx - (x + w / 2), cy - (y + h / 2));
        if (d < bd) { bd = d; best = p; }
      }
      if (best) { best.carry.push(o); attached.add(o.id); }
    }
    people.forEach(t => t.carry.sort((a, b) => b.bbox[2] * b.bbox[3] - a.bbox[2] * a.bbox[3]));
    return attached;
  }
  function personAttrs(g, L) {
    if (g.cls !== 'person' || g.count !== 1) return [];
    const t = g.tracks[0], out = [];
    const c = L.clothes && g.area >= 0.03 ? clothesOf(t) : null;
    if (c) out.push(`vestida de ${colorText(c, 'm', false)}`);
    const items = (t.carry || []).slice(0, L.carry).map(o => { const [s, , ge] = noun(o.cls); return `${indef(ge, false)} ${s}`; });
    if (items.length) out.push(`con ${listJoin(items)}`);
    return out;
  }

  // cantidad: una, dos, tres, cuatro, varias (5 a 10), muchas (más de 10)
  const countWord = (g, n) => (n <= 1 ? indef(g, false) : n <= 4 ? NUMS[n] : n <= 10 ? (g === 'f' ? 'varias' : 'varios') : (g === 'f' ? 'muchas' : 'muchos'));
  const bucketOf = n => (n <= 4 ? n : n <= 10 ? 'varias' : 'muchas');

  // "una silla roja lejos", "dos sillas lejos", "una persona cerca, vestida de rojo, con una mochila"
  function phrase(g, { withDist = true, L = level } = {}) {
    const [sing, plur, gen] = noun(g.cls);
    const many = g.count > 1;
    const col = L.colors && g.color && g.color.base !== 'gris' ? colorText(g.color, gen, many) : '';
    const text = `${countWord(gen, g.count)} ${many ? plur : sing}${col ? ' ' + col : ''}${withDist ? ' ' + g.dist : ''}`;
    const attrs = personAttrs(g, L);
    return attrs.length ? `${text}, ${attrs.join(', ')}` : text;
  }
  // une varios: "a, b y c"
  const listJoin = a => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1]);

  // descripción completa por zonas (máx. «max» elementos en total)
  function describeGroups(groups, max = 3, L = level) {
    const by = { fre: [], izq: [], der: [] };
    groups.slice(0, Math.max(0, max)).forEach(g => by[g.zone].push(phrase(g, { L })));
    return ['fre', 'izq', 'der'].filter(z => by[z].length).map(z => `${ZONE_INTRO[z]} ${listJoin(by[z])}.`).join(' ');
  }
  const removedText = g => {
    const [sing, plur, gen] = noun(g.cls);
    const many = g.count > 1;
    return `${g.cls === 'person' ? (many ? 'a las personas' : 'a la persona') : `${def(gen, many)} ${many ? plur : sing}`}`;
  };

  // ---- pista de lugar ----
  const STREET_SIGNS = ['traffic light', 'stop sign', 'fire hydrant', 'parking meter'];
  const VEHICLES = ['car', 'bus', 'truck', 'motorcycle', 'bicycle'];
  const KITCHEN = ['refrigerator', 'oven', 'microwave', 'toaster', 'sink'];
  const TABLEWARE = ['cup', 'bowl', 'fork', 'knife', 'spoon', 'wine glass'];
  const OFFICE = ['laptop', 'keyboard', 'mouse'];
  const HINTS = { calle: 'Parece una calle.', cocina: 'Parece una cocina.', baño: 'Parece un baño.', dormitorio: 'Parece un dormitorio.', comedor: 'Parece un comedor.', sala: 'Parece una sala.', oficina: 'Parece una oficina.' };
  function placeHint(classes) {
    const s = new Set(classes), n = list => list.filter(c => s.has(c)).length;
    if (n(STREET_SIGNS) || n(VEHICLES) >= 2) return 'calle';
    if (n(KITCHEN) >= 2) return 'cocina';
    if (s.has('toilet') || (s.has('sink') && (s.has('toothbrush') || s.has('hair drier')))) return 'baño';
    if (s.has('bed')) return 'dormitorio';
    if (s.has('dining table') && (s.has('chair') || n(TABLEWARE))) return 'comedor';
    if ((s.has('couch') && (s.has('tv') || s.has('remote') || s.has('potted plant'))) || (s.has('tv') && s.has('remote'))) return 'sala';
    if (n(OFFICE) >= 2) return 'oficina';
    return null;
  }

  // ---- narración: memoria de lo dicho, por clase ----
  const ABSENT_MS = 4000, PERSIST_MS = 2000, LIGHT_PERSIST_MS = 3000, LIGHT_REARM_MS = 30000, HINT_PERSIST_MS = 5000, HINT_WINDOW_MS = 10000, MIN_GAP_MS = 2500;
  const DANGER_AREA = 0.2, DANGER_REPEAT_MS = 20000, DANGER_REARM_MS = 4000;
  let ann, seen, cand, danger, lightWarned, lightCand, lightSince, hintSaid, hintCand, hintSince, lastSpokeAt, firstDone, last;
  function reset() {
    tracks = []; nextId = 1;
    ann = new Map();       // clase -> { count, bucket, zone, dist } tal como se dijo
    seen = new Map();      // clase -> último instante en que se vio estable
    cand = new Map();      // 'clase:dato' -> { value, since }: cambio que aún no se confirma
    danger = new Map();    // clase -> { at, out }: último aviso y desde cuándo salió del peligro
    lightWarned = null; lightCand = undefined; lightSince = -Infinity;   // lightWarned: 'poca' u 'oscuro' ya dicho
    hintSaid = null; hintCand = undefined; hintSince = -Infinity;
    lastSpokeAt = -Infinity; firstDone = false;
    last = { visible: [], W: 1, H: 1, flipX: false, sampler: null, hint: null };
  }
  reset();

  // ¿el valor nuevo se mantuvo PERSIST_MS? Si vuelve al ya dicho, se olvida.
  function held(key, value, said, now) {
    if (value === said) { cand.delete(key); return false; }
    const c = cand.get(key);
    if (!c || c.value !== value) { cand.set(key, { value, since: now }); return false; }
    return now - c.since >= PERSIST_MS;
  }
  // resumen por clase: cantidad, zonas y la instancia más grande
  function classesOf(list, W, H, flipX) {
    const m = new Map();
    for (const t of list) {
      const area = (t.bbox[2] * t.bbox[3]) / (W * H), zone = zoneOf(centerX(t.bbox, W, flipX), W);
      const c = m.get(t.cls) || { cls: t.cls, count: 0, zones: new Set(), area: -1, zone, dist: 'lejos' };
      c.count++; c.zones.add(zone);
      if (area > c.area) { c.area = area; c.zone = zone; c.dist = distOf(area); }
      m.set(t.cls, c);
    }
    return m;
  }
  function announce(c) {
    ann.set(c.cls, { count: c.count, bucket: bucketOf(c.count), zone: c.zone, dist: c.dist, crowd: c.count >= 5 });
    for (const k of ['count', 'zone', 'dist']) cand.delete(c.cls + ':' + k);
  }
  const isCrowd = c => c.count >= 5 && c.zones.size >= 2;
  const crowdText = (c, intro) => { const [, plur, gen] = noun(c.cls); return `${intro} ${countWord(gen, c.count)} ${plur} a tu alrededor.`; };

  // Devuelve { hud, speak?, urgent?, label? }
  function update(preds, video, W, H, { speakNow = true, now = Date.now(), flipX = false, light, sample } = {}) {
    track(preds, now);
    const L = level;
    const sampler = sample || (HAS_DOM && video && video.videoWidth ? (x, y, w, h) => dominant(video, x, y, w, h) : null);
    const present = tracks.filter(t => isStable(t, now) && t.misses <= 2);
    for (const t of present) if (t.misses === 0) seen.set(t.cls, now);
    if (sampler && L.clothes) sampleClothes(present, W, H, sampler);
    const attached = attach(present);
    const visible = present.filter(t => !attached.has(t.id));    // lo que lleva una persona no se lista aparte
    const recent = [...seen].filter(([, t]) => now - t <= HINT_WINDOW_MS).map(([c]) => c);
    const hint = L.hint ? placeHint(recent) : null;
    last = { visible, W, H, flipX, sampler, hint };
    const allNow = groupsOf(tracks.filter(t => t.misses === 0), W, H, null, false, flipX);
    const hud = allNow.length ? describeGroups(allNow, L.items) : 'No detecto objetos claros.';

    // peligro inmediato: una vez por clase cada 20 s, o de nuevo si salió del peligro 4 s
    const dq = groupsOf(tracks.filter(t => t.hits >= 2 && t.misses === 0), W, H, null, false, flipX).find(g => DANGER.has(g.cls) && g.area > DANGER_AREA);
    for (const [k, st] of danger) if ((!dq || dq.cls !== k) && st.out == null) st.out = now;
    if (dq) {
      const st = danger.get(dq.cls);
      const rearmed = st && st.out != null && now - st.out >= DANGER_REARM_MS;
      if (!st || rearmed || now - st.at >= DANGER_REPEAT_MS) {
        danger.set(dq.cls, { at: now, out: null });
        ann.set(dq.cls, { count: dq.count, bucket: bucketOf(dq.count), zone: dq.zone, dist: dq.dist });
        seen.set(dq.cls, now);
        firstDone = true; lastSpokeAt = now;
        const [sing, , gen] = noun(dq.cls);
        return { hud, urgent: true, speak: `¡Cuidado! ${cap(indef(gen, false))} ${sing} ${dq.dist}, ${ZONE_SHORT[dq.zone]}.`, label: sing };
      }
      st.out = null;
    }
    if (!speakNow || (typeof Speech !== 'undefined' && Speech.busy)) return { hud };

    // luz: «muy oscuro» y «poca luz» son una familia: se dice la primera (si se mantiene 3 s) y después solo
    // si empeora; vuelve a avisarse tras 30 s seguidos de luz normal (o al reabrir la cámara)
    const lv = light !== undefined ? light : lightLevel(brightness(video));
    if (lv !== lightCand) { lightCand = lv; lightSince = now; }
    let lightMsg = '';
    if (lv && now - lightSince >= LIGHT_PERSIST_MS) {
      if (lv === 'oscuro' || lv === 'poca') {
        if (!lightWarned || (lv === 'oscuro' && lightWarned === 'poca')) lightMsg = lightSentence(lv);
      } else if (lightWarned && now - lightSince >= LIGHT_REARM_MS) lightWarned = null;
    }
    if (hint !== hintCand) { hintCand = hint; hintSince = now; }

    const cls = classesOf(visible, W, H, flipX);
    const msgs = [];                                                // { pri, text, apply }
    const fresh = [...cls.values()].filter(c => !ann.has(c.cls));
    if (fresh.length) {
      const crowds = fresh.filter(isCrowd), crowdSet = new Set(crowds.map(c => c.cls)), freshSet = new Set(fresh.map(c => c.cls));
      const groups = groupsOf(visible.filter(t => freshSet.has(t.cls) && !crowdSet.has(t.cls)), W, H, sampler, L.colors, flipX);
      let text, withHint = false;
      if (!firstDone) {
        withHint = !!hint;
        text = [...crowds.map(c => crowdText(c, 'Hay')), describeGroups(groups, L.items - crowds.length), withHint ? HINTS[hint] : ''].filter(Boolean).join(' ');
      } else {
        const byZone = {};
        groups.slice(0, L.items).forEach(g => (byZone[g.zone] = byZone[g.zone] || []).push(phrase(g)));
        const zoned = Object.entries(byZone).map(([z, ph]) => `${listJoin(ph)}${ph.some(x => x.includes(',')) ? ',' : ''} ${ZONE_SHORT[z]}`);
        text = [...crowds.map(c => crowdText(c, 'Ahora hay')), zoned.length ? `Ahora hay ${listJoin(zoned)}.` : ''].filter(Boolean).join(' ');
      }
      msgs.push({ pri: 0, text, apply: () => { fresh.forEach(announce); firstDone = true; if (withHint) hintSaid = hint; } });
    }
    for (const c of cls.values()) {
      const a = ann.get(c.cls);
      if (!a) continue;
      const [sing, plur, gen] = noun(c.cls);
      const b = bucketOf(c.count);
      if (held(c.cls + ':count', b, a.bucket, now)) {
        if (a.crowd && c.count > 2) { announce(c); ann.get(c.cls).crowd = true; }   // multitud ya dicha: no se vuelve a contar, salvo que queden dos o menos
        else {
          const where = c.zones.size > 1 ? 'a tu alrededor' : ZONE_SHORT[c.zone];
          msgs.push({ pri: 1, text: `Ahora hay ${countWord(gen, c.count)} ${c.count > 1 ? plur : sing} ${where}.`, apply: () => announce(c) });
        }
      }
      if (c.count !== 1 || a.count !== 1) continue;
      const moves = L.moves(c.cls);
      if (held(c.cls + ':zone', c.zone, a.zone, now)) {
        if (moves) msgs.push({ pri: 2, text: `${cap(def(gen, false))} ${sing} ahora está ${ZONE_SHORT[c.zone]}.`, apply: () => { a.zone = c.zone; cand.delete(c.cls + ':zone'); } });
        else { a.zone = c.zone; cand.delete(c.cls + ':zone'); }      // sin aviso en este nivel
      }
      if (held(c.cls + ':dist', c.dist, a.dist, now)) {
        if (moves && DIST_RANK[c.dist] < DIST_RANK[a.dist] && DIST_RANK[c.dist] <= 1) {
          msgs.push({ pri: 2, text: `${cap(def(gen, false))} ${sing} se acerca, ahora está ${c.dist}.`, apply: () => { a.dist = c.dist; cand.delete(c.cls + ':dist'); } });
        } else { a.dist = c.dist; cand.delete(c.cls + ':dist'); }      // alejarse: en silencio
      }
    }
    // lo que se fue (más de 4 s sin verlo)
    const gone = [...ann.keys()].filter(k => !cls.has(k) && now - (seen.has(k) ? seen.get(k) : -Infinity) > ABSENT_MS);
    if (gone.length) {
      const bye = k => removedText({ cls: k, count: ann.get(k).count });
      const drop = ks => () => ks.forEach(k => ann.delete(k));
      if (!cls.size && L.byeEmpty) msgs.push({ pri: 3, text: gone.length > 1 ? 'Ya no veo objetos.' : `Ya no veo ${bye(gone[0])}.`, apply: drop(gone) });
      else {
        const said = gone.filter(L.bye);
        gone.filter(k => !L.bye(k)).forEach(k => ann.delete(k));    // en silencio en este nivel
        if (said.length) msgs.push({ pri: 3, text: `Ya no veo ${listJoin(said.slice(0, 2).map(bye))}.`, apply: drop(said) });
      }
    }
    // pista de lugar nueva, si se mantiene 5 s
    if (firstDone && hint && hint !== hintSaid && now - hintSince >= HINT_PERSIST_MS) msgs.push({ pri: 4, text: HINTS[hint], apply: () => { hintSaid = hint; } });

    msgs.sort((x, y) => x.pri - y.pri);
    const chosen = msgs.slice(0, 2);
    const text = [lightMsg, ...chosen.map(m => m.text)].filter(Boolean).join(' ');
    if (!text || now - lastSpokeAt < MIN_GAP_MS) return { hud };
    chosen.forEach(m => m.apply());
    if (lightMsg) lightWarned = lv;
    lastSpokeAt = now;
    const top = [...cls.values()].sort((x, y) => y.area - x.area)[0];
    return { hud, speak: text, label: top ? name(top.cls) : 'escena' };
  }

  // resumen para «¿Qué hay?»: todo lo presente, aunque ya se haya dicho (al menos con detalle normal)
  function summary() {
    const L = level === LEVELS.breve ? LEVELS.normal : level;
    const { visible, W, H, flipX, sampler, hint } = last;
    const groups = groupsOf(visible, W, H, sampler, L.colors, flipX);
    if (!groups.length) return 'No veo objetos claros ahora.';
    const crowds = [...classesOf(visible, W, H, flipX).values()].filter(isCrowd), crowdSet = new Set(crowds.map(c => c.cls));
    return [...crowds.map(c => crowdText(c, 'Hay')), describeGroups(groups.filter(g => !crowdSet.has(g.cls)), L.items - crowds.length, L), hint ? HINTS[hint] : ''].filter(Boolean).join(' ');
  }

  // color central para el modo «Color»
  function centerColor(video) {
    if (!video || !video.videoWidth) return null;
    const vw = video.videoWidth, vh = video.videoHeight;
    const c = dominant(video, vw * 0.4, vh * 0.4, vw * 0.2, vh * 0.2);
    if (!c) return null;
    const p = colorParts(...c);
    const l = lightLevel(brightness(video));
    return { name: p.base + (p.tone ? ' ' + p.tone : ''), rgb: c.map(Math.round), light: l ? { oscuro: 'muy oscuro', poca: 'poca luz', normal: 'luz normal', mucha: 'mucha luz' }[l] : null };
  }

  // frase de alerta para el modo «Alerta»: ¡Cuidado! Un auto muy cerca, a tu derecha.
  function alertPhrase(cls, area, cx, W) {
    const [sing, , gen] = noun(cls);
    return `¡Cuidado! ${cap(indef(gen, false))} ${sing} ${area > 0.35 ? 'muy cerca' : 'cerca'}, ${ZONE_SHORT[zoneOf(cx, W)]}.`;
  }

  // descripción sin estado (demo de la landing y pruebas)
  function describe(preds, W, H, video) {
    const ts = preds.map((p, i) => ({ id: i, cls: p.class, bbox: p.bbox, hits: 3, misses: 0, score: p.score, color: null }));
    const sampler = HAS_DOM && video && video.videoWidth ? (x, y, w, h) => dominant(video, x, y, w, h) : null;
    return describeGroups(groupsOf(ts, W, H, sampler, !!sampler));
  }

  return { update, reset, configure, summary, placeHint, centerColor, name, describe, alertPhrase, DANGER, NOUNS: N, _t: { colorName, colorText, phrase, listJoin, lightSentence } };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Scene;
