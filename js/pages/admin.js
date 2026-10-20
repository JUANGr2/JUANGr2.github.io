let me, uPage = 1, uTotal = 0;
const SIZE = 15;
const note = (t, ok = true) => { $('#note').innerHTML = `<div class="msg ${ok ? 'ok' : 'err'}">${esc(t)}</div>`; };

(async () => {
  try { me = await api('/auth/me'); if (me.role !== 'admin') throw 0; }
  catch { return (location.href = '/login.html'); }
  loadStats();
})();

$('#logout').onclick = async () => { await api('/auth/logout', { method: 'POST' }); location.href = '/'; };

$$('[data-t]').forEach(b => b.onclick = () => {
  $$('[data-t]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
  $$('.screen').forEach(p => p.classList.toggle('active', p.id === b.dataset.t));
  ({ 't-dash': loadStats, 't-users': loadUsers, 't-scans': loadScans, 't-audit': loadAudit })[b.dataset.t]();
});

const bars = (rows, k, v) => {
  const max = Math.max(1, ...rows.map(r => r[v]));
  return rows.length ? rows.map(r => `<div class="bar-row" style="margin:12px 0"><small>${esc(r[k])} · ${r[v]}</small>
    <div class="barfill" style="width:${Math.max(4, r[v] / max * 100)}%"></div></div>`).join('') : '<small>Sin datos</small>';
};

async function loadStats() {
  const s = await api('/admin/stats');
  $('#kpis').innerHTML = [['Usuarios', s.users], ['Admins', s.admins], ['Inactivos', s.inactive], ['Escaneos', s.scans], ['Hoy', s.scansToday]]
    .map(([l, n]) => `<div class="kpi"><b>${n}</b>${l}</div>`).join('');
  $('#perday').innerHTML = bars(s.perDay, 'd', 'c');
  $('#toplabels').innerHTML = bars(s.topLabels, 'label', 'c');
  $('#bydis').innerHTML = bars(s.byDisability, 'disability', 'c');
}

async function loadUsers() {
  const r = await api(`/admin/users?page=${uPage}&size=${SIZE}&q=${encodeURIComponent($('#q').value)}`);
  uTotal = r.total;
  $('#u-page').textContent = `Página ${uPage} de ${Math.max(1, Math.ceil(r.total / SIZE))} · ${r.total} usuarios`;
  $('#users').innerHTML = r.rows.map(u => `<tr>
    <td data-label="Nombre">${esc(u.name)}</td><td data-label="Correo">${esc(u.email)}</td><td data-label="Perfil">${esc(String(u.disability).replace(/,/g, ', '))}</td><td data-label="Rol">${esc(u.role)}</td><td data-label="Registros">${u.scans}</td>
    <td data-label="Estado"><span class="pill ${u.active ? 'on' : 'off'}">${u.active ? 'activo' : 'inactivo'}</span></td>
    <td class="row actions">${u.id === me.id ? '<small>tú</small>' : `
      <button class="btn sm" data-act="toggle" data-id="${u.id}" data-v="${u.active ? 0 : 1}">${u.active ? 'Desactivar' : 'Activar'}</button>
      <button class="btn sm gray" data-act="role" data-id="${u.id}" data-v="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>
      <button class="btn sm" data-act="reset" data-id="${u.id}">Reset clave</button>
      <button class="btn sm danger" data-act="del" data-id="${u.id}">Eliminar</button>`}</td></tr>`).join('');
}
$('#users').onclick = async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id;
  try {
    if (b.dataset.act === 'toggle') await api('/admin/users/' + id, { method: 'PATCH', body: { active: b.dataset.v === '1' } });
    if (b.dataset.act === 'role') await api('/admin/users/' + id, { method: 'PATCH', body: { role: b.dataset.v } });
    if (b.dataset.act === 'reset') { const r = await api(`/admin/users/${id}/reset-password`, { method: 'POST' }); note('Contraseña temporal: ' + r.tempPassword + ' (entrégala al usuario)'); }
    if (b.dataset.act === 'del') { if (!confirm('¿Eliminar usuario y todos sus datos?')) return; await api('/admin/users/' + id, { method: 'DELETE' }); note('Usuario eliminado'); }
    loadUsers();
  } catch (x) { note(x.message, false); }
};
$('#q-go').onclick = () => { uPage = 1; loadUsers(); };
$('#q').onkeydown = e => { if (e.key === 'Enter') $('#q-go').click(); };
$('#u-prev').onclick = () => { if (uPage > 1) { uPage--; loadUsers(); } };
$('#u-next').onclick = () => { if (uPage * SIZE < uTotal) { uPage++; loadUsers(); } };

async function loadScans() {
  const r = await api('/admin/scans?size=50');
  $('#scans').innerHTML = r.rows.map(s => `<tr><td data-label="Fecha">${esc(s.created_at)}</td><td data-label="Usuario">${esc(s.user)}</td><td data-label="Tipo">${esc(s.type)}</td><td data-label="Resultado">${esc(s.result)}</td></tr>`).join('')
    || '<tr><td colspan="4">Sin escaneos</td></tr>';
}
async function loadAudit() {
  const r = await api('/admin/audit');
  $('#audit').innerHTML = r.map(a => `<tr><td data-label="Fecha">${esc(a.created_at)}</td><td data-label="Actor">${a.actor_id ?? '-'}</td><td data-label="Acción">${esc(a.action)}</td><td data-label="Detalle">${esc(a.detail)}</td></tr>`).join('');
}
