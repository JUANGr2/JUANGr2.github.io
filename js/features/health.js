// Memoria (personas, ficha, estoy perdido), registro de crisis y modo calma.
const iconBtn = (id, label, ic, cls = 'sm danger') =>
  `<button class="btn ${cls}" data-del="${id}" aria-label="${esc(label)}"><svg class="ic" aria-hidden="true"><use href="/icons/sprite.svg#${ic}"/></svg></button>`;
const fmtDur = s => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);
const fmtDate = iso => { try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } };

// ---------------- Mis personas ----------------
const People = (() => {
  async function load() {
    const list = await api('/people').catch(() => []);
    $('#pe-list').innerHTML = list.length ? list.map(p => `<li>
        <span><b>${esc(p.name)}</b>${p.relation ? ` · ${esc(p.relation)}` : ''}${p.note ? `<br><small>${esc(p.note)}</small>` : ''}</span>
        <span class="row">${p.phone ? `<a class="btn sm primary" href="tel:${esc(p.phone)}" aria-label="Llamar a ${esc(p.name)}"><svg class="ic" aria-hidden="true"><use href="/icons/sprite.svg#i-phone"/></svg></a>` : ''}
        <button class="btn sm gray" data-say="${p.id}" aria-label="Escuchar sobre ${esc(p.name)}"><svg class="ic" aria-hidden="true"><use href="/icons/sprite.svg#i-sound"/></svg></button>
        ${iconBtn(p.id, 'Eliminar a ' + p.name, 'i-x')}</span></li>`).join('')
      : '<li class="empty"><span>Aún no hay personas. Agrega a tu familia y cuidadores para recordar quién es quién.</span><button class="btn sm primary" data-focus="#pe-name">Agregar la primera</button></li>';
    $$('#pe-list [data-del]').forEach(b => b.onclick = async () => { await api('/people/' + b.dataset.del, { method: 'DELETE' }); load(); });
    $$('#pe-list [data-say]').forEach(b => b.onclick = () => {
      const p = list.find(x => String(x.id) === b.dataset.say);
      if (p) Speech.speak(`${p.name}${p.relation ? ', ' + p.relation : ''}. ${p.note || ''}`);
    });
  }
  function init() {
    $('#f-person').onsubmit = async e => {
      e.preventDefault();
      try {
        await api('/people', { method: 'POST', body: { name: $('#pe-name').value, relation: $('#pe-rel').value, phone: $('#pe-phone').value, note: $('#pe-note').value } });
        e.target.reset(); $('#pe-msg').innerHTML = ''; load();
      } catch (x) { $('#pe-msg').innerHTML = `<div class="msg err">${esc(x.message)}</div>`; }
    };
  }
  return { init, load };
})();

// ---------------- ¿Quién soy? + Estoy perdido ----------------
const MedicalID = (() => {
  const F = ['full_name', 'birth', 'blood', 'allergies', 'conditions', 'medications', 'address', 'notes'];
  const LABEL = { full_name: 'Nombre', birth: 'Nacimiento', blood: 'Sangre', allergies: 'Alergias', conditions: 'Condiciones', medications: 'Medicinas', address: 'Dirección', notes: 'Notas' };
  let doc = {};

  const sentence = () => F.filter(k => doc[k]).map(k => `${LABEL[k]}: ${doc[k]}`).join('. ');

  function render() {
    const rows = F.filter(k => doc[k]);
    $('#id-card').innerHTML = rows.length
      ? rows.map(k => `<div class="id-row"><span class="mute">${LABEL[k]}</span><b>${esc(doc[k])}</b></div>`).join('')
      : '<p class="mute">Completa tu ficha abajo. Podrás mostrarla o escucharla en una emergencia.</p>';
    F.forEach(k => { const i = $('#md-' + k); if (i) i.value = doc[k] || ''; });
  }
  async function load() { doc = await api('/medical').catch(() => ({})); render(); }

  async function lost() {
    const out = $('#lost-out');
    out.hidden = false; out.className = 'msg ok';
    out.textContent = 'Buscando tu ubicación…';
    const contacts = await api('/me/contacts').catch(() => []);
    const c = contacts[0];
    const finish = async pos => {
      let where = '';
      if (pos) {
        const { latitude: la, longitude: lo } = pos.coords;
        try { const r = await api(`/geo/reverse?lat=${la}&lon=${lo}`); where = r.address || ''; } catch {}
        const link = `https://maps.google.com/?q=${la},${lo}`;
        const body = encodeURIComponent(`Estoy perdido y necesito ayuda. Soy ${doc.full_name || (user && user.name) || ''}. ${where ? 'Estoy cerca de: ' + where + '. ' : ''}Mi ubicación: ${link}`);
        const say = `Tranquilo. Estás cerca de ${where || 'esta ubicación'}. ${c ? 'Voy a avisar a ' + c.name + '.' : 'Agrega un contacto de emergencia.'}`;
        out.innerHTML = `${esc(say)}<div class="row" style="margin-top:10px">${c ? `<a class="btn sm primary" href="sms:${esc(c.phone)}?body=${body}">Avisar a ${esc(c.name)}</a><a class="btn sm danger" href="tel:${esc(c.phone)}">Llamar</a>` : ''}</div>`;
        Speech.speak(say);
      } else {
        const say = `Tranquilo. Soy ${doc.full_name || 'VISUALAPP'}. ${doc.address ? 'Mi casa es: ' + doc.address + '.' : ''} ${c ? 'Llama a ' + c.name + '.' : ''}`;
        out.className = 'msg err';
        out.innerHTML = `No pude obtener tu ubicación. ${esc(say)}${c ? `<div class="row" style="margin-top:10px"><a class="btn sm danger" href="tel:${esc(c.phone)}">Llamar a ${esc(c.name)}</a></div>` : ''}`;
        Speech.speak(say);
      }
      Speech.buzz([300, 100, 300]);
    };
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(finish, () => finish(null), { enableHighAccuracy: true, timeout: 10000 });
    else finish(null);
  }

  function init() {
    $('#f-medical').onsubmit = async e => {
      e.preventDefault();
      const body = {};
      F.forEach(k => { body[k] = $('#md-' + k).value; });
      try { doc = await api('/medical', { method: 'PUT', body }); render(); $('#md-msg').innerHTML = '<div class="msg ok">Ficha guardada</div>'; }
      catch (x) { $('#md-msg').innerHTML = `<div class="msg err">${esc(x.message)}</div>`; }
    };
    $('#id-say').onclick = () => Speech.speak(sentence() || 'Tu ficha está vacía.');
    $('#id-lost').onclick = lost;
  }
  return { init, load, lost, get doc() { return doc; } };
})();

// ---------------- Registro de crisis ----------------
const Crisis = (() => {
  let t0 = 0, timer = null;
  const GUIDE = [
    'Mantén la calma y mira la hora. Cuenta cuánto dura.',
    'Despeja el área y aleja objetos con los que pueda golpearse.',
    'Protege la cabeza con algo blando. No sujetes a la persona.',
    'No pongas nada en la boca. Gira de lado cuando termine la convulsión.',
    'Llama a emergencias si dura más de 5 minutos, si hay otra crisis seguida o si se lastimó.',
  ];

  function tick() {
    const s = Math.floor((Date.now() - t0) / 1000);
    $('#cr-timer').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    if (s === 300) { Speech.speak('Han pasado cinco minutos. Llama a emergencias.'); Speech.buzz([500, 200, 500]); }
  }
  async function list() {
    const rows = await api('/crises').catch(() => []);
    $('#cr-list').innerHTML = rows.length ? rows.map(r => `<li><span><b>${esc(fmtDur(r.duration_s))}</b> · ${esc(fmtDate(r.started_at))}${r.note ? `<br><small>${esc(r.note)}</small>` : ''}</span>${iconBtn(r.id, 'Eliminar registro', 'i-x')}</li>`).join('')
      : '<li><small>Sin registros.</small></li>';
    $$('#cr-list [data-del]').forEach(b => b.onclick = async () => { await api('/crises/' + b.dataset.del, { method: 'DELETE' }); list(); });
  }
  async function toggle() {
    const btn = $('#cr-start');
    if (!t0) {
      t0 = Date.now();
      timer = setInterval(tick, 500); tick();
      btn.textContent = 'Terminar y guardar';
      btn.classList.add('danger'); btn.classList.remove('primary');
      Speech.speak('Cronómetro iniciado. ' + GUIDE[0]);
    } else {
      clearInterval(timer);
      const dur = Math.round((Date.now() - t0) / 1000);
      const started = new Date(t0).toISOString();
      t0 = 0;
      btn.textContent = 'Iniciar crisis';
      btn.classList.remove('danger'); btn.classList.add('primary');
      try { await api('/crises', { method: 'POST', body: { started_at: started, duration_s: dur, note: $('#cr-note').value } }); }
      catch (x) { $('#cr-msg').innerHTML = `<div class="msg err">${esc(x.message)}</div>`; }
      $('#cr-note').value = '';
      $('#cr-timer').textContent = '00:00';
      Speech.speak(`Registrado: ${fmtDur(dur)}.`);
      list();
    }
  }
  function init() {
    $('#cr-guide').innerHTML = GUIDE.map(g => `<li><span>${esc(g)}</span></li>`).join('');
    $('#cr-start').onclick = toggle;
    $('#cr-say').onclick = () => Speech.speak(GUIDE.join(' '));
    $('#cr-help').onclick = () => { show('s-sos'); setTimeout(() => $('#btn-sos').click(), 150); };
  }
  return { init, list, get running() { return !!t0; } };
})();

// ---------------- Calma (respiración y silencio) ----------------
const Calm = (() => {
  let on = false, timers = [];
  function clear() { timers.forEach(clearTimeout); timers = []; }
  function stop() {
    on = false; clear();
    const c = $('#calm-circle'), t = $('#calm-text'), b = $('#calm-start');
    if (c) c.className = 'calm-circle';
    if (t) t.textContent = 'Respira conmigo';
    if (b) b.textContent = 'Empezar';
  }
  function cycle() {
    if (!on) return;
    const c = $('#calm-circle'), t = $('#calm-text');
    const step = (txt, cls, ms, next, say) => {
      t.textContent = txt; c.className = 'calm-circle ' + cls;
      if (say) Speech.speak(say);
      timers.push(setTimeout(next, ms));
    };
    step('Inhala', 'in', 4000, () => step('Sostén', 'hold', 2000, () => step('Exhala', 'out', 6000, cycle, 'Exhala'), null), 'Inhala');
  }
  function start() {
    if (on) return stop();
    on = true; $('#calm-start').textContent = 'Detener';
    cycle();
  }
  function init() {
    $('#calm-start').onclick = start;
    $('#calm-quiet').onclick = () => { $('#quiet').hidden = false; };
    $('#quiet').onclick = () => { $('#quiet').hidden = true; };
  }
  return { init, stop };
})();
