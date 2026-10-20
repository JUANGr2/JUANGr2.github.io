// Diorama 3D de una esquina: se arrastra, se gira y se acerca; la app dice qué queda enfrente de ti.
// Módulo ES cargado bajo demanda desde home.js. Three.js se sirve desde /vendor (sin CDN, funciona sin internet).
import * as THREE from '/vendor/three/three.module.min.js';

const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const safeMode = () => document.body.classList.contains('safe');
const ACCENT = new THREE.Color('#9a6200');

// nombres: los de la IA de la app (Scene.NOUNS) cuando existen, y propios para lo demás
const LOCAL_NOUNS = {
  tree: ['árbol', 'árboles', 'm'], trash: ['bote de basura', 'botes de basura', 'm'], stop: ['parada de autobús', 'paradas de autobús', 'f'],
  crossing: ['paso peatonal', 'pasos peatonales', 'm'], building: ['edificio', 'edificios', 'm'], door: ['puerta', 'puertas', 'f'],
};
function noun(cls) {
  const N = (typeof Scene !== 'undefined' && Scene.NOUNS) || {};
  return N[cls] || LOCAL_NOUNS[cls] || [cls, cls + 's', 'm'];
}
const NUM = ['', 'un', 'dos', 'tres', 'cuatro'];
function np(cls, n) {
  const [s, p, g] = noun(cls);
  if (n === 1) return (g === 'f' ? 'una ' : 'un ') + s;
  return (NUM[n] || n) + ' ' + p;
}
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const listJoin = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1];

// ---------- construcción del modelo (low-poly, sombreado plano) ----------
function mat(color) { return new THREE.MeshLambertMaterial({ color, flatShading: true }); }
function mesh(geo, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
const box = (w, h, d, c, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), c, x, y, z);
const cyl = (r, h, c, x, y, z, seg = 10) => mesh(new THREE.CylinderGeometry(r, r, h, seg), c, x, y, z);

const SIDE = 0.18; // altura de la acera
function buildGround(scene) {
  const g = new THREE.Group();
  g.add(box(12.4, 0.9, 12.4, '#2a2c24', 0, -0.45, 0));          // tierra (laterales del diorama)
  g.add(box(12, 0.04, 12, '#3b3e37', 0, 0.02, 0));               // asfalto
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(4.8, SIDE, 4.8, '#d8d1c1', sx * 3.6, SIDE / 2 + 0.02, sz * 3.6));
  // marcas del carril
  for (const x of [-5.4, -4.2, -3.0, -1.8, 1.8, 3.0, 4.2, 5.4]) {
    g.add(box(0.6, 0.02, 0.1, '#e9e3d3', x, 0.05, 0));
    g.add(box(0.1, 0.02, 0.6, '#e9e3d3', 0, 0.05, x));
  }
  // pasos peatonales
  for (let i = 0; i < 4; i++) {
    g.add(box(0.28, 0.02, 2.2, '#f3f1e8', 1.75 + i * 0.5, 0.05, 0));
    g.add(box(2.2, 0.02, 0.28, '#f3f1e8', 0, 0.05, 1.75 + i * 0.5));
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  scene.add(g);
}

// cada objeto nombrable: grupo de mallas + posición de referencia + punto alto para la etiqueta
function thing(scene, cls, x, z, build, top = 1.2) {
  const g = new THREE.Group();
  g.position.set(x, SIDE + 0.02, z);
  build(g);
  g.userData = { cls, top };
  scene.add(g);
  return { cls, group: g, pos: new THREE.Vector3(x, 0, z), top: new THREE.Vector3(x, SIDE + top, z), mats: [] };
}

function buildThings(scene) {
  const T = [];
  // edificio en L con puerta y ventanas
  T.push(thing(scene, 'building', -4.6, -4.6, g => {
    g.add(box(3.4, 3.4, 1.6, '#c7b591', 0.3, 1.7, -0.6));
    g.add(box(1.6, 3.4, 1.8, '#c7b591', -0.6, 1.7, 1.1));
    g.add(box(3.5, 0.12, 1.7, '#a8946e', 0.3, 3.46, -0.6));
    g.add(box(1.7, 0.12, 1.9, '#a8946e', -0.6, 3.46, 1.1));
    for (const x of [0.6, 1.6]) g.add(box(0.5, 0.6, 0.06, '#3b3e37', x, 2.5, 0.22));
    for (const z of [0.6, 1.6]) for (const y of [1.3, 2.5]) g.add(box(0.06, 0.6, 0.5, '#3b3e37', 0.22, y, z));
  }, 3.6));
  T.push(thing(scene, 'door', -3.5, -4.36, g => { g.add(box(0.7, 1.3, 0.08, '#9a6200', 0, 0.65, 0)); g.add(box(0.08, 0.08, 0.06, '#f2b84b', 0.22, 0.65, 0.06)); }, 1.4));
  // semáforo con tres luces
  const lights = [];
  T.push(thing(scene, 'traffic light', 1.6, -1.6, g => {
    g.add(cyl(0.06, 2.6, '#2b2e27', 0, 1.3, 0, 8));
    g.add(box(0.32, 0.86, 0.3, '#15170f', 0, 2.7, 0));
    ['#ff4d3d', '#ffb020', '#3ddc84'].forEach((c, i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshLambertMaterial({ color: '#2a2a2a', emissive: '#000000' }));
      m.position.set(0, 2.98 - i * 0.27, 0.16); m.userData.on = new THREE.Color(c);
      lights.push(m); g.add(m);
    });
  }, 3.1));
  // auto en la calle
  T.push(thing(scene, 'car', -3.4, 0.55, g => {
    g.position.y = 0.02;
    g.add(box(1.9, 0.5, 0.95, '#9a6200', 0, 0.45, 0));
    g.add(box(1.0, 0.42, 0.86, '#efe6d2', -0.1, 0.9, 0));
    for (const x of [-0.6, 0.6]) for (const z of [-0.48, 0.48]) {
      const w = cyl(0.22, 0.16, '#15170f', x, 0.22, z, 12); w.rotation.x = Math.PI / 2; g.add(w);
    }
  }, 1.3));
  // persona y perro
  T.push(thing(scene, 'person', 2.9, -2.7, g => {
    g.add(mesh(new THREE.CapsuleGeometry(0.18, 0.55, 3, 8), '#3a4a5c', 0, 0.55, 0));
    g.add(mesh(new THREE.IcosahedronGeometry(0.16, 1), '#e0b98f', 0, 1.15, 0));
  }, 1.45));
  T.push(thing(scene, 'dog', 3.55, -2.1, g => {
    g.add(box(0.52, 0.22, 0.2, '#8a5a32', 0, 0.36, 0));
    g.add(box(0.2, 0.2, 0.18, '#8a5a32', 0.3, 0.5, 0));
    for (const x of [-0.18, 0.18]) for (const z of [-0.07, 0.07]) g.add(box(0.06, 0.26, 0.06, '#6f4626', x, 0.13, z));
    const t = box(0.22, 0.05, 0.05, '#6f4626', -0.32, 0.5, 0); t.rotation.z = 0.7; g.add(t);
  }, 0.8));
  // bicicleta estacionada
  T.push(thing(scene, 'bicycle', -2.4, 3.6, g => {
    for (const x of [-0.42, 0.42]) { const w = mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 18), '#15170f', x, 0.32, 0); g.add(w); }
    const f1 = box(0.84, 0.05, 0.05, '#9a6200', 0, 0.52, 0); g.add(f1);
    const f2 = box(0.05, 0.42, 0.05, '#9a6200', -0.12, 0.4, 0); f2.rotation.z = -0.35; g.add(f2);
    g.add(box(0.22, 0.05, 0.1, '#15170f', -0.18, 0.66, 0));
    g.rotation.y = 0.4;
  }, 0.9));
  // banca
  T.push(thing(scene, 'bench', -3.9, 2.6, g => {
    g.add(box(1.3, 0.08, 0.42, '#7a5230', 0, 0.45, 0));
    g.add(box(1.3, 0.34, 0.06, '#7a5230', 0, 0.72, -0.2));
    for (const x of [-0.55, 0.55]) g.add(box(0.07, 0.45, 0.38, '#2b2e27', x, 0.22, 0));
  }, 1.0));
  // árboles
  const tree = (x, z, s = 1) => thing(scene, 'tree', x, z, g => {
    g.add(cyl(0.1 * s, 0.9 * s, '#6b4a2b', 0, 0.45 * s, 0, 7));
    g.add(mesh(new THREE.IcosahedronGeometry(0.78 * s, 0), '#5f7a3a', 0, 1.45 * s, 0));
    g.add(mesh(new THREE.IcosahedronGeometry(0.5 * s, 0), '#6d8a44', 0.25 * s, 1.95 * s, 0.1 * s));
  }, 2.3 * s);
  T.push(tree(4.5, 4.3), tree(4.7, -4.7, 1.15), tree(-4.9, 4.9, 0.9));
  // bote de basura y parada de autobús
  T.push(thing(scene, 'trash', -1.85, -1.9, g => {
    g.add(cyl(0.2, 0.55, '#4b5048', 0, 0.28, 0, 10));
    g.add(cyl(0.23, 0.06, '#2b2e27', 0, 0.58, 0, 10));
  }, 0.75));
  T.push(thing(scene, 'stop', 3.9, 2.1, g => {
    g.add(cyl(0.05, 2.2, '#4b5048', 0, 1.1, 0, 8));
    const s = cyl(0.3, 0.05, '#f2b84b', 0, 2.1, 0, 16); s.rotation.x = Math.PI / 2; g.add(s);
    g.add(box(0.9, 0.06, 0.32, '#7a5230', 0.45, 0.45, 0.5));
  }, 2.5));
  // paso peatonal (no tiene mallas propias: es el que cruza la calle frente a ti)
  T.push({ cls: 'crossing', group: null, pos: new THREE.Vector3(2.5, 0, 0), top: new THREE.Vector3(2.5, 0.1, 0), mats: [] });
  T.push({ cls: 'crossing', group: null, pos: new THREE.Vector3(0, 0, 2.5), top: new THREE.Vector3(0, 0.1, 2.5), mats: [] });

  // materiales propios por objeto, para resaltarlos sin afectar a los demás
  T.forEach(t => t.group && t.group.traverse(o => { if (o.isMesh && !t.mats.includes(o.material)) { o.material = o.material.clone(); t.mats.push(o.material); o.userData.thing = t; } }));
  return { things: T, lights };
}

// ---------- montaje ----------
export function mount(root) {
  const canvas = root.querySelector('.st-canvas');
  const labelsEl = root.querySelector('.st-labels');
  const sayEl = root.querySelector('#st-say');
  const liveEl = root.querySelector('#st-live');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    root.classList.add('st-off');
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 120);
  scene.add(new THREE.HemisphereLight('#fff6e5', '#3a3d36', 1.9));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.6);
  sun.position.set(-7, 12, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);

  buildGround(scene);
  const { things, lights } = buildThings(scene);

  // tú: punto de vista en la esquina y el cono de lo que «ve» la cámara
  const VIEW = new THREE.Vector3(1.9, 0, 1.9);
  const you = new THREE.Group();
  you.position.set(VIEW.x, SIDE + 0.03, VIEW.z);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.34, 24), new THREE.MeshBasicMaterial({ color: ACCENT, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; you.add(ring);
  const FOV = THREE.MathUtils.degToRad(50);
  const cone = new THREE.Mesh(new THREE.CircleGeometry(4.2, 24, -FOV / 2, FOV),
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  cone.rotation.x = -Math.PI / 2; cone.position.y = 0.005;
  const coneHolder = new THREE.Group(); coneHolder.add(cone); you.add(coneHolder);
  scene.add(you);

  // órbita: ángulo horizontal (theta), inclinación (phi) y distancia
  const TARGET = new THREE.Vector3(0, 0.2, 0);
  const BASE_R = 24;
  let resized = false;
  const HOME = { theta: Math.PI * 0.25, phi: 1.02, r: BASE_R };   // detrás de ti, mirando hacia la esquina del edificio
  const LIM = { phiMin: 0.42, phiMax: 1.38, rMin: 11, rMax: 38 };
  const st = { ...HOME };
  let vel = 0, velPhi = 0;

  function placeCamera() {
    const sp = Math.sin(st.phi);
    camera.position.set(TARGET.x + st.r * sp * Math.sin(st.theta), TARGET.y + st.r * Math.cos(st.phi), TARGET.z + st.r * sp * Math.cos(st.theta));
    camera.lookAt(TARGET);
    // el cono apunta hacia donde mira la cámara
    const f = forward();
    coneHolder.rotation.y = Math.atan2(-f.z, f.x);
  }
  function forward() {
    const f = new THREE.Vector3().subVectors(TARGET, camera.position); f.y = 0;
    return f.lengthSq() ? f.normalize() : new THREE.Vector3(0, 0, -1);
  }

  // ---------- narración ----------
  function analyse() {
    const f = forward(), r = new THREE.Vector3(-f.z, 0, f.x);
    const sides = { front: [], left: [], right: [] };
    for (const t of things) {
      const v = new THREE.Vector3().subVectors(t.pos, VIEW); v.y = 0;
      const d = v.length(); if (d < 0.3) continue;
      const a = THREE.MathUtils.radToDeg(Math.atan2(v.dot(r), v.dot(f)));
      const side = Math.abs(a) <= 25 ? 'front' : a > 25 && a <= 100 ? 'right' : a < -25 && a >= -100 ? 'left' : null;
      if (!side) continue;
      const dist = d < 2.6 ? 'cerca' : d < 5 ? 'a media distancia' : 'lejos';
      sides[side].push({ t, d, dist, side, a });
    }
    Object.values(sides).forEach(s => s.sort((x, y) => x.d - y.d));
    return sides;
  }
  // agrupa por nombre y distancia: «dos árboles lejos»
  function phraseFor(items) {
    const groups = [];
    for (const it of items) {
      const g = groups.find(x => x.cls === it.t.cls && x.dist === it.dist);
      if (g) g.n++; else groups.push({ cls: it.t.cls, dist: it.dist, n: 1 });
    }
    const two = groups.slice(0, 2);
    if (two.length === 2 && two[0].dist === two[1].dist) return `${np(two[0].cls, two[0].n)} y ${np(two[1].cls, two[1].n)}, ${two[0].dist}`;
    return listJoin(two.map(g => `${np(g.cls, g.n)} ${g.dist}`));
  }
  function narrate() {
    const s = analyse();
    const parts = [];
    if (s.front.length) parts.push('Al frente hay ' + phraseFor(s.front));
    if (s.left.length) parts.push('A tu izquierda, ' + phraseFor(s.left));
    if (s.right.length) parts.push('A tu derecha, ' + phraseFor(s.right));
    const text = parts.length ? parts.join('. ') + '.' : 'Frente a ti no hay nada cerca. Gira para buscar.';
    const named = [...s.front, ...s.left, ...s.right].map(x => x.t);
    return { text, named, front: s.front.map(x => x.t), s };
  }
  function phraseOne(t) {
    const s = analyse();
    for (const side of ['front', 'left', 'right']) {
      const it = s[side].find(x => x.t === t);
      if (it) return cap(`${np(t.cls, 1)}, ${side === 'front' ? 'al frente' : side === 'left' ? 'a tu izquierda' : 'a tu derecha'}, ${it.dist}.`);
    }
    return cap(`${np(t.cls, 1)}, detrás de ti.`);
  }

  // resaltado en ámbar + etiquetas
  let highlighted = [], front = [], hover = null, pinned = null;
  function paint() {
    for (const t of things) {
      const on = t === pinned || front.includes(t) ? 0.38 : t === hover ? 0.24 : highlighted.includes(t) ? 0.12 : 0;
      t.mats.forEach(m => { if (m.emissive) { m.emissive.copy(ACCENT); m.emissiveIntensity = on; } });
    }
  }
  function drawLabels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const show = pinned ? [pinned] : [...new Set([...front, ...(hover ? [hover] : [])])];
    const html = [];
    for (const t of show) {
      const p = t.top.clone().project(camera);
      if (p.z > 1) continue;
      const x = Math.max(56, Math.min(w - 56, (p.x + 1) / 2 * w)), y = Math.max(34, (1 - p.y) / 2 * h);
      html.push(`<span style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${noun(t.cls)[0]}</span>`);
    }
    const y = new THREE.Vector3(VIEW.x, SIDE + 0.5, VIEW.z).project(camera);
    html.push(`<span class="you" style="left:${((y.x + 1) / 2 * w).toFixed(1)}px;top:${((1 - y.y) / 2 * h).toFixed(1)}px">Tú</span>`);
    labelsEl.innerHTML = html.join('');
  }

  let lastText = '';
  function updateSay(announce) {
    if (pinned) { paint(); return sayEl.textContent; }
    const n = narrate();
    highlighted = n.named; front = n.front;
    if (n.text !== lastText) { sayEl.textContent = n.text; lastText = n.text; }
    if (announce) liveEl.textContent = n.text;
    paint();
    return n.text;
  }

  // ---------- render bajo demanda ----------
  let raf = 0, visible = true, anim = null, sayTimer = 0;
  function frame() {
    raf = 0;
    let moving = false;
    if (anim) {
      const k = Math.min(1, (performance.now() - anim.t0) / anim.ms), e = 1 - Math.pow(1 - k, 3);
      for (const key of ['theta', 'phi', 'r']) st[key] = anim.from[key] + (anim.to[key] - anim.from[key]) * e;
      if (k >= 1) { anim = null; settle(); } else moving = true;
    } else if (!dragging && (Math.abs(vel) > 1e-4 || Math.abs(velPhi) > 1e-4)) {
      st.theta += vel; st.phi = clampPhi(st.phi + velPhi);
      vel *= 0.92; velPhi *= 0.9;
      moving = true;
      if (Math.abs(vel) < 1e-4 && Math.abs(velPhi) < 1e-4) { vel = velPhi = 0; settle(); }
    }
    placeCamera();
    updateSay(false);
    renderer.render(scene, camera);
    drawLabels();
    if (moving) request();
  }
  function request() { if (!raf && visible) raf = requestAnimationFrame(frame); }
  function settle() { clearTimeout(sayTimer); sayTimer = setTimeout(() => { updateSay(true); request(); }, 120); }
  const clampPhi = p => Math.max(LIM.phiMin, Math.min(LIM.phiMax, p));
  const clampR = r => Math.max(LIM.rMin, Math.min(LIM.rMax, r));
  function animateTo(to, ms = 600) {
    vel = velPhi = 0; pinned = null;
    if (REDUCE || safeMode()) { Object.assign(st, to); request(); settle(); return; }
    anim = { from: { ...st }, to: { ...st, ...to }, t0: performance.now(), ms };
    request();
  }

  // ---------- controles: puntero (arrastrar/pellizcar), rueda, teclado ----------
  const pointers = new Map();
  let dragging = false, moved = 0, pinch = 0, lastX = 0, lastY = 0, lastT = 0, lastTap = 0;
  const touchy = e => e.pointerType === 'touch';
  canvas.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    dragging = true; moved = 0; vel = velPhi = 0; anim = null;
    lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
    if (pointers.size === 2) pinch = dist2();
    root.classList.add('st-used');
  });
  function dist2() { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) { if (e.pointerType === 'mouse') hoverAt(e); return; }
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      // dos dedos: pellizco para acercar y arrastre vertical para inclinar
      const d = dist2();
      if (pinch) st.r = clampR(st.r * pinch / d);
      pinch = d;
      st.phi = clampPhi(st.phi - (e.clientY - prev.y) * 0.003);
      moved += 10; request(); return;
    }
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    const now = performance.now(), dt = Math.max(16, now - lastT);
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 6) pinned = null;
    st.theta -= dx * 0.008;
    if (!touchy(e)) st.phi = clampPhi(st.phi - dy * 0.006);
    vel = -dx * 0.008 * (16 / dt); velPhi = touchy(e) ? 0 : -dy * 0.006 * (16 / dt);
    lastX = e.clientX; lastY = e.clientY; lastT = now;
    request();
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size) { pinch = 0; return; }
    dragging = false;
    if (REDUCE || safeMode()) vel = velPhi = 0;
    if (moved < 6) {
      // toque sin arrastre: doble toque reencuadra; un toque dice qué es el objeto
      const now = performance.now();
      if (now - lastTap < 320) { lastTap = 0; animateTo(HOME); return; }
      lastTap = now;
      const t = pick(e);
      if (t) { pinned = t; const p = phraseOne(t); sayEl.textContent = p; lastText = p; liveEl.textContent = p; paint(); request(); if (typeof Speech !== 'undefined') Speech.speak(p); return; }
      if (pinned) { pinned = null; settle(); request(); return; }
    }
    if (!vel && !velPhi) settle();
    request();
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; canvas.style.cursor = ''; paint(); request(); } });
  // rueda: acerca/aleja; en el límite deja pasar el desplazamiento de la página
  canvas.addEventListener('wheel', e => {
    const next = clampR(st.r * (1 + Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0016));
    if (next === st.r) return;
    e.preventDefault(); pinned = null; st.r = next; root.classList.add('st-used'); request(); settle();
  }, { passive: false });
  canvas.addEventListener('keydown', e => {
    const step = Math.PI / 12, map = {
      ArrowLeft: () => (st.theta += step), ArrowRight: () => (st.theta -= step),
      ArrowUp: () => (st.phi = clampPhi(st.phi - 0.12)), ArrowDown: () => (st.phi = clampPhi(st.phi + 0.12)),
      '+': () => (st.r = clampR(st.r * 0.88)), '=': () => (st.r = clampR(st.r * 0.88)), '-': () => (st.r = clampR(st.r * 1.14)),
    };
    if (map[e.key]) { e.preventDefault(); anim = null; pinned = null; map[e.key](); root.classList.add('st-used'); request(); settle(); return; }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); animateTo(HOME); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); speak(); }
  });

  // objeto bajo el puntero
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(things.filter(t => t.group).map(t => t.group), true)[0];
    return hit ? hit.object.userData.thing : null;
  }
  function hoverAt(e) {
    const t = pick(e);
    if (t === hover) return;
    hover = t; canvas.style.cursor = t ? 'pointer' : '';
    paint(); request();
  }

  // botones del diorama
  function speak() {
    const text = sayEl.textContent;
    liveEl.textContent = text;
    if (typeof Speech !== 'undefined') Speech.speak(text);
  }
  const act = {
    left: () => animateTo({ theta: st.theta + Math.PI / 4 }, 450),
    right: () => animateTo({ theta: st.theta - Math.PI / 4 }, 450),
    in: () => animateTo({ r: clampR(st.r * 0.8) }, 350),
    out: () => animateTo({ r: clampR(st.r * 1.25) }, 350),
    reset: () => animateTo(HOME),
    say: speak,
  };
  root.querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', () => { root.classList.add('st-used'); act[b.dataset.st] && act[b.dataset.st](); }));

  // semáforo: cambia cada 2.5 s (quieto con movimiento reducido o modo seguro)
  let li = 2;
  function setLight(i) { lights.forEach((m, k) => { m.material.color.set(k === i ? m.userData.on : '#2a2a2a'); m.material.emissive.set(k === i ? m.userData.on : '#000000'); m.material.emissiveIntensity = k === i ? 0.9 : 0; }); }
  setLight(li);
  const lightTimer = setInterval(() => { if (!visible || REDUCE || safeMode()) return; li = (li + 2) % 3; setLight(li); request(); }, 2500);

  // tamaño y visibilidad
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < 560 ? 34 : 30;
    camera.updateProjectionMatrix();
    // que quepa la esquina entera: en lienzos verticales o estrechos la cámara se aleja
    const fit = Math.max(1, 1.1 / camera.aspect);
    const wasHome = Math.abs(st.r - HOME.r) < 0.01 || !resized;
    HOME.r = BASE_R * fit; LIM.rMax = BASE_R * 1.6 * fit;
    if (wasHome && !anim) st.r = HOME.r;
    resized = true;
    request();
  }
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); if (visible) request(); }).observe(root);

  resize();
  root.classList.add('st-ready');
  // entrada: un giro corto para mostrar que es 3D
  if (!REDUCE && !safeMode()) { Object.assign(st, { theta: HOME.theta + 0.7, r: HOME.r * 1.12 }); animateTo(HOME, 1400); }
  else { placeCamera(); settle(); }
  request();
  // estado de solo lectura (lo usan las pruebas automáticas)
  function pointOf(cls) {
    const t = things.find(x => x.cls === cls && x.group); if (!t) return null;
    const p = t.pos.clone().setY(SIDE + t.group.userData.top * 0.5).project(camera), rc = canvas.getBoundingClientRect();
    return { x: rc.left + (p.x + 1) / 2 * rc.width, y: rc.top + (1 - p.y) / 2 * rc.height };
  }
  return { speak, pointOf, get state() { return { ...st, home: { ...HOME } }; }, dispose() { clearInterval(lightTimer); renderer.dispose(); } };
}
