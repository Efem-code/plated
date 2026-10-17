/* Plated places: restaurant search while you type, and the map.

   Search uses Photon (photon.komoot.io), a free OpenStreetMap search built for
   type-ahead — no key, no account. Google's own place search needs a paid API
   key, which would also sit in plain sight in this public repo. The "Open in
   Google Maps" links still go to Google.

   Maps use Leaflet (vendored in vendor/, loaded only when a map is shown) with
   OpenStreetMap's own tiles (CARTO's now need an API key). Dark mode inverts
   the tiles in CSS rather than needing a second tile provider. */
const Geo = (() => {
  const EMOJI = {
    restaurant: '🍽️', cafe: '☕', coffee: '☕', fast_food: '🍔', bar: '🍸', pub: '🍺', biergarten: '🍺',
    bakery: '🥐', pastry: '🧁', confectionery: '🍬', ice_cream: '🍦', food_court: '🍱', deli: '🥪',
    marketplace: '🧺', supermarket: '🛒', convenience: '🛒', seafood: '🐟', tea: '🍵', wine: '🍷',
  };
  const FOOD = new Set(Object.keys(EMOJI));
  let ctl = null;

  /* Where to bias results: the last pinned place, else the phone's location
     (asked once, remembered for a day). */
  function near() {
    const p = S.posts.find(x => x.loc);
    if (p) return p.loc;
    try {
      const n = JSON.parse(localStorage.getItem('plated.near') || 'null');
      if (n && Date.now() - n.t < 864e5) return n;
    } catch {}
    return null;
  }
  function askNear() {
    if (askNear.done || !navigator.geolocation) return;
    askNear.done = true;
    navigator.geolocation.getCurrentPosition(pos => {
      const n = { lat: pos.coords.latitude, lon: pos.coords.longitude, t: Date.now() };
      try { localStorage.setItem('plated.near', JSON.stringify(n)); } catch {}
    }, () => {}, { timeout: 10000, maximumAge: 3600e3 });
  }

  async function search(q, city) {
    ctl?.abort(); ctl = new AbortController();
    const n = near();
    if (!n) askNear();
    const u = new URL('https://photon.komoot.io/api/');
    u.searchParams.set('q', n || !city ? q : q + ' ' + city);
    u.searchParams.set('limit', '10');
    u.searchParams.set('lang', 'en');
    if (n) { u.searchParams.set('lat', n.lat.toFixed(4)); u.searchParams.set('lon', n.lon.toFixed(4)); }
    const r = await fetch(u, { signal: ctl.signal });
    if (!r.ok) throw new Error('search ' + r.status);
    const seen = new Set();
    const out = (await r.json()).features.map(f => {
      const p = f.properties, [lon, lat] = f.geometry.coordinates;
      return {
        name: p.name, type: p.osm_value, food: FOOD.has(p.osm_value),
        address: [[p.housenumber, p.street].filter(Boolean).join(' '), p.district].filter(Boolean).join(', '),
        city: p.city || p.town || p.village || p.county || '', country: p.country || '',
        lat, lon, osm: (p.osm_type || '') + p.osm_id,
      };
    }).filter(x => x.name && !seen.has(x.osm) && seen.add(x.osm));
    /* Drop far-away namesakes (a Kintaro in Madrid) once something local matches;
       then food places first, otherwise Photon's order (closest/best match). */
    let list = out;
    if (n) {
      const km = x => 6371 * Math.hypot((x.lat - n.lat) * Math.PI / 180, (x.lon - n.lon) * Math.PI / 180 * Math.cos(n.lat * Math.PI / 180));
      const local = out.filter(x => km(x) < 150);
      if (local.length) list = local;
    }
    return [...list.filter(x => x.food), ...list.filter(x => !x.food)].slice(0, 7);
  }

  const emoji = t => EMOJI[t] || '📍';

  /* Type-ahead under an input. Your own places come first (instant, offline),
     then map results. onPick gets { name, city, loc|null }. */
  function picker(input, { getCity, onPick, unpinned = true }) {
    const box = document.createElement('div');
    box.className = 'ac'; box.hidden = true;
    input.parentNode.appendChild(box);
    let timer = 0, items = [];

    const mine = q => {
      const g = new Map();
      for (const p of S.posts) if (p.place && norm(p.place).includes(norm(q)) && !g.has(norm(p.place))) g.set(norm(p.place), p);
      return [...g.values()].slice(0, 3).map(p => ({ mine: true, name: p.place, city: p.city, loc: p.loc || null }));
    };
    function draw(list, note) {
      items = list;
      box.innerHTML = list.map((x, i) => `<button type="button" data-i="${i}">
          <span class="e">${x.mine ? '★' : emoji(x.type)}</span>
          <span class="tx"><b>${esc(x.name)}</b><small>${esc(x.mine ? 'Your place' + (x.city ? ' · ' + x.city : '') : [x.address, x.city].filter(Boolean).join(' · ') || x.country)}</small></span>
        </button>`).join('') + (note ? `<div class="note">${note}</div>` : '');
      box.hidden = !list.length && !note;
    }
    async function run() {
      const q = input.value.trim();
      if (q.length < 2) { draw([]); return; }
      const own = mine(q).filter(x => x.loc || unpinned);
      draw(own, 'Searching the map…');
      try {
        const res = await search(q, getCity());
        if (input.value.trim() !== q) return;
        const ownNames = new Set(own.map(x => norm(x.name)));
        draw([...own, ...res.filter(x => !(ownNames.has(norm(x.name)) && own.find(o => norm(o.name) === norm(x.name))?.loc))],
          res.length ? '' : 'No map results — you can keep what you typed.');
      } catch (e) {
        if (e.name === 'AbortError') return;
        draw(own, navigator.onLine ? 'Map search isn’t answering right now.' : 'Offline — map search needs signal. What you type is kept.');
      }
    }
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 350); });
    input.addEventListener('focus', () => { if (input.value.trim().length >= 2) run(); });
    input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
    /* pointerdown + preventDefault keeps the keyboard up until the pick lands. */
    box.addEventListener('pointerdown', e => {
      const b = e.target.closest('button[data-i]'); if (!b) return;
      e.preventDefault();
      const x = items[+b.dataset.i];
      box.hidden = true; clearTimeout(timer); ctl?.abort();
      onPick(x.mine ? { name: x.name, city: x.city, loc: x.loc }
        : { name: x.name, city: x.city, loc: { lat: x.lat, lon: x.lon, address: x.address, osm: x.osm } });
    });
  }

  return { search, picker, emoji, near };
})();

const MapView = (() => {
  let lib = null, current = null;
  function load() {
    return lib ||= new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet.css';
      document.head.appendChild(css);
      const s = document.createElement('script'); s.src = 'vendor/leaflet.js';
      s.onload = () => res(window.L); s.onerror = () => { lib = null; rej(new Error('map library didn’t load')); };
      document.head.appendChild(s);
    });
  }
  function clear() { current?.remove(); current = null; }

  /* groups: [{ key, name, loc, posts, avg }] — only pinned ones are drawn. */
  async function show(el, groups, { zoom = 15, popups = true } = {}) {
    clear();
    let L;
    try { L = await load(); } catch (e) { el.innerHTML = `<p class="muted" style="padding:20px">${esc(e.message)} — try again with signal.</p>`; return; }
    if (!el.isConnected) return;
    const map = current = L.map(el, { zoomControl: false, attributionControl: true });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const pts = [];
    for (const g of groups) {
      if (!g.loc) continue;
      const ll = [g.loc.lat, g.loc.lon]; pts.push(ll);
      const icon = L.divIcon({ className: 'pin', html: `<span>${g.avg ? '★ ' + g.avg.toFixed(1) : '•'}</span>`, iconSize: null, iconAnchor: [0, 0] });
      const m = L.marker(ll, { icon, title: g.name }).addTo(map);
      if (popups) m.bindPopup(`<a class="pop" href="#/place/${encodeURIComponent(g.key)}"><b>${esc(g.name)}</b><br>
        ${g.posts.length} dish${g.posts.length === 1 ? '' : 'es'}${g.avg ? ' · ★ ' + g.avg.toFixed(1) : ''} · <span>Open ›</span></a>`);
    }
    if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: zoom });
    else if (pts.length) map.setView(pts[0], zoom);
    else { const n = Geo.near(); map.setView(n ? [n.lat, n.lon] : [20, 0], n ? 12 : 2); }
    /* The container may have just been laid out; make Leaflet re-measure. */
    setTimeout(() => map.invalidateSize(), 60);
  }
  return { show, clear };
})();
