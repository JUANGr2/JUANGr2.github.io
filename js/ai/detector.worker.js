// Detección de objetos en un Web Worker: TensorFlow.js y COCO-SSD corren fuera del hilo principal,
// así la pantalla no se congela mientras se carga o se analiza la cámara.
let model = null;
let backend = '';

self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      importScripts(m.tf, m.coco);
      try { await tf.setBackend('webgl'); } catch { /* sin WebGL en el worker: usa el que haya */ }
      await tf.ready();
      backend = tf.getBackend();
      model = await cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: m.model });
      // calentamiento (compila shaders) aquí, sin bloquear la interfaz
      const z = tf.zeros([240, 320, 3], 'int32');
      await model.detect(z, 1);
      z.dispose();
      postMessage({ type: 'ready', backend });
    } else if (m.type === 'detect') {
      if (!model) throw new Error('modelo no cargado');
      const preds = await model.detect(m.bitmap, m.max || 10);
      if (m.bitmap && m.bitmap.close) m.bitmap.close();
      postMessage({ type: 'result', id: m.id, preds });
    }
  } catch (err) {
    if (m && m.bitmap && m.bitmap.close) { try { m.bitmap.close(); } catch {} }
    postMessage({ type: 'error', id: m && m.id, message: String((err && err.message) || err) });
  }
};
