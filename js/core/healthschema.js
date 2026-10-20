// Validación compartida (servidor y app) de personas, crisis, medicinas y ficha médica.
(function (root) {
  const err = (msg) => Object.assign(new Error(msg), { status: 400 });
  const s = (v, min, max, label) => {
    const t = typeof v === 'string' ? v.trim() : '';
    if (t.length < min || t.length > max) throw err(`${label} inválido${min ? ` (${min}-${max} caracteres)` : ` (máx. ${max})`}`);
    return t;
  };
  const opt = (v, max, label) => (v == null || v === '' ? '' : s(String(v), 0, max, label));
  const phone = v => {
    if (v == null || v === '') return '';
    if (typeof v !== 'string' || !/^\+?[0-9 ()-]{7,20}$/.test(v.trim())) throw err('Teléfono inválido');
    return v.trim();
  };
  const isoDate = v => {
    if (v == null || v === '') return '';
    if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/.test(v)) throw err('Fecha inválida (AAAA-MM o AAAA-MM-DD)');
    return v;
  };

  const KINDS = {
    people: {
      max: 30, maxMsg: 'Máximo 30 personas',
      clean: b => ({ name: s(b.name, 2, 50, 'Nombre'), relation: opt(b.relation, 40, 'Parentesco'), phone: phone(b.phone), note: opt(b.note, 200, 'Nota') }),
    },
    crises: {
      max: 200, maxMsg: 'Máximo 200 registros',
      clean: b => {
        const d = Number(b.duration_s);
        if (!Number.isFinite(d) || d < 0 || d > 86400) throw err('Duración inválida');
        const t = Date.parse(b.started_at);
        if (!Number.isFinite(t)) throw err('Fecha de inicio inválida');
        return { started_at: new Date(t).toISOString(), duration_s: Math.round(d), note: opt(b.note, 300, 'Nota') };
      },
    },
    medicines: {
      max: 100, maxMsg: 'Máximo 100 medicinas',
      clean: b => ({
        name: s(b.name, 1, 80, 'Nombre'), dose: opt(b.dose, 60, 'Dosis'), form: opt(b.form, 30, 'Forma'),
        expiry: isoDate(b.expiry), lot: opt(b.lot, 30, 'Lote'), barcode: opt(b.barcode, 40, 'Código'),
        use: opt(b.use, 200, 'Para qué la usa'), notes: opt(b.notes, 300, 'Notas'),
      }),
    },
  };

  const MEDICAL_FIELDS = { full_name: 80, birth: 20, blood: 5, allergies: 200, conditions: 300, medications: 300, address: 200, notes: 300 };
  function cleanMedical(b) {
    const out = {};
    for (const [k, max] of Object.entries(MEDICAL_FIELDS)) out[k] = opt(b && b[k], max, k);
    return out;
  }

  const api = { KINDS, cleanMedical, MEDICAL_FIELDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HealthSchema = api;
})(typeof window !== 'undefined' ? window : globalThis);
