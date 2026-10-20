// Cámara: abre la trasera de verdad (o la que haya), decide el espejo según lo que reporta la cámara
// abierta (no lo que se pidió) y recuerda la elección. No toca el navegador al cargar: se prueba en Node.
const Camera = (() => {
  const FRONT_RE = /front|frontal|selfie|delantera/i;
  const BACK_RE = /back|rear|trasera|posterior|environment/i;
  const KEY = 'va_cam';
  const FATAL = new Set(['NotAllowedError', 'SecurityError']);
  const BUSY = new Set(['NotReadableError', 'TrackStartError', 'AbortError']);
  const NONE = new Set(['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError', 'ConstraintNotSatisfiedError']);

  const isFront = label => FRONT_RE.test(String(label || ''));
  const isBack = label => !isFront(label) && BACK_RE.test(String(label || ''));
  const camNumber = label => { const m = /camera2?\s*(\d+)/i.exec(String(label || '')); return m ? Number(m[1]) : Infinity; };

  // la cámara del lado pedido según su nombre; entre varias traseras, la principal (número más bajo)
  function pick(devices, facing) {
    const want = facing === 'user' ? isFront : isBack;
    const list = devices.filter(d => d.kind === 'videoinput' && d.label && want(d.label));
    if (!list.length) return null;
    return list.slice().sort((a, b) => camNumber(a.label) - camNumber(b.label))[0].deviceId;
  }

  function isMirrored(settings, label) {
    const f = settings && settings.facingMode;
    return f ? f === 'user' : isFront(label);
  }

  function explain(err) {
    const n = err && err.name;
    if (FATAL.has(n)) return 'No tengo permiso para usar la cámara. Dale permiso en los ajustes del celular o del navegador y vuelve a intentar.';
    if (BUSY.has(n)) return 'La cámara está ocupada por otra app. Ciérrala y vuelve a intentar.';
    if (NONE.has(n)) return 'No encontré una cámara disponible en este dispositivo.';
    return 'No se pudo abrir la cámara: ' + ((err && err.message) || 'error desconocido');
  }

  const stopAll = s => { try { s.getTracks().forEach(t => t.stop()); } catch { /* ya cerrada */ } };

  function describe(stream, wanted) {
    const t = stream.getVideoTracks()[0];
    const settings = (t && t.getSettings && t.getSettings()) || {};
    const label = (t && t.label) || '';
    const facing = settings.facingMode || (isFront(label) ? 'user' : isBack(label) ? 'environment' : wanted);
    return { stream, deviceId: settings.deviceId || '', label, facing, mirrored: isMirrored(settings, label) };
  }

  // 1) la guardada, 2) el lado pedido de forma estricta, 3) cualquiera y luego la del lado pedido por su nombre
  async function open({ facing = 'environment', res = {}, saved = {}, md = navigator.mediaDevices, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    let lastErr = null;
    const get = async video => {
      try { return await md.getUserMedia({ video, audio: false }); }
      catch (e) {
        if (!BUSY.has(e.name)) throw e;
        await wait(500);                                   // ocupada: se repite una vez el mismo intento
        return md.getUserMedia({ video, audio: false });
      }
    };
    const attempt = async video => {
      try { return await get(video); }
      catch (e) { if (FATAL.has(e.name)) throw e; lastErr = e; return null; }
    };

    let s = null;
    if (saved && saved.deviceId && saved.facing === facing) s = await attempt({ ...res, deviceId: { exact: saved.deviceId } });
    if (!s) s = await attempt({ ...res, facingMode: { exact: facing } });
    if (!s) {
      s = await attempt({ ...res });
      if (!s) throw lastErr || Object.assign(new Error('sin cámara'), { name: 'NotFoundError' });
      let id = null;
      try { id = pick(await md.enumerateDevices(), facing); } catch { /* sin lista: se queda la abierta */ }
      if (id && id !== describe(s, facing).deviceId) {
        stopAll(s);
        s = (await attempt({ ...res, deviceId: { exact: id } })) || (await attempt({ ...res }));
        if (!s) throw lastErr;
      }
    }
    return describe(s, facing);
  }

  function load(storage) {
    try {
      const v = JSON.parse((storage || localStorage).getItem(KEY) || '{}') || {};
      const out = {};
      if (v.facing === 'environment' || v.facing === 'user') out.facing = v.facing;
      if (typeof v.deviceId === 'string' && v.deviceId) out.deviceId = v.deviceId;
      return out;
    } catch { return {}; }
  }
  function save(v, storage) {
    try { (storage || localStorage).setItem(KEY, JSON.stringify({ facing: v.facing, deviceId: v.deviceId })); } catch { /* sin almacenamiento */ }
  }

  // ¿se abre sola al entrar en la cámara? 'start' | 'denied' (decir cómo dar el permiso) | 'ask' (invitar a pulsar el ojo).
  // Nunca pide el permiso por su cuenta. intent: va_autoscan ('0' si la persona lo detuvo); permission: estado de la consulta
  // (null si falló); camok: va_camok ('1' si ya abrió bien); native: app de Android, donde la consulta dice «prompt» aunque haya permiso.
  function autoStart({ intent, permission, camok, native }) {
    if (permission === 'denied') return 'denied';
    if (intent === '0') return 'ask';
    if (permission === 'granted') return 'start';
    if (camok === '1' && (native || permission == null)) return 'start';
    return 'ask';
  }

  return { isFront, isBack, pick, isMirrored, open, explain, load, save, autoStart };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Camera;
