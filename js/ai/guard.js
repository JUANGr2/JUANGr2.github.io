// Tiempo máximo para una promesa: si no responde, se rechaza con { timeout: true } y la app sigue.
// No toca el navegador al cargar: se prueba en Node.
const Guard = (() => {
  function withTimeout(promise, ms, what) {
    let timer;
    const limit = new Promise((_, ko) => {
      timer = setTimeout(() => ko(Object.assign(new Error(`${what}: tardó demasiado`), { timeout: true })), ms);
    });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
  }
  return { withTimeout };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Guard;
