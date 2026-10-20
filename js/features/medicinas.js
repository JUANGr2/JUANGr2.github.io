// Escáner de medicinas y botiquín personal. Información orientativa: no sustituye a un profesional.
const Meds = (() => {
  const STATUS = {
    vencida: ['Vencida', 'off'], por_vencer: ['Vence pronto', 'warn'], vigente: ['Vigente', 'on'], desconocida: ['Sin fecha', ''],
  };
  let list = [], barcodeTimer = 0, lastCode = '', detector = null, scanned = null;

  const pill = iso => { const s = MedParse.expiryStatus(iso).status; const [t, c] = STATUS[s]; return `<span class="pill ${c}">${t}</span>`; };

  async function load() {
    list = await api('/medicines').catch(() => []);
    const ul = $('#med-list');
    if (!ul) return;
    ul.innerHTML = list.length ? list.map(m => `<li>
        <span><b>${esc(m.name)}</b>${m.dose ? ` · ${esc(m.dose)}` : ''} ${pill(m.expiry)}
        <br><small>${m.expiry ? esc(MedParse.expiryPhrase(m.expiry)) : 'Sin fecha de caducidad'}${m.use ? ' · ' + esc(m.use) : ''}</small></span>
        <span class="row">
          <button class="btn sm gray" data-say="${m.id}" aria-label="Escuchar ${esc(m.name)}"><svg class="ic" aria-hidden="true"><use href="/icons/sprite.svg#i-sound"/></svg></button>
          <button class="btn sm" data-rem="${m.id}" aria-label="Crear recordatorio para ${esc(m.name)}"><svg class="ic" aria-hidden="true"><use href="/icons/sprite.svg#i-clock"/></svg></button>
          <button class="btn sm danger" data-del="${m.id}" aria-label="Eliminar ${esc(m.name)}"><svg class="ic" aria-hidden="true"><use href="/icons/sprite.svg#i-x"/></svg></button>
        </span></li>`).join('')
      : '<li class="empty"><span>Tu botiquín está vacío. Escanea una caja o agrégala a mano.</span><button class="btn sm primary" data-focus="#mm-name">Agregar a mano</button></li>';
    $$('#med-list [data-del]').forEach(b => b.onclick = async () => { await api('/medicines/' + b.dataset.del, { method: 'DELETE' }); load(); });
    $$('#med-list [data-say]').forEach(b => b.onclick = () => {
      const m = list.find(x => String(x.id) === b.dataset.say);
      if (m) Speech.speak(MedParse.speak({ name: m.name, dose: m.dose, form: m.form, expiry: m.expiry, confidence: 'alta' }));
    });
    $$('#med-list [data-rem]').forEach(b => b.onclick = () => {
      const m = list.find(x => String(x.id) === b.dataset.rem);
      if (!m) return;
      $('#rm-title').value = `Tomar ${m.name}${m.dose ? ' ' + m.dose : ''}`;
      show('s-remind');
      $('#rm-time').focus();
      toast('Elige la hora y pulsa ＋ para crear el recordatorio.');
    });
    expiryAlert();
  }

  // aviso en el panel de la cámara e insignia en sus funciones
  function expiryAlert() {
    const st = list.map(m => MedParse.expiryStatus(m.expiry).status);
    const off = st.filter(x => x === 'vencida').length, soon = st.filter(x => x === 'por_vencer').length;
    const bad = off + soon;
    if (typeof setBadge === 'function') setBadge('s-med', off ? `${off} vencida${off > 1 ? 's' : ''}` : soon ? `${soon} por vencer` : '');
    const b = $('#med-banner');
    if (!b) return;
    if (!bad) { b.hidden = true; return; }
    const txt = off ? `${off} medicina${off > 1 ? 's' : ''} vencida${off > 1 ? 's' : ''}${soon ? ` y ${soon} por vencer` : ''}.` : `${soon} medicina${soon > 1 ? 's' : ''} por vencer.`;
    b.classList.toggle('bad', off > 0);
    b.innerHTML = `<span><b>${esc(txt)}</b> Revisa tu botiquín.</span><button class="btn sm" id="mb-go">Ver</button>`;
    b.hidden = false;
    $('#mb-go').onclick = () => show('s-med');
  }

  // ---- resultado del escaneo (pantalla Ver, modo Medicina) ----
  function showScan(parsed) {
    scanned = parsed;
    const box = $('#med-result');
    box.hidden = false;
    $('#mr-name').value = parsed.name || '';
    $('#mr-dose').value = parsed.dose || '';
    $('#mr-form').value = parsed.form || '';
    $('#mr-expiry').value = parsed.expiry || '';
    $('#mr-lot').value = parsed.lot || '';
    $('#mr-barcode').value = parsed.barcode || '';
    const st = MedParse.expiryStatus(parsed.expiry);
    box.dataset.status = st.status;
    $('#mr-summary').textContent = MedParse.speak(parsed);
    $('#mr-warn').hidden = st.status !== 'vencida';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function saveScan() {
    const body = {
      name: $('#mr-name').value, dose: $('#mr-dose').value, form: $('#mr-form').value, expiry: $('#mr-expiry').value,
      lot: $('#mr-lot').value, barcode: $('#mr-barcode').value, use: $('#mr-use').value,
    };
    try {
      await api('/medicines', { method: 'POST', body });
      toast('Guardada en tu botiquín');
      $('#med-result').hidden = true;
      Speech.speak('Guardada en tu botiquín');
      load();
    } catch (x) { toast(x.message); }
  }

  // ---- código de barras (si el dispositivo lo soporta) ----
  async function startBarcode(videoEl, onCode) {
    stopBarcode();
    if (!('BarcodeDetector' in window)) return false;
    try { detector = detector || new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'data_matrix', 'qr_code'] }); } catch { return false; }
    barcodeTimer = setInterval(async () => {
      try {
        const r = await detector.detect(videoEl);
        if (r.length && r[0].rawValue && r[0].rawValue !== lastCode) {
          lastCode = r[0].rawValue;
          const known = list.find(m => m.barcode === lastCode);
          onCode(lastCode, known);
        }
      } catch {}
    }, 700);
    return true;
  }
  function stopBarcode() { clearInterval(barcodeTimer); barcodeTimer = 0; lastCode = ''; }
  // código de barras en una foto (la de alta resolución que se tomó para leer la caja)
  async function barcodeFrom(img) {
    if (!img || !('BarcodeDetector' in window)) return null;
    try {
      detector = detector || new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'data_matrix', 'qr_code'] });
      const r = await detector.detect(img);
      return r.length && r[0].rawValue ? r[0].rawValue : null;
    } catch { return null; }
  }

  function init() {
    $('#f-med').onsubmit = async e => {
      e.preventDefault();
      try {
        await api('/medicines', { method: 'POST', body: { name: $('#mm-name').value, dose: $('#mm-dose').value, form: $('#mm-form').value, expiry: $('#mm-expiry').value, use: $('#mm-use').value } });
        e.target.reset(); $('#mm-msg').innerHTML = ''; load();
      } catch (x) { $('#mm-msg').innerHTML = `<div class="msg err">${esc(x.message)}</div>`; }
    };
    $('#mr-save').onclick = saveScan;
    $('#mr-say').onclick = () => Speech.speak($('#mr-summary').textContent);
    $('#mr-close').onclick = () => { $('#med-result').hidden = true; };
  }

  return { init, load, showScan, startBarcode, stopBarcode, barcodeFrom, get list() { return list; } };
})();
