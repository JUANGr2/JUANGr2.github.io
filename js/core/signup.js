// Registro por pasos: qué falta en cada paso, con el mensaje que va bajo su campo. Puro: se prueba en Node.
const Signup = (() => {
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // step 1: tus datos · 2: tu apoyo (opcional) · 3: el acuerdo. Devuelve { idDelCampo: mensaje } (vacío si todo está bien)
  function check(step, values = {}) {
    const v = values || {}, out = {};
    if (step === 1) {
      if (!String(v.name || '').trim()) out['r-name'] = 'Escribe tu nombre.';
      if (!EMAIL.test(String(v.email || '').trim())) out['r-email'] = 'Escribe un correo válido, por ejemplo nombre@correo.com.';
      if (String(v.pass || '').length < 8) out['r-pass'] = 'La contraseña necesita al menos 8 caracteres.';
    }
    if (step === 3 && !v.terms) out['r-terms'] = 'Para crear la cuenta, acepta el acuerdo de uso.';
    return out;
  }
  return { check };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Signup;
