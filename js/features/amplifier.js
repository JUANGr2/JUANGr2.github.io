// Amplificador de sonido (hipoacusia): micrófono -> auriculares con ganancia y realce de voz.
const Amp = (() => {
  let ac = null, stream = null, gain = null, an = null, raf = 0, on = false, starting = false;

  async function start(g = 3) {
    if (starting) return;
    starting = true;
    stop();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
    } finally { starting = false; }
    ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') { try { await ac.resume(); } catch {} }
    const src = ac.createMediaStreamSource(stream);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;            // quita retumbos
    const boost = ac.createBiquadFilter(); boost.type = 'peaking'; boost.frequency.value = 2500; boost.gain.value = 6; boost.Q.value = 0.9;   // realza voz
    const comp = ac.createDynamicsCompressor();                                                    // evita golpes fuertes
    gain = ac.createGain(); gain.gain.value = 0.01; gain.gain.setTargetAtTime(g, ac.currentTime, 0.4);   // sube suave: sin golpes
    an = ac.createAnalyser(); an.fftSize = 512;
    src.connect(hp).connect(boost).connect(comp).connect(gain).connect(an).connect(ac.destination);
    on = true;
    const buf = new Uint8Array(an.fftSize), bar = document.getElementById('amp-bar');
    const loop = () => {
      if (!on) return;
      an.getByteTimeDomainData(buf);
      let s = 0; for (const v of buf) { const x = (v - 128) / 128; s += x * x; }
      if (bar) bar.style.width = Math.min(100, Math.sqrt(s / buf.length) * 300) + '%';
      raf = requestAnimationFrame(loop);
    };
    loop();
  }

  function setGain(g) { if (gain && ac) gain.gain.setTargetAtTime(Math.max(0, Math.min(6, Number(g) || 1)), ac.currentTime, 0.15); }

  function stop() {
    on = false; cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    if (ac) { ac.close().catch(() => {}); ac = null; }
    const bar = document.getElementById('amp-bar');
    if (bar) bar.style.width = '0';
  }

  return { start, stop, setGain, get running() { return on; } };
})();
