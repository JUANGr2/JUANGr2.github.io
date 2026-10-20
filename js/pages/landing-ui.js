// Landing: ajustes de lectura, menú del recorrido, guía lateral y demostraciones de cada parada.
// Todo funciona sin el 3D; cuando el recorrido carga (window.Walk) se le pasan los ajustes y los gestos.
(() => {
  const html = document.documentElement, body = document.body;
  const read = k => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const walk = () => window.Walk || null;

  // ---------- ajustes: tema (compartido con la app), contraste, letra y calma ----------
  const ui = read('va_ui');
  const land = Object.assign({ hc: false, fs: 18 }, read('va_land'));
  if (typeof land.calm !== 'boolean') land.calm = reduce;
  const prefs = () => ({ theme: ui.theme === 'light' ? 'light' : 'dark', hc: !!land.hc, calm: !!land.calm, fs: land.fs });
  const FS_MIN = 16, FS_MAX = 26, BIG = 22;

  function apply() {
    const p = prefs();
    html.setAttribute('data-theme', p.theme);
    body.classList.toggle('hc', p.hc);
    body.classList.toggle('calm', p.calm);
    html.style.setProperty('--fs', p.fs + 'px');
    $$('[data-theme-set]').forEach(b => { const on = b.dataset.themeSet === p.theme; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    $$('[data-pref="hc"]').forEach(b => b.setAttribute('aria-pressed', String(p.hc)));
    $$('[data-pref="calm"]').forEach(b => b.setAttribute('aria-pressed', String(p.calm)));
    $$('[data-pref="big"]').forEach(b => b.setAttribute('aria-pressed', String(p.fs >= BIG)));
    $('#fs-val').textContent = Math.round(p.fs / 18 * 100) + ' %';
    $('#fs-down').disabled = p.fs <= FS_MIN; $('#fs-up').disabled = p.fs >= FS_MAX;
    const bg = getComputedStyle(body).getPropertyValue('--bg').trim();
    $$('meta[name=theme-color]').forEach(m => bg && m.setAttribute('content', bg));
    if (walk()) walk().setPrefs(p);
    dispatchEvent(new CustomEvent('va:prefs', { detail: p }));
  }
  const saveLand = () => write('va_land', land);
  function setTheme(t) { ui.theme = t; write('va_ui', ui); apply(); }
  function setFS(px) { land.fs = Math.max(FS_MIN, Math.min(FS_MAX, px)); saveLand(); apply(); }
  const themeBtns = $$('[data-theme-set]');
  themeBtns.forEach((b, i) => {
    b.onclick = () => setTheme(b.dataset.themeSet);
    b.onkeydown = e => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const n = themeBtns[(i + d + themeBtns.length) % themeBtns.length];
      setTheme(n.dataset.themeSet); n.focus();
    };
  });
  $('#fs-down').onclick = () => setFS(land.fs - 2);
  $('#fs-up').onclick = () => setFS(land.fs + 2);
  $$('[data-pref]').forEach(b => b.onclick = () => {
    const k = b.dataset.pref;
    if (k === 'big') setFS(land.fs >= BIG ? 18 : BIG);
    else { land[k] = !land[k]; saveLand(); apply(); }
  });
  apply();
  addEventListener('va:walk-ready', () => { if (walk()) walk().setPrefs(prefs()); });

  // ---------- panel «Aa» ----------
  const top = $('#top'), aa = $('#aa-btn'), aaPanel = $('#aa-panel');
  function setAA(open, focus = true) {
    top.classList.toggle('aa-open', open);
    aa.setAttribute('aria-expanded', String(open));
    if (open && focus) { const f = $('[aria-checked="true"]', aaPanel); if (f) f.focus(); }
  }
  aa.onclick = () => setAA(!top.classList.contains('aa-open'));
  document.addEventListener('click', e => { if (top.classList.contains('aa-open') && !e.target.closest('#aa-panel, #aa-btn')) setAA(false, false); });

  // ---------- menú del recorrido (pantalla completa) ----------
  const menu = $('#menu'), menuBtn = $('#menu-btn'), menuLabel = $('#menu-label');
  function setMenu(open, focus = true) {
    if (open) setAA(false, false);
    menu.hidden = !open;
    top.classList.toggle('menu-open', open);
    body.classList.toggle('no-scroll', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuLabel.textContent = open ? 'Cerrar menú' : 'Abrir menú';
    if (open && focus) { const a = $('a', menu); if (a) a.focus(); }
    if (!open && focus) menuBtn.focus();
  }
  menuBtn.onclick = () => setMenu(menu.hidden);
  menu.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false, false); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!menu.hidden) { e.preventDefault(); setMenu(false); return; }
      if (top.classList.contains('aa-open')) { setAA(false); aa.focus(); }
      return;
    }
    if (e.key !== 'Tab' || menu.hidden) return;
    // foco atrapado: botón del menú y los enlaces del menú
    const f = [menuBtn, ...$$('a[href], button:not([hidden])', menu)].filter(el => el.offsetParent !== null);
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // ---------- guía lateral y barra de avance ----------
  const railLinks = $$('#rail a'), stops = $$('[data-stop]'), bar = $('#progress');
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    railLinks.forEach(a => { if (a.getAttribute('href') === '#' + e.target.id) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current'); });
  }), { rootMargin: '-45% 0px -45% 0px' });
  stops.forEach(s => io.observe(s));
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max).toFixed(4) : 0})`;
    top.classList.toggle('scrolled', scrollY > 8);
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  // ---------- titular: las palabras entran una tras otra al cargar ----------
  $$('.split').forEach(h => {
    const words = h.textContent.trim().split(/\s+/);
    h.innerHTML = words.map((w, i) => `<span class="w" style="--i:${i}">${w}</span>`).join(' ');
    h.classList.add('split-on');
  });

  // ---------- botones con atracción magnética (solo con ratón y sin modo calma) ----------
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    $$('.tile-btn').forEach(b => {
      b.addEventListener('pointermove', e => {
        if (land.calm) return;
        const r = b.getBoundingClientRect(), x = (e.clientX - r.left - r.width / 2) / r.width, y = (e.clientY - r.top - r.height / 2) / r.height;
        b.style.setProperty('--mx', (x * 8).toFixed(1) + 'px'); b.style.setProperty('--my', (y * 6).toFixed(1) + 'px');
      });
      b.addEventListener('pointerleave', () => { b.style.setProperty('--mx', '0px'); b.style.setProperty('--my', '0px'); });
    });
  }

  const speak = t => { if (typeof Speech !== 'undefined' && t) Speech.speak(t); };

  // ---------- Ver: narración en vivo de la esquina ----------
  const verSay = $('#ver-say'), verLive = $('#ver-live');
  let liveTimer = 0;
  addEventListener('va:narration', e => {
    verSay.textContent = e.detail;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { verLive.textContent = e.detail; }, 1400);   // al lector de pantalla, solo cuando se asienta
  });
  $('#ver-listen').onclick = () => speak(walk() ? walk().narration() : verSay.textContent);
  $$('[data-nudge]').forEach(b => b.onclick = () => { if (walk()) walk().nudge(Number(b.dataset.nudge)); });

  // ---------- Leer ----------
  $('#leer-listen').onclick = () => speak('Paracetamol, 500 miligramos. Caducidad: mayo de 2025. Caducó. No la uses.');

  // ---------- Oír: los puntos responden a tu voz; un sonido fuerte da aviso ----------
  const micBtn = $('#mic-btn'), micState = $('#mic-state'), micLevel = $('#mic-level');
  let mic = null;
  async function startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { micState.textContent = 'Este navegador no permite usar el micrófono.'; return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
    catch (e) {
      micState.textContent = e && e.name === 'NotAllowedError' ? 'No diste permiso al micrófono. Puedes activarlo en los ajustes del navegador.' : 'No encontramos un micrófono en este dispositivo.';
      return;
    }
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const an = ac.createAnalyser(); an.fftSize = 1024;
    ac.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    mic = { stream, ac, raf: 0, base: 0.01, lastAlert: 0, level: 0 };
    micBtn.setAttribute('aria-pressed', 'true'); micBtn.querySelector('span').textContent = 'Detener';
    micState.textContent = 'Te escucho. Habla o da una palmada.';
    const loop = () => {
      an.getFloatTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const rms = Math.sqrt(s / buf.length), now = performance.now();
      mic.base = mic.base * 0.985 + rms * 0.015;
      mic.level += (Math.min(1, rms * 7) - mic.level) * 0.35;
      micLevel.style.transform = `scaleX(${mic.level.toFixed(3)})`;
      if (walk()) walk().setLevel(mic.level);
      if (rms > 0.16 && rms > mic.base * 4 && now - mic.lastAlert > 1600) {
        mic.lastAlert = now;
        micState.textContent = 'Sonido fuerte. En la app, esto vibra y destella.';
        const sec = $('#oir'); sec.classList.remove('alert'); void sec.offsetWidth; sec.classList.add('alert');
        if (navigator.vibrate) navigator.vibrate([180, 80, 180]);
        if (walk()) walk().pulse();
      }
      mic.raf = requestAnimationFrame(loop);
    };
    loop();
  }
  function stopMic() {
    if (!mic) return;
    cancelAnimationFrame(mic.raf);
    mic.stream.getTracks().forEach(t => t.stop());
    mic.ac.close().catch(() => {});
    mic = null;
    micLevel.style.transform = 'scaleX(0)';
    if (walk()) walk().setLevel(0);
    micBtn.setAttribute('aria-pressed', 'false'); micBtn.querySelector('span').textContent = 'Probar con mi voz';
    micState.textContent = 'Micrófono apagado.';
  }
  micBtn.onclick = () => (mic ? stopMic() : startMic());
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopMic(); });

  // ---------- Hablar: cada tarjeta se dice en voz alta y se escribe con los puntos ----------
  const talkLive = $('#talk-live');
  $$('.phrase').forEach(b => b.onclick = () => {
    $$('.phrase').forEach(x => x.classList.toggle('on', x === b));
    talkLive.textContent = `La app dice: «${b.dataset.say}»`;
    speak(b.dataset.say);
    if (walk()) walk().showWord(b.dataset.word);
  });
})();
