// Recorrido inmersivo de la landing: una línea guía de pavimento táctil en 3D.
// Al hacer scroll avanzas por ella; en cada parada los puntos se levantan del suelo y forman lo que hace la app.
// Módulo ES cargado desde home.js. Three.js se sirve desde /vendor (sin CDN, funciona sin internet).
import * as THREE from '/vendor/three/three.module.min.js';

const D = 14;             // distancia entre paradas
const ARC_X = 1.1;        // origen de las ondas del logo dentro de la figura del ojo
const FONT = '"Atkinson Hyperlegible Next", system-ui, sans-serif';
const PI = Math.PI;

// ---------- azar reproducible y muestreo de formas ----------
function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const J = (r, a) => (r() - 0.5) * 2 * a;
const jit = (fn, a, az = a) => r => { const p = fn(r); return [p[0] + J(r, a), p[1] + J(r, a), p[2] + J(r, az)]; };
function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1], 0];
}
// muestreo uniforme a lo largo de una línea quebrada
function polyline(pts) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] || 0) - (a[2] || 0));
    segs.push([a, b, l]); total += l;
  }
  return r => {
    let d = r() * total;
    for (const [a, b, l] of segs) {
      if (d <= l) { const t = l ? d / l : 0; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * t]; }
      d -= l;
    }
    const [, b] = segs[segs.length - 1];
    return [b[0], b[1], b[2] || 0];
  };
}
const curve = (fn, steps = 72) => polyline(Array.from({ length: steps + 1 }, (_, i) => fn(i / steps)));
const disc = (cx, cy, rad, z = 0) => r => { const a = r() * 2 * PI, d = Math.sqrt(r()) * rad; return [cx + Math.cos(a) * d, cy + Math.sin(a) * d, z]; };
const ring = (cx, cy, r1, r2, z = 0) => r => { const a = r() * 2 * PI, d = r1 + (r2 - r1) * r(); return [cx + Math.cos(a) * d, cy + Math.sin(a) * d, z]; };
const sphere = (cx, cy, cz, rad) => r => { const u = r() * 2 - 1, a = r() * 2 * PI, s = Math.sqrt(1 - u * u); return [cx + rad * s * Math.cos(a), cy + rad * u, cz + rad * s * Math.sin(a)]; };
const cyl = (cx, cy, cz, rad, h) => r => { const a = r() * 2 * PI; return [cx + Math.cos(a) * rad, cy + (r() - 0.5) * h, cz + Math.sin(a) * rad]; };
function boxSurf(cx, cy, cz, w, h, d) {
  const A = [w * h, w * h, w * d, w * d, h * d, h * d], T = A.reduce((s, a) => s + a, 0);
  return r => {
    let x = r() * T, f = 0;
    while (f < 5 && x > A[f]) { x -= A[f]; f++; }
    const u = r() - 0.5, v = r() - 0.5;
    switch (f) {
      case 0: return [cx + u * w, cy + v * h, cz + d / 2];
      case 1: return [cx + u * w, cy + v * h, cz - d / 2];
      case 2: return [cx + u * w, cy + h / 2, cz + v * d];
      case 3: return [cx + u * w, cy - h / 2, cz + v * d];
      case 4: return [cx + w / 2, cy + u * h, cz + v * d];
      default: return [cx - w / 2, cy + u * h, cz + v * d];
    }
  };
}
const cloud = (rad, flat = 0.6) => r => { const u = r() * 2 - 1, a = r() * 2 * PI, d = Math.cbrt(r()) * rad, s = Math.sqrt(1 - u * u); return [d * s * Math.cos(a), d * u * 0.7, d * s * Math.sin(a) * flat]; };

// reparte n puntos entre las partes según su peso; marca: ver MARCAS en el sombreador
function build(n, parts, seed) {
  const r = rng(seed), out = new Float32Array(n * 4);
  const total = parts.reduce((s, p) => s + p.w, 0);
  let k = 0;
  parts.forEach((p, i) => {
    const cnt = i === parts.length - 1 ? n - k : Math.round(n * p.w / total);
    for (let j = 0; j < cnt && k < n; j++, k++) { const q = p.at(r); out[k * 4] = q[0]; out[k * 4 + 1] = q[1]; out[k * 4 + 2] = q[2]; out[k * 4 + 3] = p.f || 0; }
  });
  // orden aleatorio: en cada cambio cada punto viaja a un lugar distinto
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    for (let c = 0; c < 4; c++) { const t = out[i * 4 + c]; out[i * 4 + c] = out[j * 4 + c]; out[j * 4 + c] = t; }
  }
  return out;
}

// ---------- figuras de cada parada ----------
// MARCAS: 0 normal · 1 pupila que mira · 2 contorno del ojo · 3 ondas del logo · 4 caja con barrido
//         5 anillos de sonido · 6 ondas que se expanden · 7 resaltado · 8 tenue · 9 acento · 10 alerta
function eyeShape(n) {
  const P = (x, y) => [(x - 16) / 7, -(y - 16) / 7];
  const up = curve(t => cubic(P(2, 16), P(8, 6), P(24, 6), P(30, 16), t));
  const lo = curve(t => cubic(P(30, 16), P(24, 26), P(8, 26), P(2, 16), t));
  const arc = R => curve(t => { const a = (-45 + 90 * t) * PI / 180; return [2 + Math.cos(a) * R, Math.sin(a) * R, 0]; });
  const parts = [
    { w: 0.17, at: jit(up, 0.045, 0.08), f: 2 }, { w: 0.17, at: jit(lo, 0.045, 0.08), f: 2 },
    { w: 0.14, at: disc(0, 0, 0.62, 0.14), f: 1 }, { w: 0.08, at: ring(0, 0, 0.8, 0.93, 0.07), f: 1 },
    { w: 0.07, at: jit(arc(0.71), 0.045), f: 3 }, { w: 0.08, at: jit(arc(1.29), 0.045), f: 3 }, { w: 0.09, at: jit(arc(1.86), 0.045), f: 3 },
    { w: 0.2, at: cloud(5.6), f: 8 },
  ];
  const out = build(n, parts, 11);
  for (let i = 0; i < n; i++) out[i * 4] -= 2 - ARC_X;   // centrado: ojo a la izquierda, ondas a la derecha
  return out;
}

function personAt(x, y) {
  const head = disc(x, y + 0.37, 0.16);
  const body = r => {
    for (;;) {
      const u = (r() - 0.5) * 0.56, v = r() * 0.52, top = 0.17;
      if (v < top) { const dx = Math.abs(u) - (0.28 - top); if (dx > 0 && dx * dx + (top - v) * (top - v) > top * top) continue; }
      return [x + u, y + 0.13 - v, 0];
    }
  };
  return r => (r() < 0.3 ? head(r) : body(r));
}
function peopleShape(n) {
  const cols = 6, rows = 4, HI = new Set([3, 8, 14, 21]);   // 4 de 24: una de cada seis personas
  const parts = [];
  for (let i = 0; i < cols * rows; i++) {
    const c = i % cols, row = Math.floor(i / cols);
    parts.push({ w: HI.has(i) ? 1.25 : 1, at: jit(personAt((c - (cols - 1) / 2) * 0.95, ((rows - 1) / 2 - row) * 1.36), 0.012, 0.1), f: HI.has(i) ? 7 : 8 });
  }
  return build(n, parts, 23);
}

// esquina en puntos: los mismos objetos que reconoce la IA de la app
const STREET_ANCHORS = [
  { cls: 'car', p: [-1.4, 0.9, 1.0] }, { cls: 'traffic light', p: [1.0, 2.25, 0.15] }, { cls: 'person', p: [1.85, 1.45, -0.45] },
  { cls: 'bench', p: [-0.55, 0.8, -0.9] }, { cls: 'tree', p: [-2.15, 2.05, -0.6] }, { cls: 'building', p: [-1.15, 2.95, -2.0] },
  { cls: 'crossing', p: [0.15, 0.2, 1.0] },
];
function streetShape(n) {
  const parts = [
    { w: 0.09, at: r => [J(r, 2.8), 0, 1.0 + J(r, 0.7)], f: 8 },                                  // calzada
    { w: 0.07, at: r => { const s = Math.floor(r() * 6); return [-0.45 + s * 0.2 + J(r, 0.05), 0.01, 1.0 + J(r, 0.62)]; } }, // paso peatonal
    { w: 0.05, at: r => [J(r, 2.8), 0.06, 0.3], f: 8 }, { w: 0.07, at: r => [J(r, 2.8), 0.04, -1.1 + J(r, 1.4)], f: 8 }, // bordillo y acera
    { w: 0.17, at: boxSurf(-1.15, 1.3, -2.0, 2.3, 2.6, 1.2) }, { w: 0.1, at: boxSurf(1.6, 1.0, -2.1, 1.5, 2.0, 1.0) },  // edificios
    { w: 0.02, at: boxSurf(-1.05, 0.45, -1.39, 0.42, 0.9, 0.02), f: 9 },                                // puerta
    { w: 0.08, at: boxSurf(-1.4, 0.32, 1.0, 1.3, 0.36, 0.62), f: 9 }, { w: 0.04, at: boxSurf(-1.48, 0.64, 1.0, 0.72, 0.3, 0.56), f: 9 }, // auto
    { w: 0.03, at: cyl(1.0, 0.95, 0.15, 0.04, 1.9) }, { w: 0.025, at: boxSurf(1.0, 2.0, 0.15, 0.18, 0.5, 0.18) },  // semáforo
    { w: 0.008, at: sphere(1.0, 2.15, 0.25, 0.05), f: 10 }, { w: 0.008, at: sphere(1.0, 1.85, 0.25, 0.05), f: 9 },
    { w: 0.07, at: r => { const t = r(); return t < 0.32 ? sphere(1.85, 1.22, -0.45, 0.15)(r) : cyl(1.85, 0.55, -0.45, 0.15, 0.9)(r); } }, // persona
    { w: 0.05, at: r => (r() < 0.5 ? boxSurf(-0.55, 0.45, -0.9, 0.9, 0.06, 0.3)(r) : boxSurf(-0.55, 0.68, -1.04, 0.9, 0.3, 0.04)(r)) }, // banca
    { w: 0.02, at: cyl(-2.15, 0.5, -0.6, 0.07, 1.0) }, { w: 0.09, at: sphere(-2.15, 1.55, -0.6, 0.55) },        // árbol
  ];
  return build(n, parts, 31);
}

function boxShape(n) {
  const lines = [[0.42, 1.9, 0.09], [0.14, 1.5, 0.05], [-0.1, 1.7, 0.05], [-0.34, 1.0, 0.05]];
  const capsule = (cx, cy, cz, rot) => r => {
    const t = r(), a = r() * 2 * PI, x = (t - 0.5) * 0.7, rad = 0.13 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(x) / 0.36, 6)));
    const y = Math.cos(a) * rad, z = Math.sin(a) * rad, c = Math.cos(rot), s = Math.sin(rot);
    return [cx + x * c - y * s, cy + x * s + y * c, cz + z];
  };
  const parts = [
    { w: 0.52, at: boxSurf(0, 0, 0, 2.6, 1.55, 0.9), f: 4 },
    ...lines.map(([y, len, th]) => ({ w: 0.06 * len, at: r => [-1.2 + r() * len, y + J(r, th / 2), 0.46], f: 9 })),
    { w: 0.04, at: r => (r() < 0.5 ? [0.9 + J(r, 0.22), 0.3 + J(r, 0.06), 0.47] : [0.9 + J(r, 0.06), 0.3 + J(r, 0.22), 0.47]), f: 10 }, // cruz de farmacia
    { w: 0.05, at: capsule(-1.0, -1.25, 0.9, 0.5) }, { w: 0.05, at: capsule(0.4, -1.3, 1.1, -0.3), f: 9 }, { w: 0.05, at: capsule(1.55, -1.05, 0.5, 1.1) },
  ];
  return build(n, parts, 41);
}

function wavesShape(n) {
  const parts = [{ w: 0.06, at: disc(0, 0, 0.24, 0), f: 9 }];
  for (let i = 0; i < 7; i++) { const R = 0.5 + i * 0.4; parts.push({ w: R, at: jit(ring(0, 0, R - 0.03, R + 0.03), 0.01, 0.03), f: 5 }); }
  return build(n, parts, 53);
}

function bubbleShape(n) {
  const W = 4.2, H = 2.6, R = 0.7, cy = 0.3, pts = [];
  const corner = (cx, cyy, a0) => { for (let i = 0; i <= 10; i++) { const a = a0 + (i / 10) * PI / 2; pts.push([cx + Math.cos(a) * R, cyy + Math.sin(a) * R, 0]); } };
  const x0 = -W / 2, x1 = W / 2, y0 = cy - H / 2, y1 = cy + H / 2;
  corner(x1 - R, y1 - R, 0); corner(x0 + R, y1 - R, PI / 2); corner(x0 + R, y0 + R, PI);
  pts.push([x0 + 0.95, y0, 0], [x0 + 0.45, y0 - 0.9, 0], [x0 + 1.55, y0, 0]);   // cola del globo
  corner(x1 - R, y0 + R, 1.5 * PI); pts.push(pts[0]);
  const parts = [
    { w: 0.55, at: jit(polyline(pts), 0.04, 0.08) },
    ...[-0.85, 0, 0.85].map(x => ({ w: 0.08, at: disc(x, cy, 0.24, 0.05), f: 9 })),
    { w: 0.21, at: r => [J(r, W / 2 - 0.3), cy + J(r, H / 2 - 0.3), J(r, 0.2)], f: 8 },
  ];
  return build(n, parts, 61);
}

function pinShape(n) {
  const c = [0, 0.9], R = 1.15, tip = [0, -1.7];
  const ang = Math.asin(R / (c[1] - tip[1]));       // tangentes desde la punta
  const pts = [];
  const start = -PI / 2 + (PI / 2 - ang), end = 1.5 * PI - (PI / 2 - ang);
  for (let i = 0; i <= 60; i++) { const a = start + (end - start) * (i / 60); pts.push([c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R, 0]); }
  const outline = polyline([tip, ...pts, tip]);
  const ripple = ph => r => { const a = r() * 2 * PI; return [Math.cos(a), ph + J(r, 0.01), Math.sin(a)]; };
  const parts = [
    { w: 0.46, at: jit(outline, 0.04, 0.08), f: 10 },
    { w: 0.16, at: ring(c[0], c[1], 0.38, 0.5, 0.05) },
    { w: 0.1, at: ripple(0), f: 6 }, { w: 0.1, at: ripple(0.33), f: 6 }, { w: 0.1, at: ripple(0.66), f: 6 },
    { w: 0.08, at: r => [J(r, 0.9), c[1] + J(r, 0.9), J(r, 0.3)], f: 8 },
  ];
  return build(n, parts, 71);
}

function shieldShape(n) {
  const outline = curve(t => {
    // contorno del escudo: arriba recto, laterales y punta inferior
    const per = t * 4;
    if (per < 1) return [-1.6 + 3.2 * per, 1.7 + 0.12 * Math.sin(per * PI), 0];
    if (per < 2) return [1.6, 1.7 - 1.7 * (per - 1), 0];
    if (per < 3) { const q = per - 2; return cubic([1.6, 0], [1.6, -1.1], [0.8, -1.7], [0, -2.15], q); }
    const q = per - 3; return cubic([0, -2.15], [-0.8, -1.7], [-1.6, -1.1], [-1.6, 0], q);
  }, 160);
  const left = polyline([[-1.6, 0, 0], [-1.6, 1.7, 0]]);
  const check = polyline([[-0.85, 0.05, 0.05], [-0.22, -0.62, 0.05], [0.95, 0.88, 0.05]]);
  const parts = [
    { w: 0.42, at: jit(outline, 0.04, 0.08) }, { w: 0.08, at: jit(left, 0.04, 0.08) },
    { w: 0.3, at: jit(check, 0.09, 0.06), f: 9 },
    { w: 0.2, at: r => { for (;;) { const x = J(r, 1.5), y = -2 + r() * 3.6; if (y > -0.2 || Math.abs(x) < 1.5 * (1 - (-0.2 - y) / 1.9)) return [x, y, J(r, 0.25)]; } }, f: 8 },
  ];
  return build(n, parts, 83);
}

// texto hecho de puntos (la misma tipografía de la página)
function textShape(n, text, flag, seed, maxW = 4.4) {
  const W = 720, H = 260, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  let size = 200;
  const setFont = () => { g.font = `800 ${size}px ${FONT}`; };
  setFont();
  while (g.measureText(text).width > W * 0.9 && size > 40) { size -= 8; setFont(); }
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, W / 2, H / 2 + size * 0.05);
  const data = g.getImageData(0, 0, W, H).data, pts = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (data[(y * W + x) * 4 + 3] > 140) pts.push(x, y);
  const scale = Math.min(maxW / Math.max(1, g.measureText(text).width), 2.6 / size);
  const r = rng(seed), out = new Float32Array(n * 4), cnt = Math.max(1, pts.length / 2);
  for (let i = 0; i < n; i++) {
    const k = Math.floor(r() * cnt) * 2;
    out[i * 4] = ((pts[k] || W / 2) - W / 2 + J(r, 1)) * scale;
    out[i * 4 + 1] = -((pts[k + 1] || H / 2) - H / 2 + J(r, 1)) * scale;
    out[i * 4 + 2] = J(r, 0.12);
    out[i * 4 + 3] = flag;
  }
  return out;
}

// ---------- suelo: barras guía, botones de alerta en cada parada y textura de asfalto ----------
function groundData(stops, q) {
  const r = rng(77), pos = [], kind = [], rnd = [];
  const zStart = 9, zEnd = -(stops - 1) * D - 26;
  const add = (x, y, z, k) => { pos.push(x, y, z); kind.push(k); rnd.push(r()); };
  const pads = Array.from({ length: stops }, (_, i) => -i * D);
  const per = q > 0.7 ? 8 : 5;
  for (let z = zStart; z > zEnd; z -= 0.62) {
    if (pads.some(p => Math.abs(z - p) < 0.7)) continue;
    for (const x of [-0.375, -0.125, 0.125, 0.375]) for (let k = 0; k < per; k++) add(x + J(r, 0.008), 0.012, z - k * (0.42 / (per - 1)), 1);
  }
  for (const p of pads) for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) add(-0.4375 + i * 0.125, 0.02, p - 0.4375 + j * 0.125, 2);
  for (let z = zStart; z > zEnd; z -= 0.34) for (const x of [-2.6, 2.6]) add(x + J(r, 0.03), 0, z, 3);
  const speck = Math.round(4600 * q);
  for (let i = 0; i < speck; i++) add(J(r, 12), 0, zStart + (zEnd - zStart) * r(), 0);
  return { pos: new Float32Array(pos), kind: new Float32Array(kind), rnd: new Float32Array(rnd) };
}

// ---------- sombreadores ----------
const FRAG = /* glsl */`
varying vec3 vColor; varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5; float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.06, d);
  float lit = 0.82 + 0.35 * (1.0 - smoothstep(0.0, 0.45, length(c - vec2(-0.12, -0.14))));   // relieve de domo
  gl_FragColor = vec4(vColor * lit, a * vAlpha);
}`;

const GROUND_VERT = /* glsl */`
uniform float uRise, uSize, uPR, uFogNear, uFogFar, uAlpha, uPush;
uniform vec2 uPointer; uniform vec3 uDome, uSpeck;
attribute float aKind; attribute float aRand;
varying vec3 vColor; varying float vAlpha;
void main() {
  vec3 p = position;
  float delay = clamp((9.0 - p.z) * 0.006, 0.0, 0.9) + aRand * 0.15;
  float r = clamp((uRise * 1.6 - delay) / 0.5, 0.0, 1.0); r = r * r * (3.0 - 2.0 * r);
  p.y = mix(-0.35, p.y, r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vec2 ndc = gl_Position.xy / gl_Position.w;
  float near = uPush * smoothstep(0.32, 0.0, distance(ndc, uPointer));
  float base = aKind < 0.5 ? 1.0 : (aKind < 1.5 ? 1.6 : (aKind < 2.5 ? 2.5 : 1.1));
  gl_PointSize = min(uSize * base * (0.85 + aRand * 0.3) * uPR / max(-mv.z, 0.6) * (1.0 + near * 0.9), 20.0 * uPR);
  vColor = (aKind > 0.5 && aKind < 2.5) ? uDome : uSpeck;
  float a = aKind < 0.5 ? 0.3 : (aKind < 2.5 ? 0.9 : 0.26);
  vAlpha = a * r * smoothstep(uFogFar, uFogNear, -mv.z) * uAlpha * (1.0 + near * 1.3);
}`;

const STAGE_VERT = /* glsl */`
uniform float uTime, uMix, uSwap, uSwapTo, uSize, uPR, uBlink, uLevel, uPulse, uCalm, uAlpha, uAlphaFrom, uAlphaTo;
uniform float uTanFov, uAspect, uPush, uFogNear, uFogFar;
uniform vec2 uLook, uPointer;
uniform vec3 uPosFrom, uPosTo; uniform float uYawFrom, uYawTo, uPitchFrom, uPitchTo, uScaleFrom, uScaleTo;
uniform vec3 uBase, uAccent, uAlert;
attribute vec4 aFrom; attribute vec4 aTo; attribute vec4 aAlt; attribute float aRand;
varying vec3 vColor; varying float vAlpha;

vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
bool is(float f, float v) { return abs(f - v) < 0.5; }

// posición local animada (.xyz) y transparencia (.w) según la marca de cada punto
vec4 anim(vec4 a) {
  vec3 p = a.xyz; float f = a.w, al = 1.0, t = uTime * (1.0 - uCalm);
  if (is(f, 1.0)) p.xy += uLook;
  if (is(f, 1.0) || is(f, 2.0)) p.y *= 1.0 - uBlink;
  if (is(f, 3.0)) { vec2 o = vec2(${ARC_X.toFixed(2)}, 0.0); float k = 1.0 + 0.07 * sin(t * 3.0 - length(p.xy - o) * 2.2); p.xy = o + (p.xy - o) * k; }
  if (is(f, 4.0)) { float sy = mod(t * 0.55, 2.4) - 1.2; al = 0.5 + 1.5 * smoothstep(0.22, 0.0, abs(p.y - sy)); }
  if (is(f, 5.0)) { float r = length(p.xy); p.z += sin(r * 2.6 - t * 3.2) * 0.3 * (1.0 + uLevel * 4.0); p.xy *= 1.0 + uLevel * 0.28 * sin(r * 3.0 - t * 7.0); }
  if (is(f, 6.0)) { float ph = fract(t * 0.25 + p.y); float rad = 0.3 + ph * 2.6; p = vec3(p.x * rad, -1.75, p.z * rad); al = 1.0 - ph; }
  if (is(f, 8.0)) al = 0.32;
  return vec4(p, al);
}
vec3 colorOf(float f) {
  if (is(f, 1.0) || is(f, 3.0) || is(f, 7.0) || is(f, 9.0)) return uAccent;
  if (is(f, 10.0)) return uAlert;
  return uBase;
}
float ease(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }

void main() {
  float d = aRand * 0.4;
  float sw = ease((uSwap - d) / 0.6);
  float m = ease((uMix - d) / 0.6);
  float swA = sw * (1.0 - uSwapTo), swB = sw * uSwapTo;
  vec4 A = anim(aFrom), B = anim(aTo), C = anim(aAlt);
  vec3 la = mix(A.xyz, C.xyz, swA), lb = mix(B.xyz, C.xyz, swB);
  vec3 wa = uPosFrom + rotX(rotY(la * uScaleFrom, uYawFrom), uPitchFrom);
  vec3 wb = uPosTo + rotX(rotY(lb * uScaleTo, uYawTo), uPitchTo);
  vec3 p = mix(wa, wb, m);
  float t = uTime * (1.0 - uCalm);
  vec3 swirl = vec3(sin(p.y * 0.8 + t * 0.7 + aRand * 6.28), cos(p.x * 0.7 + t * 0.6 + aRand * 3.0), sin(p.x * 0.5 + p.y * 0.4 + t * 0.5));
  float fl = sin(3.14159 * m) * (1.0 - uCalm), fs = sin(3.14159 * sw) * (1.0 - uCalm);
  p += swirl * (fl * 1.3 + fs * 0.9);
  p.y -= fl * 1.4 * (0.4 + aRand);                     // en el viaje los puntos bajan hacia la línea guía
  p += 0.035 * vec3(sin(t * 0.9 + aRand * 30.0), cos(t * 0.7 + aRand * 20.0), 0.0);
  vec3 ctr = mix(uPosFrom, uPosTo, m);
  p += normalize(p - ctr + 1e-4) * uPulse * 0.7 * aRand;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec2 pv = uPointer * vec2(uTanFov * uAspect, uTanFov) * (-mv.z);
  vec2 dv = mv.xy - pv; float dist = length(dv);
  float push = uPush * smoothstep(0.95, 0.0, dist) * (1.0 - uCalm);
  mv.xy += dv / (dist + 1e-4) * push * 0.42;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uSize * (0.6 + aRand * 0.8) * uPR / max(-mv.z, 0.6), 18.0 * uPR);
  vec3 cA = mix(colorOf(aFrom.w), colorOf(aAlt.w), swA), cB = mix(colorOf(aTo.w), colorOf(aAlt.w), swB);
  vColor = mix(cA, cB, m);
  float aA = mix(A.w, C.w, swA) * uAlphaFrom, aB = mix(B.w, C.w, swB) * uAlphaTo;
  vAlpha = mix(aA, aB, m) * uAlpha * smoothstep(uFogFar, uFogNear, -mv.z) * (1.0 + push * 0.7);
}`;

// ---------- paleta por tema ----------
const PALETTE = {
  dark: { base: '#f3f1ea', accent: '#ffd23f', alert: '#ff5d57', dome: '#ffd23f', speck: '#8d939b', blend: THREE.AdditiveBlending },
  light: { base: '#1d2126', accent: '#a86f00', alert: '#c4281c', dome: '#c99000', speck: '#7d838a', blend: THREE.NormalBlending },
  hc: { base: '#ffffff', accent: '#ffe600', alert: '#ff6b5e', dome: '#ffe600', speck: '#bbbbbb', blend: THREE.AdditiveBlending },
};

// ---------- montaje ----------
export function mount({ canvas, labelsEl, prefs = {} }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  const small = Math.min(innerWidth, innerHeight) < 700;
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const Q = small ? (weak ? 0.45 : 0.6) : weak ? 0.7 : 1;
  const N = Math.round(15000 * Q);
  const PR = Math.min(devicePixelRatio || 1, small ? 1.6 : 1.75);
  renderer.setPixelRatio(PR);

  const stopsEls = [...document.querySelectorAll('[data-stop]')];
  const stops = stopsEls.map(el => ({ el, shape: el.dataset.shape || 'none', alpha: el.dataset.alpha ? Number(el.dataset.alpha) : el.dataset.shape === 'none' ? 0 : 1, cover: el.hasAttribute('data-cover') }));
  const keyOf = i => { for (let k = i; k >= 0; k--) if (stops[k].shape !== 'none') return stops[k].shape; return 'eye'; };
  const hablarIdx = stopsEls.findIndex(el => el.id === 'hablar');
  const streetIdx = stopsEls.findIndex(el => el.dataset.shape === 'street');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 90);

  // formas (las de texto esperan a la tipografía)
  const shapes = { eye: eyeShape(N), people: peopleShape(N), street: streetShape(N), box: boxShape(N), waves: wavesShape(N), bubble: bubbleShape(N), pin: pinShape(N), shield: shieldShape(N) };
  shapes.aa = textShape(N, 'Aa', 0, 91);
  const fontReady = (document.fonts && document.fonts.load ? document.fonts.load(`800 100px ${FONT}`) : Promise.resolve()).catch(() => {});
  fontReady.then(() => { shapes.aa = textShape(N, 'Aa', 0, 91); pairKey = ''; request(); });
  const PITCH = { street: 0.5, box: 0.28 };
  const SCALE = { eye: 1, people: 0.92, street: 0.8, box: 1, waves: 0.92, bubble: 0.92, pin: 0.9, aa: 1, shield: 0.92 };

  // suelo
  const gd = groundData(stops.length, Q);
  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute('position', new THREE.BufferAttribute(gd.pos, 3));
  gGeo.setAttribute('aKind', new THREE.BufferAttribute(gd.kind, 1));
  gGeo.setAttribute('aRand', new THREE.BufferAttribute(gd.rnd, 1));
  const gU = {
    uRise: { value: 0 }, uSize: { value: 26 }, uPR: { value: PR }, uFogNear: { value: 4 }, uFogFar: { value: small ? 30 : 38 }, uAlpha: { value: 1 },
    uPush: { value: 0 }, uPointer: { value: new THREE.Vector2(9, 9) }, uDome: { value: new THREE.Color() }, uSpeck: { value: new THREE.Color() },
  };
  const gMat = new THREE.ShaderMaterial({ uniforms: gU, vertexShader: GROUND_VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
  const ground = new THREE.Points(gGeo, gMat);
  ground.frustumCulled = false;
  scene.add(ground);

  // figuras
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const aFrom = new THREE.BufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aTo = new THREE.BufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aAlt = new THREE.BufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const rr = rng(5), rand = new Float32Array(N);
  for (let i = 0; i < N; i++) rand[i] = rr();
  sGeo.setAttribute('aFrom', aFrom); sGeo.setAttribute('aTo', aTo); sGeo.setAttribute('aAlt', aAlt);
  sGeo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  const U = {
    uTime: { value: 0 }, uMix: { value: 0 }, uSwap: { value: 0 }, uSwapTo: { value: 0 }, uSize: { value: small ? 20 : 22 }, uPR: { value: PR }, uBlink: { value: 0 },
    uLevel: { value: 0 }, uPulse: { value: 0 }, uCalm: { value: 0 }, uAlpha: { value: 1 }, uAlphaFrom: { value: 1 }, uAlphaTo: { value: 1 },
    uTanFov: { value: Math.tan(THREE.MathUtils.degToRad(25)) }, uAspect: { value: 1 }, uPush: { value: 0 }, uFogNear: { value: 3 }, uFogFar: { value: 40 },
    uLook: { value: new THREE.Vector2() }, uPointer: { value: new THREE.Vector2(9, 9) },
    uPosFrom: { value: new THREE.Vector3() }, uPosTo: { value: new THREE.Vector3() }, uYawFrom: { value: 0 }, uYawTo: { value: 0 }, uPitchFrom: { value: 0 }, uPitchTo: { value: 0 },
    uScaleFrom: { value: 1 }, uScaleTo: { value: 1 },
    uBase: { value: new THREE.Color() }, uAccent: { value: new THREE.Color() }, uAlert: { value: new THREE.Color() },
  };
  const sMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: STAGE_VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
  const stage = new THREE.Points(sGeo, sMat);
  stage.frustumCulled = false;
  stage.renderOrder = 1;
  scene.add(stage);

  // ---------- preferencias: tema, contraste alto y modo calma ----------
  let calm = false;
  function setPrefs(p = {}) {
    calm = !!p.calm;
    const pal = p.hc ? PALETTE.hc : p.theme === 'light' ? PALETTE.light : PALETTE.dark;
    U.uBase.value.set(pal.base); U.uAccent.value.set(pal.accent); U.uAlert.value.set(pal.alert);
    gU.uDome.value.set(pal.dome); gU.uSpeck.value.set(pal.speck);
    sMat.blending = gMat.blending = pal.blend;
    sMat.needsUpdate = gMat.needsUpdate = true;
    U.uCalm.value = calm ? 1 : 0;
    if (calm) { gU.uRise.value = 1; U.uSwap.value = 0; intro = null; }
    request();
  }

  // ---------- encuadre según la pantalla ----------
  let L;
  const HALF_W = 3.05, HALF_H = 2.15;           // medio ancho y medio alto habituales de las figuras
  function layout() {
    const w = innerWidth, h = innerHeight, a = w / h, tan = Math.tan(25 * PI / 180);
    const portrait = a < 1.25, hold = portrait ? (a < 0.8 ? 9.6 : 8.6) : 7;
    const halfH = hold * tan, unit = (h / 2) / halfH;           // píxeles por unidad a la distancia de la figura
    let cx, cy, k;
    if (portrait) {
      cx = w / 2; cy = h * (a < 0.8 ? 0.31 : 0.33);
      k = Math.min((w * 0.42) / (HALF_W * unit), (h * 0.2) / (HALF_H * unit));
    } else {
      const panel = document.querySelector('.stop.hero .panel');
      const left = Math.min(panel ? panel.getBoundingClientRect().right + 28 : w * 0.5, w * 0.64);
      const half = (w - 28 - left) / 2;
      cx = left + half; cy = h * 0.5;
      k = Math.min(half / (HALF_W * unit), (h * 0.38) / (HALF_H * unit));
    }
    // desplazamiento de lente: el punto de fuga de la línea guía cae bajo la figura y el texto queda despejado
    const shift = Math.round(cx - w / 2);
    L = { sx: 0, shiftNdc: (2 * shift) / w, sy: 1.55 - 0.033 * hold + (1 - 2 * cy / h) * halfH, hold, k };
    renderer.setSize(w, h, false);
    camera.aspect = a;
    if (shift) camera.setViewOffset(w, h, -shift, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    U.uAspect.value = a;
    measure();
    request();
  }

  // ---------- scroll: posición continua entre paradas, con meseta en cada una ----------
  let centers = [];
  function measure() { centers = stopsEls.map(el => { const r = el.getBoundingClientRect(); return r.top + scrollY + r.height / 2; }); }
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function targetS() {
    const c = scrollY + innerHeight * 0.5;
    if (!centers.length || c <= centers[0]) return 0;
    for (let i = 0; i < centers.length - 1; i++) if (c < centers[i + 1]) return i + smooth(0.28, 0.72, (c - centers[i]) / (centers[i + 1] - centers[i]));
    return centers.length - 1;
  }

  // ---------- puntero, dedo e inclinación del celular ----------
  const ptr = { x: 0, y: 0, tx: 0, ty: 0, last: -1e9, push: 0, tilt: null, tiltAt: -1e9 };
  const setPtr = (cx, cy) => { ptr.tx = (cx / innerWidth) * 2 - 1; ptr.ty = -((cy / innerHeight) * 2 - 1); ptr.last = performance.now(); request(); };
  addEventListener('pointermove', e => { if (e.pointerType === 'mouse') setPtr(e.clientX, e.clientY); }, { passive: true });
  addEventListener('touchstart', e => { const t = e.touches[0]; if (t) setPtr(t.clientX, t.clientY); }, { passive: true });
  addEventListener('touchmove', e => { const t = e.touches[0]; if (t) setPtr(t.clientX, t.clientY); }, { passive: true });
  document.addEventListener('mouseleave', () => { ptr.last = -1e9; request(); });
  addEventListener('deviceorientation', e => { if (e.gamma == null) return; ptr.tilt = Math.max(-1, Math.min(1, e.gamma / 35)); ptr.tiltAt = performance.now(); request(); }, { passive: true });
  addEventListener('scroll', () => request(), { passive: true });
  addEventListener('resize', () => layout());
  addEventListener('va:prefs', () => layout());
  new ResizeObserver(() => { measure(); request(); }).observe(document.body);

  // ---------- pares de figuras: se suben a la GPU solo cuando cambian ----------
  let pairKey = '', swapIdx = -1;
  function setPair(i0, i1) {
    const k0 = keyOf(i0), k1 = keyOf(i1), key = k0 + '>' + k1;
    // la figura alternativa (entrada o palabra) vale para el lado que está en su parada
    if (swapIdx !== -1 && swapIdx !== i0 && swapIdx !== i1) { swapIdx = -1; U.uSwap.value = 0; swapAnim = null; }
    U.uSwapTo.value = swapIdx !== -1 && swapIdx === i1 && swapIdx !== i0 ? 1 : 0;
    if (key === pairKey) return;
    pairKey = key;
    aFrom.array.set(shapes[k0]); aFrom.needsUpdate = true;
    aTo.array.set(shapes[k1]); aTo.needsUpdate = true;
  }

  // animaciones con tiempo: entrada, parpadeo, palabra y pulso
  let intro = null, swapAnim = null, blink = null, nextBlink = 2.5, pulseAt = -1e9;
  function startIntro() {
    if (calm) { gU.uRise.value = 1; return; }
    // los puntos de la primera figura salen del suelo, sobre la línea guía
    const r = rng(9), alt = new Float32Array(N * 4), sc = SCALE.eye * L.k;
    for (let i = 0; i < N; i++) {
      const wx = J(r, 0.5), wz = J(r, 6) + 1, wy = 0.02;
      alt[i * 4] = (wx - L.sx) / sc; alt[i * 4 + 1] = (wy - L.sy) / sc; alt[i * 4 + 2] = wz / sc; alt[i * 4 + 3] = 9;
    }
    aAlt.array.set(alt); aAlt.needsUpdate = true;
    swapIdx = 0; U.uSwap.value = 1;
    intro = { t0: performance.now() };
  }

  // ---------- narración de la esquina ----------
  const NOUN_LOCAL = { tree: 'árbol', building: 'edificio', crossing: 'paso peatonal' };
  function nounOf(cls) {
    const N2 = (typeof Scene !== 'undefined' && Scene.NOUNS) || {};
    if (N2[cls]) return { s: N2[cls][0], g: N2[cls][2] };
    return { s: NOUN_LOCAL[cls] || cls, g: 'm' };
  }
  const art = o => (o.g === 'f' ? 'una ' : 'un ') + o.s;
  let streetYaw = -0.55, nudge = 0, lastSay = '', sayAt = 0;
  const labelSpans = STREET_ANCHORS.map(a => { const s = document.createElement('span'); s.textContent = nounOf(a.cls).s; labelsEl.appendChild(s); return s; });
  function narrate(yaw, k) {
    const sides = { front: [], left: [], right: [] };
    for (const a of STREET_ANCHORS) {
      const [x, , z] = a.p, c = Math.cos(yaw), s = Math.sin(yaw);
      const rx = (c * x + s * z) * k, rz = (-s * x + c * z) * k;
      const side = rx < -0.75 * k ? 'left' : rx > 0.75 * k ? 'right' : 'front';
      const dist = rz > 0.5 * k ? 'cerca' : rz < -1.0 * k ? 'lejos' : 'a media distancia';
      sides[side].push({ o: nounOf(a.cls), dist, rz });
    }
    const part = (items, lead, max) => {
      if (!items.length) return '';
      items.sort((a, b) => b.rz - a.rz);
      const top = items.slice(0, max);
      if (top.length > 1 && top[0].dist === top[1].dist) return `${lead}${art(top[0].o)} y ${art(top[1].o)}, ${top[0].dist}`;
      return lead + top.map(i => `${art(i.o)} ${i.dist}`).join(' y ');
    };
    return [part(sides.front, 'Al frente hay ', 2), part(sides.left, 'A tu izquierda, ', 1), part(sides.right, 'A tu derecha, ', 1)].filter(Boolean).join('. ') + '.';
  }

  // ---------- bucle de dibujo (solo cuando hace falta) ----------
  let raf = 0, sDisp = 0, sTarget = 0, first = true, last = performance.now();
  function request() { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); }
  document.addEventListener('visibilitychange', () => request());

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    let busy = false;
    sTarget = targetS();
    if (calm) {
      // sin movimiento ligado al scroll: se cambia de parada con un fundido corto
      const near = Math.round(sTarget);
      if (Math.abs(sDisp - near) > 0.001) { sDisp = near; }
    } else {
      sDisp += (sTarget - sDisp) * (1 - Math.pow(0.0015, dt));
      if (Math.abs(sTarget - sDisp) < 0.0004) sDisp = sTarget; else busy = true;
    }
    const i0 = Math.max(0, Math.min(stops.length - 1, Math.floor(sDisp + 1e-6)));
    const i1 = Math.min(i0 + 1, stops.length - 1);
    const m = i1 === i0 ? 0 : sDisp - i0;
    setPair(i0, i1);

    // puntero suavizado; si no hay puntero reciente, la inclinación del celular
    const active = now - ptr.last < 2500;
    let tx = ptr.tx, ty = ptr.ty;
    if (!active && ptr.tilt != null && now - ptr.tiltAt < 4000) { tx = ptr.tilt; ty = 0; }
    else if (!active) { tx *= 0.98; ty *= 0.98; }
    ptr.x += (tx - ptr.x) * (calm ? 1 : 1 - Math.pow(0.002, dt));
    ptr.y += (ty - ptr.y) * (calm ? 1 : 1 - Math.pow(0.002, dt));
    ptr.push += ((active && !calm ? 1 : 0) - ptr.push) * (1 - Math.pow(0.01, dt));
    if (Math.abs(ptr.x - tx) > 0.001 || Math.abs(ptr.push - (active ? 1 : 0)) > 0.01) busy = true;

    // cámara en primera persona sobre la línea guía
    const zc = -sDisp * D + L.hold;
    const sway = calm ? 0 : 1;
    camera.position.set(ptr.x * 0.28 * sway, 1.55 + ptr.y * 0.14 * sway, zc);
    camera.lookAt(ptr.x * 0.12 * sway, 1.22, zc - 10);

    // transformaciones de cada lado
    const t = now / 1000;
    const yawFor = key => {
      if (key === 'street') return streetYaw;
      if (key === 'box') return (calm ? 0.35 : Math.sin(t * 0.35) * 0.45 + 0.2) + ptr.x * 0.5;
      return ptr.x * 0.22 * sway;
    };
    const yawGoal = -0.55 + (calm ? 0 : ptr.x * 0.95) + nudge;
    if (!calm) { streetYaw += (yawGoal - streetYaw) * (1 - Math.pow(0.02, dt)); if (Math.abs(yawGoal - streetYaw) > 0.001) busy = true; }
    else streetYaw = yawGoal;
    const k0 = keyOf(i0), k1 = keyOf(i1);
    U.uPosFrom.value.set(L.sx, L.sy, -i0 * D); U.uPosTo.value.set(L.sx, L.sy, -i1 * D);
    U.uYawFrom.value = yawFor(k0); U.uYawTo.value = yawFor(k1);
    U.uPitchFrom.value = PITCH[k0] || 0; U.uPitchTo.value = PITCH[k1] || 0;
    U.uScaleFrom.value = SCALE[k0] * L.k; U.uScaleTo.value = SCALE[k1] * L.k;
    let aF = stops[i0].alpha, aT = stops[i1].alpha;
    if (calm && i0 !== i1) { const fade = Math.min(1, Math.abs(m - 0.5) * 6); aF *= fade; aT *= fade; }
    U.uAlphaFrom.value = aF; U.uAlphaTo.value = aT;
    U.uMix.value = calm ? (m < 0.5 ? 0 : 1) : m;
    U.uTime.value = t;
    U.uPointer.value.set(ptr.x - L.shiftNdc, ptr.y); gU.uPointer.value.set(ptr.x, ptr.y);   // el puntero, en el espacio de la vista desplazada
    U.uPush.value = ptr.push; gU.uPush.value = ptr.push;

    // la pupila mira al puntero; parpadeo de vez en cuando
    U.uLook.value.set(ptr.x * 0.42, ptr.y * 0.26);
    if (!calm && (k0 === 'eye' || k1 === 'eye')) {
      busy = true;
      if (!blink && t > nextBlink) blink = { t0: t };
      if (blink) { const b = (t - blink.t0) / 0.22; U.uBlink.value = b < 0.5 ? b * 2 : Math.max(0, 2 - b * 2); if (b >= 1) { blink = null; U.uBlink.value = 0; nextBlink = t + 2.8 + Math.random() * 3.5; } }
    }
    // entrada: suelo que se levanta y puntos que suben a formar el ojo
    if (intro) {
      const e = (now - intro.t0) / 1000;
      gU.uRise.value = Math.min(1, e / 1.6);
      U.uSwap.value = swapIdx === 0 ? Math.max(0, 1 - Math.max(0, e - 0.35) / 2.2) : 0;
      if (e > 2.6) { intro = null; U.uSwap.value = 0; swapIdx = -1; }
      busy = true;
    }
    if (swapAnim) {
      const e = Math.min(1, (now - swapAnim.t0) / 1100);
      U.uSwap.value = calm ? 1 : e;
      if (e >= 1) swapAnim = null; else busy = true;
    }
    const pe = (now - pulseAt) / 650;
    U.uPulse.value = pe < 1 ? Math.sin(pe * PI) * (calm ? 0 : 1) : 0;
    if (pe < 1) busy = true;
    if (U.uLevel.value > 0.001) busy = true;
    if (!calm && ['waves', 'box', 'pin', 'eye', 'people'].some(k => k === k0 || k === k1)) busy = true;   // figuras con vida propia

    // la esquina: etiquetas sobre la escena y narración según hacia dónde miras
    const vis = (k0 === 'street' ? (1 - m) * aF : 0) + (k1 === 'street' ? m * aT : 0);
    if (vis > 0.04 && streetIdx >= 0) {
      const sc = SCALE.street * L.k, side = k0 === 'street' ? 'From' : 'To';
      const pos = U['uPos' + side].value, yaw = U['uYaw' + side].value, pitch = PITCH.street;
      const w = innerWidth, h = innerHeight, v = new THREE.Vector3();
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      STREET_ANCHORS.forEach((a, i) => {
        const [x, y, z] = a.p, rx = (cy * x + sy * z) * sc, ry = y * sc, rz = (-sy * x + cy * z) * sc;
        v.set(pos.x + rx, pos.y + cp * ry - sp * rz, pos.z + sp * ry + cp * rz).project(camera);
        labelSpans[i].style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%, -140%)`;
      });
      labelsEl.style.opacity = Math.min(1, vis * 1.6).toFixed(2);
      if (now - sayAt > 160) {
        sayAt = now;
        const text = narrate(streetYaw, 1);
        if (text !== lastSay) { lastSay = text; dispatchEvent(new CustomEvent('va:narration', { detail: text })); }
      }
    } else if (labelsEl.style.opacity !== '0') labelsEl.style.opacity = '0';

    // la sección que cubre el lienzo (la esquina en miniatura) no necesita dibujo
    const covered = stops[Math.round(sDisp)] && stops[Math.round(sDisp)].cover && Math.abs(sDisp - Math.round(sDisp)) < 0.3;
    if (!covered) renderer.render(scene, camera);
    if (first) { first = false; canvas.classList.add('on'); }
    if (busy && !document.hidden) request();
  }

  // ---------- API para la interfaz de la página ----------
  const api = {
    setPrefs,
    setLevel(v) { U.uLevel.value = Math.max(0, Math.min(1, v || 0)); request(); },
    nudge(d) { nudge = Math.max(-1.6, Math.min(1.6, nudge + d)); request(); },
    showWord(word) {
      if (hablarIdx < 0) return;
      aAlt.array.set(textShape(N, word, 9, word.length * 7 + 3)); aAlt.needsUpdate = true;
      swapIdx = hablarIdx; pairKey = '';
      U.uSwap.value = 0; swapAnim = { t0: performance.now() }; pulseAt = performance.now();
      request();
    },
    pulse() { pulseAt = performance.now(); request(); },
    narration: () => lastSay || narrate(streetYaw, 1),
    state: () => ({ s: sDisp, target: sTarget, pair: pairKey, swap: U.uSwap.value, level: U.uLevel.value, yaw: streetYaw, calm, n: N, stops: stops.length }),
  };

  layout();
  setPrefs(prefs);
  startIntro();
  request();
  return api;
}
