// Cliente API con modo sin conexión: lecturas desde caché local y escrituras en cola.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Modo local: dentro del APK (Capacitor) o con ?local=1 todo vive en el teléfono, sin servidor.
const LOCAL = (() => {
  try {
    const qs = new URLSearchParams(location.search).get('local');
    if (qs === '1') localStorage.setItem('va_mode', 'local');
    if (qs === '0') localStorage.removeItem('va_mode');
    const cap = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    const shell = location.protocol === 'https:' && location.hostname === 'localhost';   // esquema del WebView de Capacitor
    const pages = /\.github\.io$/i.test(location.hostname);                               // página publicada sin servidor (GitHub Pages)
    return !!(cap || shell || pages || localStorage.getItem('va_mode') === 'local');
  } catch { return false; }
})();
const localApi = LOCAL && typeof LocalAPI !== 'undefined' ? LocalAPI.create(Store.local) : null;

const Net = { offline: false, listeners: new Set(), pending: 0, ai: null };
function netChanged() { Net.listeners.forEach(f => f(Net)); }
function setOffline(v) {
  if (Net.offline === v) return;
  Net.offline = v;
  netChanged();
}
async function refreshPending() {
  try { Net.pending = (await Store.local.queue()).length; } catch { Net.pending = 0; }
  netChanged();
}

async function net(path, opts = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
  } catch (e) {
    throw Object.assign(new Error('Sin conexión'), { network: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Error de red'), { status: res.status });
  return data;
}

// listas editables sin internet
const LISTS = { '/phrases': 'GET /phrases', '/reminders': 'GET /reminders', '/me/contacts': 'GET /me/contacts', '/people': 'GET /people', '/crises': 'GET /crises', '/medicines': 'GET /medicines' };
const tmpId = () => 't' + Date.now() + Math.floor(Math.random() * 100);

async function listUpdate(key, fn) {
  const cur = (await Store.local.cacheGet(key)) || [];
  await Store.local.cacheSet(key, fn(cur));
}

async function queueWrite(method, path, body) {
  const parts = path.split('/').filter(Boolean);
  const idm = path.match(/\/(t?\d+)$/);
  const base = '/' + (idm ? parts.slice(0, -1) : parts).join('/');

  if (method === 'POST' && (LISTS[path] || path === '/scans')) {
    const tmp = tmpId();
    await Store.local.enqueue({ method, path, body, tmp });
    if (LISTS[path]) await listUpdate(LISTS[path], l => [...l, Object.assign({ id: tmp, active: 1 }, body)]);
    await refreshPending();
    return Object.assign({ id: tmp, active: 1, offline: true }, body);
  }
  if (method === 'PUT' && (path === '/me/settings' || path === '/medical')) {
    await Store.local.drop(o => o.method === 'PUT' && o.path === path);
    await Store.local.enqueue({ method, path, body });
    await Store.local.cacheSet('GET ' + path, body);
    await refreshPending();
    return Object.assign({ offline: true }, body);
  }
  if (idm && LISTS[base] && (method === 'DELETE' || method === 'PATCH')) {
    const id = idm[1];
    if (method === 'DELETE') {
      const removed = id.startsWith('t') ? await Store.local.drop(o => o.tmp === id) : 0;   // aún no enviado
      if (!removed) await Store.local.enqueue({ method, path, body });
      await listUpdate(LISTS[base], l => l.filter(x => String(x.id) !== id));
    } else {
      await Store.local.enqueue({ method, path, body });
      await listUpdate(LISTS[base], l => l.map(x => (String(x.id) === id ? Object.assign({}, x, body) : x)));
    }
    await refreshPending();
    return { ok: true, offline: true };
  }
  return null;
}

async function api(path, opts = {}) {
  const method = opts.method || 'GET';
  if (localApi) return localApi.handle(method, path, opts.body || {});
  try {
    const data = await net(path, opts);
    setOffline(false);
    if (method === 'GET') Store.local.cacheSet('GET ' + path, data).catch(() => {});
    return data;
  } catch (e) {
    if (!e.network) throw e;
    setOffline(true);
    if (method === 'GET') {
      const hit = await Store.local.cacheGet('GET ' + path);
      if (hit !== undefined) return hit;
      throw Object.assign(new Error('Sin conexión y sin datos guardados'), { network: true });
    }
    const q = await queueWrite(method, path, opts.body);
    if (q) return q;
    throw Object.assign(new Error('Esta acción requiere internet'), { network: true });
  }
}

// reenvía lo pendiente cuando vuelve la red
let flushing = false;
async function syncNow() {
  if (flushing) return;
  flushing = true;
  try {
    const r = await Store.local.flush(op => net(op.path, { method: op.method, body: op.body }));
    if (r.pending === 0) setOffline(false);
    window.dispatchEvent(new CustomEvent('va:synced', { detail: r }));
  } catch {}
  flushing = false;
  refreshPending();
}
if (!LOCAL) addEventListener('online', syncNow);
document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine) syncNow(); });
addEventListener('offline', () => setOffline(true));
addEventListener('load', () => { if (LOCAL) return; refreshPending(); if (navigator.onLine) syncNow(); });

function applyPrefs(p) {
  document.body.classList.toggle('hc', !!p.contrast);
  document.documentElement.style.setProperty('--fs', (p.font_size || 18) + 'px');
}

if ('serviceWorker' in navigator && !LOCAL) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      // descarga la IA en segundo plano para usarla sin internet
      const go = () => { const s = navigator.serviceWorker.controller || reg.active; if (s) s.postMessage('cache-ai'); };
      if (reg.active) go(); else navigator.serviceWorker.ready.then(go);
    }).catch(() => {});
  });
  navigator.serviceWorker.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type === 'ai-progress' || d.type === 'ai-ready') { Net.ai = d; netChanged(); }
  });
}
