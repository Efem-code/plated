/* Plated storage. Everything lives on the phone in IndexedDB — localStorage
   caps out around 5 MB, which is about a dozen photos.

   posts:  { id, date, title, place, city, kind, rating, price, again, tags[], story, photos[photoId], created, updated }
   photos: { id, full: Blob (≤1600px JPEG), thumb: Blob (≤640px JPEG), w, h }
   The first id in post.photos is the cover. */
const DB = (() => {
  let dbp;
  const open = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('plated', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('posts', { keyPath: 'id' });
      d.createObjectStore('photos', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const store = async (name, mode = 'readonly') => (await open()).transaction(name, mode).objectStore(name);
  return {
    get: async (name, id) => wrap((await store(name)).get(id)),
    all: async name => wrap((await store(name)).getAll()),
    put: async (name, obj) => wrap((await store(name, 'readwrite')).put(obj)),
    del: async (name, id) => wrap((await store(name, 'readwrite')).delete(id)),
  };
})();

/* Photo object URLs, created once per photo and size and reused everywhere. */
const Photos = (() => {
  const urls = new Map();
  async function url(id, size = 'thumb') {
    const key = id + ':' + size;
    if (!urls.has(key)) urls.set(key, DB.get('photos', id).then(p => p ? URL.createObjectURL(p[size] || p.full) : ''));
    return urls.get(key);
  }
  function forget(id) {
    for (const size of ['thumb', 'full']) {
      const u = urls.get(id + ':' + size);
      if (u) u.then(x => x && URL.revokeObjectURL(x));
      urls.delete(id + ':' + size);
    }
  }
  /* Fill every <img data-pid> under root. */
  function hydrate(root) {
    root.querySelectorAll('img[data-pid]').forEach(async img => {
      const src = await url(img.dataset.pid, img.dataset.size || 'thumb');
      if (src) img.src = src;
    });
  }

  function scale(src, max, q) {
    const k = Math.min(1, max / Math.max(src.width, src.height));
    const w = Math.round(src.width * k), h = Math.round(src.height * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h);
    return new Promise((res, rej) => c.toBlob(b => b ? res({ blob: b, w, h }) : rej(new Error('encode failed')), 'image/jpeg', q));
  }
  function decode(blob) {
    if (window.createImageBitmap) return createImageBitmap(blob, { imageOrientation: 'from-image' });
    return new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('decode failed'));
      i.src = URL.createObjectURL(blob);
    });
  }
  /* A camera file (often 4–12 MB) → a 1600px JPEG plus a 640px thumbnail. */
  async function process(file) {
    const img = await decode(file);
    const full = await scale(img, 1600, 0.86);
    const thumb = await scale(img, 640, 0.8);
    img.close?.();
    return { id: uid(), full: full.blob, thumb: thumb.blob, w: full.w, h: full.h };
  }
  return { url, forget, hydrate, process, decode };
})();

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
