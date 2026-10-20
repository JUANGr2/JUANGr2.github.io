// Almacén local (IndexedDB) y cola de cambios pendientes para trabajar sin internet.
(function (root) {
  function memoryBackend() {
    const m = new Map();
    return { get: async k => m.get(k), set: async (k, v) => { m.set(k, v); }, del: async k => { m.delete(k); } };
  }

  function idbBackend() {
    let dbp;
    const open = () => dbp || (dbp = new Promise((ok, ko) => {
      const r = indexedDB.open('visualapp', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    }));
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((ok, ko) => {
        const tx = db.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => ok(req && req.result);
        tx.onerror = () => ko(tx.error);
      });
    };
    return {
      get: k => run('readonly', s => s.get(k)),
      set: (k, v) => run('readwrite', s => s.put(v, k)),
      del: k => run('readwrite', s => s.delete(k)),
    };
  }

  const Q = '__outbox__';

  function createStore(backend) {
    let seq = 0;
    return {
      cacheGet: k => backend.get('c:' + k),
      cacheSet: (k, v) => backend.set('c:' + k, v),
      async queue() { return (await backend.get(Q)) || []; },
      async enqueue(op) {
        const q = await this.queue();
        const item = { ...op, n: Date.now() * 1000 + (seq++ % 1000) };
        q.push(item);
        await backend.set(Q, q);
        return item;
      },
      async drop(pred) {
        const q = await this.queue();
        const next = q.filter(o => !pred(o));
        await backend.set(Q, next);
        return q.length - next.length;
      },
      // Envía en orden. send(op) lanza error con .network=true si no hay red.
      // Los ids temporales ("t123") se reemplazan por los reales en operaciones posteriores.
      async flush(send) {
        const q = await this.queue();
        const idMap = {};
        let sent = 0, dropped = 0;
        while (q.length) {
          const op = { ...q[0] };
          op.path = op.path.replace(/\/(t\d+)(?=$|\?)/, (m, id) => '/' + (idMap[id] != null ? idMap[id] : id));
          if (/\/t\d+(?=$|\?)/.test(op.path)) { q.shift(); dropped++; await backend.set(Q, q); continue; }
          try {
            const res = await send(op);
            if (op.tmp && res && res.id != null) idMap[op.tmp] = res.id;
            sent++;
          } catch (e) {
            if (e && e.network) break;       // sin red: conservar y reintentar luego
            dropped++;                       // rechazado por el servidor: descartar
          }
          q.shift();
          await backend.set(Q, q);
        }
        return { sent, dropped, pending: q.length };
      },
    };
  }

  const api = { createStore, memoryBackend, idbBackend };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Store = Object.assign({}, api, { local: createStore(typeof indexedDB !== 'undefined' ? idbBackend() : memoryBackend()) });
})(typeof window !== 'undefined' ? window : globalThis);
