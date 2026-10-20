const show = reg => {
  $('#f-login').hidden = reg;
  $('#f-reg').hidden = !reg;
  $('#t-login').setAttribute('aria-selected', String(!reg));
  $('#t-reg').setAttribute('aria-selected', String(reg));
  $('#title').textContent = reg ? 'Crea tu cuenta' : 'Bienvenido';
  $('#sub').textContent = reg ? 'Personalizaremos la app según tu apoyo.' : 'Inicia sesión para continuar.';
  $('#msg').innerHTML = '';
};
$('#t-login').onclick = () => show(false);
$('#t-reg').onclick = () => show(true);
if (new URLSearchParams(location.search).get('registro')) show(true);

const err = m => { $('#msg').innerHTML = `<div class="msg err">${esc(m)}</div>`; };
const go = u => { location.replace(u.role === 'admin' ? '/admin.html' : '/app.html'); };   // replace: Atrás no vuelve al acceso
const busy = (form, on) => $$('button', form).forEach(b => (b.disabled = on));

$('#f-login').onsubmit = async e => {
  e.preventDefault();
  busy(e.target, true);
  try { go(await api('/auth/login', { method: 'POST', body: { email: $('#l-email').value, password: $('#l-pass').value } })); }
  catch (x) { err(x.message); busy(e.target, false); }
};
// ---- registro en 3 pasos: tus datos, tu apoyo y el acuerdo; cada error bajo su campo ----
const STEP_NAMES = ['tus datos', 'tu apoyo', 'el acuerdo'];
const FIELDS = ['r-name', 'r-email', 'r-pass', 'r-terms'];
let step = 1;
const regValues = () => ({ name: $('#r-name').value, email: $('#r-email').value, pass: $('#r-pass').value, terms: $('#r-terms').checked });
function setError(id, msg) {
  const field = $('#' + id), box = $('#' + id + '-err');
  box.textContent = msg || '';
  box.hidden = !msg;
  if (msg) { field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', id + '-err'); }
  else { field.removeAttribute('aria-invalid'); field.removeAttribute('aria-describedby'); }
}
// muestra los errores del paso y lleva el foco al primero; true si hubo alguno
function showErrors(errs) {
  FIELDS.forEach(id => setError(id, errs[id]));
  const first = FIELDS.find(id => errs[id]);
  if (first) $('#' + first).focus();
  return !!first;
}
function goStep(n, { focus = true } = {}) {
  step = n;
  $$('#f-reg .r-step').forEach(el => { el.hidden = Number(el.dataset.step) !== n; });
  $$('#r-steps li').forEach(li => { if (Number(li.dataset.s) === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
  $('#r-step-h').textContent = `Paso ${n} de 3: ${STEP_NAMES[n - 1]}`;
  $('#msg').innerHTML = '';
  if (focus) $('#r-step-h').focus();
}
FIELDS.forEach(id => $('#' + id).addEventListener(id === 'r-terms' ? 'change' : 'input', () => setError(id, '')));
$$('#f-reg [data-back-step]').forEach(b => b.onclick = () => goStep(step - 1));
$('#t-reg').addEventListener('click', () => goStep(1, { focus: false }));
$('#f-reg').onsubmit = async e => {
  e.preventDefault();                                       // Enter o «Siguiente»: valida este paso y avanza
  if (showErrors(Signup.check(step, regValues()))) return;
  if (step < 3) return goStep(step + 1);
  busy(e.target, true);
  try {
    go(await api('/auth/register', { method: 'POST', body: {
      name: $('#r-name').value.trim(), email: $('#r-email').value.trim(), password: $('#r-pass').value,
      profiles: $$('[name=prof]:checked').map(c => c.value), acceptTerms: $('#r-terms').checked } }));
  } catch (x) {
    busy(e.target, false);
    if (/correo/i.test(x.message)) { goStep(1, { focus: false }); showErrors({ 'r-email': x.message }); }   // se arregla en el paso 1
    else err(x.message);
  }
};

if (typeof LOCAL !== 'undefined' && LOCAL) {
  const sub = $('#sub');
  const note = document.createElement('p');
  note.className = 'mute';
  note.style.marginTop = '12px';
  note.textContent = 'Tus datos se guardan solo en este teléfono. No necesitas internet.';
  sub.after(note);
}
