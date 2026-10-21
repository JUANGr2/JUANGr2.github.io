// Worker de la IA que reconoce el lugar: carga MobileCLIP-S0 (solo su parte de imágenes, fp32) desde /vendor/clip/
// sin pedir nada a internet y devuelve el vector de cada imagen. Lo usa clip.js.
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from '/vendor/clip/transformers.min.js';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/vendor/clip/';
env.useBrowserCache = false;                     // el service worker ya lo guarda: no duplicar
env.backends.onnx.wasm.wasmPaths = '/vendor/clip/';
if (!self.crossOriginIsolated) env.backends.onnx.wasm.numThreads = 1;   // sin aislamiento no hay hilos

let proc = null, vision = null;

function toRaw(bitmap) {
  const c = new OffscreenCanvas(bitmap.width, bitmap.height), g = c.getContext('2d');
  g.drawImage(bitmap, 0, 0);
  bitmap.close && bitmap.close();
  const d = g.getImageData(0, 0, c.width, c.height);
  return new RawImage(d.data, d.width, d.height, 4);
}

self.onmessage = async e => {
  const m = e.data || {};
  if (m.type === 'load') {
    if (typeof OffscreenCanvas === 'undefined') return self.postMessage({ type: 'unsupported' });
    try {
      proc = await AutoProcessor.from_pretrained('mobileclip_s0');
      vision = await CLIPVisionModelWithProjection.from_pretrained('mobileclip_s0', { dtype: 'fp32', device: 'wasm' });
      self.postMessage({ type: 'ready' });
    } catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
  } else if (m.type === 'embed') {
    try {
      const { image_embeds } = await vision(await proc(toRaw(m.bitmap)));
      const vec = new Float32Array(image_embeds.data);
      self.postMessage({ type: 'vec', gen: m.gen, vec }, [vec.buffer]);
    } catch (err) { self.postMessage({ type: 'error', gen: m.gen, message: String(err && err.message || err) }); }
  }
};
