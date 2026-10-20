// Backend local: mismas rutas que el servidor, guardadas en el teléfono (IndexedDB). Sin red.
(function (root) {
  const PROFILES = ['visual', 'baja_vision', 'auditiva', 'cognitiva', 'lectura', 'memoria', 'epilepsia', 'motriz'];
  const HS = (typeof require === 'function' && typeof module !== 'undefined') ? require('./healthschema.js') : root.HealthSchema;
  const PHRASEBOOK = {
    'hola': 'Hello', 'gracias': 'Thank you', 'por favor': 'Please', 'sí': 'Yes', 'no': 'No', 'ayuda': 'Help',
    'quiero agua': 'I want water', 'tengo hambre': 'I am hungry', 'necesito ir al baño': 'I need to go to the bathroom',
    'necesito ayuda': 'I need help', 'me duele': 'It hurts', 'necesito un médico': 'I need a doctor',
    'no entiendo': 'I do not understand', 'más despacio, por favor': 'Slower, please', 'buenos días': 'Good morning',
    'buenas tardes': 'Good afternoon', 'buenas noches': 'Good night', 'dónde está el baño': 'Where is the bathroom',
    'cuánto cuesta': 'How much is it', 'adiós': 'Goodbye',
  };

  const fail = (status, msg, extra) => Object.assign(new Error(msg), { status }, extra || {});
  const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const okStr = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
  const okMail = v => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 120;

  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const unhex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
  async function pbkdf2(password, saltHex) {
    const subtle = (root.crypto || globalThis.crypto).subtle;
    const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'PBKDF2', salt: unhex(saltHex), iterations: 120000, hash: 'SHA-256' }, key, 256);
    return hex(bits);
  }

  function create(store) {
    const get = async (k, d) => { const v = await store.cacheGet('L:' + k); return v === undefined ? d : v; };
    const set = (k, v) => store.cacheSet('L:' + k, v);

    async function me() {
      const id = await get('session', null);
      if (id == null) throw fail(401, 'No autenticado');
      const u = (await get('users', [])).find(x => x.id === id);
      if (!u) throw fail(401, 'Sesión inválida');
      return u;
    }
    const nextId = async () => { const n = (await get('seq', 0)) + 1; await set('seq', n); return n; };
    const pub = u => ({ id: u.id, name: u.name, email: u.email, role: 'user', disability: u.disability, active: 1 });

    async function register(b) {
      const list = Array.isArray(b.profiles) ? b.profiles : [b.disability];
      const profiles = [...new Set(list.flatMap(p => (p === 'ambas' ? ['visual', 'auditiva'] : [p])))].filter(p => PROFILES.includes(p));
      if (!okStr(b.name, 2, 60)) throw fail(400, 'Nombre inválido (2-60 caracteres)');
      if (!okMail(b.email)) throw fail(400, 'Correo inválido');
      if (!okStr(b.password, 8, 100)) throw fail(400, 'La contraseña debe tener al menos 8 caracteres');
      if (!profiles.length) throw fail(400, 'Elige al menos un tipo de apoyo');
      if (b.acceptTerms !== true) throw fail(400, 'Debes aceptar el acuerdo de uso');
      const users = await get('users', []);
      const email = b.email.trim().toLowerCase();
      if (users.some(u => u.email === email)) throw fail(409, 'Ese correo ya está registrado en este teléfono');
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      const u = { id: await nextId(), name: b.name.trim(), email, salt, hash: await pbkdf2(b.password, salt), disability: profiles.join(','), created_at: now() };
      users.push(u);
      await set('users', users);
      await set('session', u.id);
      return { id: u.id, name: u.name, role: 'user', disability: u.disability };
    }

    async function login(b) {
      if (!okMail(b.email) || typeof b.password !== 'string') throw fail(400, 'Datos inválidos');
      const u = (await get('users', [])).find(x => x.email === b.email.trim().toLowerCase());
      if (!u || (await pbkdf2(b.password, u.salt)) !== u.hash) throw fail(401, 'Correo o contraseña incorrectos');
      await set('session', u.id);
      return { id: u.id, name: u.name, role: 'user', disability: u.disability };
    }

    // listas por usuario
    const key = (u, name) => `u${u.id}:${name}`;
    const listGet = (u, n) => get(key(u, n), []);
    const listSet = (u, n, v) => set(key(u, n), v);

    async function handle(method, fullPath, body = {}) {
      const [path, qs] = fullPath.split('?');
      const q = Object.fromEntries(new URLSearchParams(qs || ''));
      const m = method.toUpperCase();

      // --- sin sesión ---
      if (path === '/auth/register' && m === 'POST') return register(body);
      if (path === '/auth/login' && m === 'POST') return login(body);
      if (path === '/auth/logout' && m === 'POST') { await set('session', null); return { ok: true }; }
      if (path === '/health') return { ok: true, local: true };
      if (path === '/vision/status') return { cloud: false };

      const u = await me();
      if (path === '/auth/me' && m === 'GET') return pub(u);
      if (path.startsWith('/admin')) throw fail(403, 'El panel de administración no está disponible en modo local');
      if (path === '/vision/describe') throw fail(503, 'Descripción en la nube no disponible sin servidor');

      // --- ajustes ---
      if (path === '/me/settings') {
        if (m === 'GET') return get(key(u, 'settings'), { voice_rate: 1, contrast: 0, font_size: 18, vibration: 1 });
        const s = {
          voice_rate: Math.max(0.5, Math.min(2, Number(body.voice_rate) || 1)),
          contrast: body.contrast ? 1 : 0,
          font_size: Math.max(14, Math.min(32, parseInt(body.font_size) || 18)),
          vibration: body.vibration ? 1 : 0,
        };
        await set(key(u, 'settings'), s);
        return s;
      }

      // --- contactos / frases / recordatorios ---
      const defs = {
        '/me/contacts': { n: 'contacts', max: 5, build: b => {
          if (!okStr(b.name, 2, 50)) throw fail(400, 'Nombre inválido');
          if (typeof b.phone !== 'string' || !/^\+?[0-9 ()-]{7,20}$/.test(b.phone)) throw fail(400, 'Teléfono inválido');
          return { name: b.name.trim(), phone: b.phone.trim() };
        }, maxMsg: 'Máximo 5 contactos' },
        '/phrases': { n: 'phrases', max: 40, build: b => {
          if (!okStr(b.text, 1, 120)) throw fail(400, 'Frase inválida');
          return { emoji: typeof b.emoji === 'string' && b.emoji.trim() ? [...b.emoji.trim()].slice(0, 2).join('') : '💬', text: b.text.trim() };
        }, maxMsg: 'Máximo 40 frases' },
        '/reminders': { n: 'reminders', max: 30, build: b => {
          if (!okStr(b.title, 1, 80)) throw fail(400, 'Título inválido');
          if (typeof b.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time)) throw fail(400, 'Hora inválida (HH:MM)');
          return { title: b.title.trim(), time: b.time, active: 1 };
        }, maxMsg: 'Máximo 30 recordatorios' },
      };
      // colecciones de salud (esquemas compartidos con el servidor)
      for (const [kind, k] of Object.entries(HS.KINDS)) {
        defs['/' + kind] = { n: kind, max: k.max, maxMsg: k.maxMsg, build: b => { try { return k.clean(b); } catch (e) { throw fail(400, e.message); } } };
      }
      if (path === '/medical') {
        if (m === 'GET') return get(key(u, 'medical'), HS.cleanMedical({}));
        const doc = HS.cleanMedical(body);
        await set(key(u, 'medical'), doc);
        return doc;
      }
      const baseKey = Object.keys(defs).find(k => path === k || path.startsWith(k + '/'));
      if (baseKey) {
        const d = defs[baseKey];
        const list = await listGet(u, d.n);
        const idStr = path.slice(baseKey.length + 1);
        if (!idStr && m === 'GET') return d.n === 'reminders' ? [...list].sort((a, b) => a.time.localeCompare(b.time)) : d.n === 'crises' ? [...list].sort((a, b) => b.started_at.localeCompare(a.started_at)) : list;
        if (!idStr && m === 'POST') {
          if (list.length >= d.max) throw fail(400, d.maxMsg);
          const item = { id: await nextId(), ...d.build(body) };
          list.push(item);
          await listSet(u, d.n, list);
          return item;
        }
        if (idStr && m === 'DELETE') { await listSet(u, d.n, list.filter(x => String(x.id) !== idStr)); return { ok: true }; }
        if (idStr && m === 'PATCH' && d.n === 'medicines') {
          const cur = list.find(x => String(x.id) === idStr);
          if (!cur) throw fail(404, 'No encontrado');
          const upd = d.build({ ...cur, ...body });
          await listSet(u, d.n, list.map(x => (String(x.id) === idStr ? { id: x.id, ...upd } : x)));
          return { ok: true };
        }
        if (idStr && m === 'PATCH' && d.n === 'reminders') {
          await listSet(u, d.n, list.map(x => (String(x.id) === idStr ? { ...x, active: body.active ? 1 : 0 } : x)));
          return { ok: true };
        }
      }

      // --- escaneos / historial ---
      if (path === '/scans' && m === 'POST') {
        if (!['objetos', 'texto', 'alerta', 'escena', 'traduccion', 'color'].includes(body.type)) throw fail(400, 'Tipo inválido');
        if (!okStr(body.result, 1, 1000)) throw fail(400, 'Resultado inválido');
        const list = await listGet(u, 'scans');
        const row = { id: await nextId(), type: body.type, result: body.result.trim(), label: typeof body.label === 'string' ? body.label.slice(0, 60) : null, confidence: Number.isFinite(body.confidence) ? body.confidence : null, created_at: now() };
        list.unshift(row);
        await listSet(u, 'scans', list.slice(0, 500));       // tope para no crecer sin límite
        return { id: row.id };
      }
      if (path === '/scans' && m === 'GET') {
        const page = Math.max(1, parseInt(q.page) || 1), size = Math.min(50, Math.max(1, parseInt(q.size) || 20));
        const all = await listGet(u, 'scans');
        return { page, size, total: all.length, rows: all.slice((page - 1) * size, page * size) };
      }
      if (path === '/scans' && m === 'DELETE') { await listSet(u, 'scans', []); return { ok: true }; }
      if (path === '/scans/stats') {
        const all = await listGet(u, 'scans');
        const c = {};
        all.forEach(r => { if (r.label) c[r.label] = (c[r.label] || 0) + 1; });
        const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, n]) => ({ label, c: n }));
        return { total: all.length, top };
      }

      // --- que requieren internet ---
      if (path === '/translate' && m === 'POST') {
        const hit = body.from === 'es' && body.to === 'en' ? PHRASEBOOK[String(body.text || '').trim().toLowerCase().replace(/[¿?¡!.]+/g, '')] : null;
        if (hit) return { text: hit, cached: true };
        throw fail(503, 'Sin internet: solo traduzco frases comunes del español al inglés.', { network: true });
      }
      if (path === '/geo/reverse') throw fail(503, 'La dirección requiere internet', { network: true });

      throw fail(404, 'No encontrado');
    }

    return { handle };
  }

  const api = { create, PHRASEBOOK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LocalAPI = api;
})(typeof window !== 'undefined' ? window : globalThis);
