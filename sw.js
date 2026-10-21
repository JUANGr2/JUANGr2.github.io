// Service worker: funciona sin internet. Precachea la app y, aparte, la IA local.
const VERSION = '5debc108a5';
const SHELL_CACHE = 'va-shell-' + VERSION;
const AI_CACHE = 'va-ai-v1';

async function manifest() {
  const r = await fetch('/precache.json', { cache: 'no-store' });
  return r.json();
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    try {
      const m = await manifest();
      const c = await caches.open(SHELL_CACHE);
      for (const u of m.shell) {
        try { const r = await fetch(u, { cache: 'reload' }); if (r.ok) await c.put(u, r); } catch {}
      }
    } catch {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, AI_CACHE]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// descarga la IA (modelo y OCR) en segundo plano, con progreso
self.addEventListener('message', e => {
  if (e.data !== 'cache-ai') return;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll();
    const say = msg => all.forEach(c => c.postMessage(msg));
    try {
      const m = await manifest();
      const c = await caches.open(AI_CACHE);
      let done = 0;
      for (const u of m.ai) {
        if (!(await c.match(u))) {
          try { const r = await fetch(u); if (r.ok) await c.put(u, r); }
          catch (err) { say({ type: 'ai-progress', error: true, why: String(err), url: u }); return; }
        }
        done++;
        say({ type: 'ai-progress', done, total: m.ai.length });
      }
      say({ type: 'ai-ready' });
    } catch { say({ type: 'ai-progress', error: true }); }
  })());
});

function timeout(ms) { return new Promise((_, ko) => setTimeout(() => ko(new Error('timeout')), ms)); }

self.addEventListener('fetch', e => {
  const req = e.request;
  const u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;

  // IA: primero caché (pesa mucho y no cambia); sus .json (etiquetas, configuración) son chicos y pueden cambiar: van por la red
  if (u.pathname.startsWith('/vendor/') && !u.pathname.endsWith('.json')) {
    e.respondWith((async () => {
      const hit = await caches.match(req, { cacheName: AI_CACHE });
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) { const c = await caches.open(AI_CACHE); c.put(req, r.clone()); }
      return r;
    })());
    return;
  }

  // resto: red primero (con tope de 3 s) y caché de respaldo → abre sin internet
  e.respondWith((async () => {
    try {
      const r = await Promise.race([fetch(req, { cache: 'no-cache' }), timeout(3000)]);
      if (r.ok) { const c = await caches.open(SHELL_CACHE); c.put(req, r.clone()); }
      return r;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        return (await caches.match('/app.html')) || (await caches.match('/offline.html')) || Response.error();
      }
      return Response.error();
    }
  })());
});
