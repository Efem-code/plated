/* Plated — a private, photo-first food blog. Single page, hash routes:
   #/feed  #/post/ID  #/new  #/edit/ID  #/places  #/place/NAME  #/tags  #/tag/NAME  #/me */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toLocaleDateString('en-CA');
const norm = s => String(s || '').trim().toLowerCase();
const view = $('#view');

const S = { posts: [], q: '', filter: 'all', search: false, inApp: 0 };
let ED = null;   // the post being written; survives re-renders so a cancelled "leave?" can restore it

const PROMPTS = [
  'What did the first bite taste like?',
  'Who were you with, and what was the occasion?',
  'Texture, smell, plating — what stood out?',
  'What would you change about it?',
  'Would you send a friend here? What should they order?',
];

const store = {
  get(k, d) { try { const v = localStorage.getItem('plated.' + k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('plated.' + k, v); } catch {} },
};

function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}

function sortPosts() {
  S.posts.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created || 0) - (a.created || 0));
}

const starsHTML = n => n ? `<span class="stars" aria-label="${n} out of 5">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>` : '';
const whereOf = p => [p.place, p.city].filter(Boolean).join(', ');
const mapsURL = (place, city, loc) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([place, loc?.address, city].filter(Boolean).join(' '));

function tile(p) {
  const [, emoji] = kindOf(p.kind);
  return `<a class="tile" href="#/post/${p.id}">
    ${p.photos?.length ? `<img data-pid="${p.photos[0]}" alt="">` : `<div class="noimg">${emoji}</div>`}
    ${p.photos?.length > 1 ? `<span class="multi">▣ ${p.photos.length}</span>` : ''}
    ${p.rating ? `<span class="badge">★ ${p.rating}</span>` : ''}
    <div class="cap"><div class="t">${esc(p.title || 'Untitled dish')}</div><div class="p">${esc(p.place || kindOf(p.kind)[2])}</div></div>
  </a>`;
}

function back(fallback) {
  if (S.inApp > 1) history.back(); else location.hash = fallback;
}

/* ---------- Feed ---------- */
function matches(p) {
  const f = S.filter;
  if (f === 'top' && (p.rating || 0) < 4) return false;
  if (f === 'again' && !p.again) return false;
  if (f.startsWith('k:') && p.kind !== f.slice(2)) return false;
  if (!S.q) return true;
  const hay = norm([p.title, p.place, p.city, p.story, kindOf(p.kind)[2], ...(p.tags || [])].join(' '));
  return norm(S.q).split(/\s+/).every(w => hay.includes(w));
}

function gridHTML(posts, months = true) {
  let out = '', last = '';
  for (const p of posts) {
    const m = (p.date || '').slice(0, 7);
    if (months && m !== last) {
      last = m;
      out += `<div class="month">${m ? new Date(m + '-15T12:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'Undated'}</div>`;
    }
    out += tile(p);
  }
  return `<div class="grid">${out}</div>`;
}

function renderFeed() {
  if (!S.posts.length) {
    view.innerHTML = `<div class="empty">
      <div class="big">🍽️</div>
      <h2>Your food blog starts here</h2>
      <p>Snap the dish, say where you had it, rate it, and write a few lines. Everything stays on this phone.</p>
      <a class="btn primary" href="#/new">＋ Write your first post</a>
    </div>`;
    return;
  }
  const kinds = KINDS.filter(k => S.posts.some(p => p.kind === k[0]));
  const chips = [['all', 'All'], ['top', '★ 4+'], ['again', '↻ Order again'], ...kinds.map(k => ['k:' + k[0], k[1] + ' ' + k[2]])];
  view.innerHTML = `
    ${S.search || S.q ? `<input class="search" id="q" type="search" placeholder="Search dishes, places, tags…" value="${esc(S.q)}">` : ''}
    <div class="chips">${chips.map(([k, l]) => `<button class="chip${S.filter === k ? ' on' : ''}" data-f="${k}">${esc(l)}</button>`).join('')}</div>
    <div id="feed-grid"></div>`;
  const draw = () => {
    const list = S.posts.filter(matches);
    $('#feed-grid').innerHTML = list.length ? gridHTML(list) : `<p class="muted" style="text-align:center;padding:30px 0">Nothing matches.</p>`;
    Photos.hydrate($('#feed-grid'));
  };
  draw();
  $('#q')?.addEventListener('input', e => { S.q = e.target.value; draw(); });
  if (S.search && !S.q) $('#q')?.focus();
  $$('.chip', view).forEach(b => b.onclick = () => { S.filter = b.dataset.f; renderFeed(); });
}

$('#search-btn').onclick = () => {
  if (!location.hash.startsWith('#/feed') && location.hash) { S.search = true; location.hash = '#/feed'; return; }
  S.search = !S.search; if (!S.search) S.q = ''; renderFeed();
};

/* ---------- Post ---------- */
function renderPost(id) {
  const p = S.posts.find(x => x.id === id);
  if (!p) { view.innerHTML = `<div class="empty"><h2>Post not found</h2><a class="btn" href="#/feed">Back to feed</a></div>`; return; }
  const [, emoji, label] = kindOf(p.kind);
  const story = (p.story || '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean).map(t => `<p>${esc(t).replace(/\n/g, '<br>')}</p>`).join('');
  const n = p.photos?.length || 0;
  view.innerHTML = `<article class="post${n ? ' has-photos' : ''}">
    <a class="back" href="#/feed" id="back">← Back</a>
    ${n ? `<div class="media">
      <div class="gallery" id="gal">${p.photos.map(pid => `<img data-pid="${pid}" data-size="full" alt="${esc(p.title)}">`).join('')}</div>
      ${n > 1 ? `<div class="dots">${p.photos.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</div>` : ''}
    </div>` : ''}
    <div>
      <div class="kick">${emoji} ${esc(label)}${p.price ? ' · ' + '$'.repeat(p.price) : ''} · ${esc(fmtDate(p.date))}</div>
      <h1>${esc(p.title || 'Untitled dish')}</h1>
      ${p.place || p.city ? `<div class="where">📍 ${p.place ? `<a href="#/place/${encodeURIComponent(norm(p.place))}">${esc(p.place)}</a>` : ''}${p.place && p.city ? ', ' : ''}${esc(p.city || '')}
        · <a href="${mapsURL(p.place, p.city, p.loc)}" target="_blank" rel="noopener">Google Maps</a></div>` : ''}
      ${p.rating || p.again ? `<div>${starsHTML(p.rating)}${p.again ? '<span class="again">↻ would order again</span>' : ''}</div>` : ''}
      ${story ? `<div class="story">${story}</div>` : '<p class="muted">No story yet — tap Edit to add one.</p>'}
      ${p.tags?.length ? `<div class="taglist">${p.tags.map(t => `<a href="#/tag/${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}
      <div class="actions">
        <button class="btn primary" id="share">📸 Share card</button>
        <a class="btn" href="#/edit/${p.id}">✏️ Edit</a>
        <button class="btn" id="page">🌐 Blog page</button>
        <button class="btn danger" id="del">Delete</button>
      </div>
    </div>
  </article>`;
  Photos.hydrate(view);
  $('#back').onclick = e => { e.preventDefault(); back('#/feed'); };
  const gal = $('#gal');
  if (gal && n > 1) gal.addEventListener('scroll', () => {
    const i = Math.round(gal.scrollLeft / gal.clientWidth);
    $$('.dots i', view).forEach((d, k) => d.classList.toggle('on', k === i));
  }, { passive: true });
  $('#share').onclick = () => openShare(p);
  $('#page').onclick = async e => {
    const b = e.currentTarget; b.classList.add('busy');
    try {
      const blob = await Share.blog([p]);
      const r = await Share.send(blob, Share.slug(p.title) + '.html', p.title);
      if (r === 'saved') toast('Saved the page to Downloads');
    } catch (err) { toast('Couldn’t build the page: ' + err.message); }
    b.classList.remove('busy');
  };
  $('#del').onclick = async () => {
    if (!confirm(`Delete “${p.title || 'this post'}” and its photos? This can’t be undone.`)) return;
    for (const pid of p.photos || []) { await DB.del('photos', pid); Photos.forget(pid); }
    await DB.del('posts', p.id);
    S.posts = S.posts.filter(x => x.id !== p.id);
    toast('Deleted');
    location.replace('#/feed');
  };
}

/* ---------- Share sheet ---------- */
function openSheet(html) {
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  return $('#sheet-body');
}
function closeSheet() { $('#sheet').hidden = true; $('#sheet-body').innerHTML = ''; }
$('#sheet-close').onclick = closeSheet;
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

function openShare(p) {
  let fmt = store.get('cardFormat', 'portrait'), blob = null, url = '';
  const body = openSheet(`<h2>Share card</h2>
    <div class="seg" id="fmt">${Object.entries(Share.FORMATS).map(([k, f]) => `<button data-k="${k}">${f.label}</button>`).join('')}</div>
    <img class="cardprev loading" id="prev" alt="Card preview">
    <div class="row"><button class="btn primary" id="go" style="flex:1">Share…</button><button class="btn" id="save" style="flex:1">Save image</button></div>
    <p class="muted" style="font-size:13px;margin:12px 0 0">The signature in the corner is your blog name (change it on the Me tab).</p>`);
  const name = () => `${Share.slug(p.title)}-${fmt}.jpg`;
  async function draw() {
    $$('#fmt button', body).forEach(b => b.classList.toggle('on', b.dataset.k === fmt));
    blob = null; $('#prev', body).classList.add('loading');
    blob = await Share.card(p, fmt);
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    const img = $('#prev', body); if (!img) return;
    img.src = url; img.classList.remove('loading');
  }
  $$('#fmt button', body).forEach(b => b.onclick = () => { fmt = b.dataset.k; store.set('cardFormat', fmt); draw(); });
  $('#go', body).onclick = async () => { if (!blob) return; const r = await Share.send(blob, name(), p.title); if (r === 'saved') toast('Saved to Downloads'); };
  $('#save', body).onclick = () => { if (!blob) return; Share.download(blob, name()); toast('Saved to Downloads'); };
  draw().catch(err => toast('Couldn’t draw the card: ' + err.message));
}

/* ---------- Editor ---------- */
function startEditor(id) {
  const route = id ? '#/edit/' + id : '#/new';
  if (ED && ED.route === route) return;
  const p = id ? S.posts.find(x => x.id === id) : null;
  if (id && !p) { location.replace('#/feed'); return; }
  const last = S.posts[0];
  ED = {
    route, id: p?.id || null, dirty: false, removed: [],
    f: p ? structuredClone(p) : { title: '', place: '', city: last?.city || '', date: today(), kind: 'restaurant', rating: 0, price: 0, again: false, tags: [], story: '', photos: [] },
    shots: (p?.photos || []).map(pid => ({ id: pid, rec: null })),
    pinnedName: p?.place || '',
    prompt: PROMPTS[Math.floor(Math.random() * PROMPTS.length)],
  };
}

function renderEditor() {
  const f = ED.f;
  const cities = [...new Set(S.posts.map(p => p.city).filter(Boolean))];
  view.innerHTML = `<div class="form">
    <h1 class="page">${ED.id ? 'Edit post' : 'New post'}</h1>
    <div class="field">
      <span class="lbl">Photos <span class="muted" style="font-weight:500">· the first one is the cover</span></span>
      <div class="shots" id="shots"></div>
      <input type="file" id="cam" accept="image/*" capture="environment" hidden>
      <input type="file" id="lib" accept="image/*" multiple hidden>
    </div>
    <div class="field"><label for="title">Dish</label><input class="in title" id="title" placeholder="What did you eat?" value="${esc(f.title)}" autocomplete="off"></div>
    <div class="field acwrap"><label for="place">Place</label>
      <input class="in" id="place" placeholder="${f.kind === 'home' ? 'Home' : 'Start typing the restaurant…'}" value="${esc(f.place)}" autocomplete="off" enterkeyhint="next">
      <div class="pinned" id="pinned"></div></div>
    <datalist id="dl-cities">${cities.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="field"><span class="lbl">Kind</span><div class="kinds" id="kinds">${KINDS.map(([k, e, l]) => `<button type="button" class="chip${f.kind === k ? ' on' : ''}" data-k="${k}">${e} ${l}</button>`).join('')}</div></div>
    <div class="field"><span class="lbl">Rating</span><div class="picker" id="rate">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-v="${i}" aria-label="${i} stars">★</button>`).join('')}</div></div>
    <div class="two">
      <div class="field"><label for="city">City</label><input class="in" id="city" list="dl-cities" placeholder="City" value="${esc(f.city)}" autocomplete="off"></div>
      <div class="field"><label for="date">Date</label><input class="in" type="date" id="date" value="${esc(f.date)}" max="${today()}"></div>
    </div>
    <div class="field"><span class="lbl">Price</span><div class="seg" id="price">${[1, 2, 3, 4].map(i => `<button type="button" data-v="${i}">${'$'.repeat(i)}</button>`).join('')}</div></div>
    <div class="field"><label class="toggle"><input type="checkbox" id="again"${f.again ? ' checked' : ''}> ↻ I’d order this again</label></div>
    <div class="field"><label for="story">The story</label><textarea class="in" id="story" placeholder="${esc(ED.prompt)}">${esc(f.story)}</textarea></div>
    <div class="field"><label for="tagin">Tags</label><div class="tagbox" id="tagbox"></div><div class="sugg" id="sugg"></div></div>
    <div class="savebar">
      <button class="btn" id="cancel">Cancel</button>
      <button class="btn primary" id="savepost">${ED.id ? 'Save' : 'Publish'}</button>
    </div>
  </div>`;

  const dirty = () => { ED.dirty = true; };
  drawShots(); drawRate(); drawPrice(); drawTags(); drawPinned();

  for (const k of ['title', 'city', 'date', 'story']) $('#' + k).addEventListener('input', e => { f[k] = e.target.value; dirty(); });
  $('#place').addEventListener('input', e => {
    f.place = e.target.value; dirty();
    /* Typing over a picked place means it's a different place now. */
    if (f.loc && norm(f.place) !== norm(ED.pinnedName)) { f.loc = null; drawPinned(); }
  });
  $('#place').addEventListener('change', () => {
    /* Reuse the spelling already on file so Places doesn't split one restaurant in two. */
    const hit = S.posts.find(p => norm(p.place) === norm(f.place));
    if (!hit || f.loc) return;
    pick({ name: hit.place, city: hit.city, loc: hit.loc || null });
  });
  Geo.picker($('#place'), { getCity: () => f.city, onPick: pick });
  function pick({ name, city, loc }) {
    f.place = name; $('#place').value = name; ED.pinnedName = name;
    if (loc) f.loc = loc; else delete f.loc;
    if (city) { f.city = city; $('#city').value = city; }
    dirty(); drawPinned();
  }
  function drawPinned() {
    const el = $('#pinned');
    el.innerHTML = f.loc ? `📍 <span>${esc(f.loc.address || 'Pinned on the map')}</span><button type="button" id="unpin" aria-label="Remove map pin">✕</button>` : '';
    el.hidden = !f.loc;
    $('#unpin')?.addEventListener('click', () => { delete f.loc; dirty(); drawPinned(); });
  }
  $('#again').onchange = e => { f.again = e.target.checked; dirty(); };
  $$('#kinds .chip').forEach(b => b.onclick = () => {
    f.kind = b.dataset.k; dirty();
    $$('#kinds .chip').forEach(x => x.classList.toggle('on', x === b));
    $('#place').placeholder = f.kind === 'home' ? 'Home' : 'Start typing the restaurant…';
  });
  $$('#rate button').forEach(b => b.onclick = () => { const v = +b.dataset.v; f.rating = f.rating === v ? 0 : v; dirty(); drawRate(); });
  $$('#price button').forEach(b => b.onclick = () => { const v = +b.dataset.v; f.price = f.price === v ? 0 : v; dirty(); drawPrice(); });
  $('#cam').onchange = e => addFiles(e.target.files);
  $('#lib').onchange = e => addFiles(e.target.files);
  $('#cancel').onclick = () => back(ED.id ? '#/post/' + ED.id : '#/feed');
  $('#savepost').onclick = savePost;

  function drawRate() { $$('#rate button').forEach(b => b.classList.toggle('on', +b.dataset.v <= f.rating)); }
  function drawPrice() { $$('#price button').forEach(b => b.classList.toggle('on', +b.dataset.v === f.price)); }

  function drawShots() {
    const box = $('#shots');
    box.innerHTML = ED.shots.map((s, i) => `<div class="shot">
        <img ${s.url ? `src="${s.url}"` : `data-pid="${s.id}"`} alt="">
        <button type="button" class="x" data-i="${i}" aria-label="Remove photo">✕</button>
        ${i === 0 ? '<span class="cv">COVER</span>' : `<button type="button" class="mk" data-i="${i}">Make cover</button>`}
      </div>`).join('') +
      `<button type="button" class="addshot" id="addcam"><b>📷</b>Camera</button>
       <button type="button" class="addshot" id="addlib"><b>🖼️</b>Gallery</button>`;
    Photos.hydrate(box);
    $('#addcam').onclick = () => $('#cam').click();
    $('#addlib').onclick = () => $('#lib').click();
    $$('.x', box).forEach(b => b.onclick = () => {
      const [s] = ED.shots.splice(+b.dataset.i, 1);
      if (!s.rec) ED.removed.push(s.id); else URL.revokeObjectURL(s.url);
      dirty(); drawShots();
    });
    $$('.mk', box).forEach(b => b.onclick = () => {
      const [s] = ED.shots.splice(+b.dataset.i, 1); ED.shots.unshift(s); dirty(); drawShots();
    });
  }

  async function addFiles(files) {
    const list = [...files];
    if (!list.length) return;
    toast(list.length > 1 ? `Preparing ${list.length} photos…` : 'Preparing photo…', 8000);
    let bad = 0;
    for (const file of list) {
      try {
        const rec = await Photos.process(file);
        ED.shots.push({ id: rec.id, rec, url: URL.createObjectURL(rec.thumb) });
        dirty();
      } catch { bad++; }
    }
    $('#cam').value = ''; $('#lib').value = '';
    if (!$('#shots')) return;    // left the editor while photos were processing
    drawShots();
    toast(bad ? `${bad} photo${bad > 1 ? 's' : ''} couldn’t be read (HEIC? Try JPEG)` : 'Added');
  }

  function drawTags() {
    const tb = $('#tagbox');
    tb.innerHTML = f.tags.map((t, i) => `<span class="tg">#${esc(t)}<button type="button" data-i="${i}" aria-label="Remove ${esc(t)}">✕</button></span>`).join('') +
      `<input id="tagin" placeholder="${f.tags.length ? '' : 'spicy, brunch, date night…'}" enterkeyhint="done" autocomplete="off">`;
    const counts = tagCounts();
    const sugg = [...counts.keys()].filter(t => !f.tags.includes(t)).slice(0, 10);
    $('#sugg').innerHTML = sugg.map(t => `<button type="button" data-t="${esc(t)}">+ ${esc(t)}</button>`).join('');
    $$('.tg button', tb).forEach(b => b.onclick = () => { f.tags.splice(+b.dataset.i, 1); dirty(); drawTags(); });
    $$('#sugg button').forEach(b => b.onclick = () => { addTag(b.dataset.t); });
    const inp = $('#tagin');
    const commit = () => { const v = inp.value; inp.value = ''; if (v.trim()) v.split(',').forEach(addTag); };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); $('#tagin')?.focus(); }
      else if (e.key === 'Backspace' && !inp.value && f.tags.length) { f.tags.pop(); dirty(); drawTags(); $('#tagin').focus(); }
    });
    /* Android keyboards often don't send a usable key for ",", so watch the text too. */
    inp.addEventListener('input', () => { if (inp.value.includes(',')) { commit(); $('#tagin')?.focus(); } });
    inp.addEventListener('blur', commit);
  }
  function addTag(t) {
    t = norm(t).replace(/^#/, '').replace(/\s+/g, ' ');
    if (t && !f.tags.includes(t)) { f.tags.push(t); dirty(); }
    drawTags();
  }
}

async function savePost() {
  const btn = $('#savepost');
  const tagin = $('#tagin'); if (tagin?.value.trim()) tagin.blur();
  const f = ED.f;
  if (!f.title.trim()) { toast('Give the dish a name first'); $('#title').focus(); return; }
  btn.classList.add('busy');
  try {
    for (const s of ED.shots) if (s.rec) await DB.put('photos', s.rec);
    for (const pid of ED.removed) { await DB.del('photos', pid); Photos.forget(pid); }
    const now = Date.now();
    const post = {
      ...f, id: ED.id || uid(), title: f.title.trim(), place: f.place.trim(), city: f.city.trim(),
      story: f.story.trim(), photos: ED.shots.map(s => s.id), created: f.created || now, updated: now,
    };
    await DB.put('posts', post);
    S.posts = S.posts.filter(p => p.id !== post.id); S.posts.push(post); sortPosts();
    ED.shots.forEach(s => s.url && URL.revokeObjectURL(s.url));
    const wasNew = !ED.id;
    ED = null;
    navigator.storage?.persist?.();
    toast(wasNew ? 'Published ✓' : 'Saved ✓');
    location.replace('#/post/' + post.id);
  } catch (err) {
    btn.classList.remove('busy');
    toast('Couldn’t save: ' + err.message, 5000);
  }
}

addEventListener('beforeunload', e => { if (ED?.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- Places ---------- */
function placeGroups() {
  const g = new Map();
  for (const p of S.posts) {
    if (!p.place) continue;
    const k = norm(p.place);
    if (!g.has(k)) g.set(k, { key: k, name: p.place, city: p.city, posts: [] });
    g.get(k).posts.push(p);
  }
  return [...g.values()].map(x => {
    const rated = x.posts.filter(p => p.rating);
    x.avg = rated.length ? rated.reduce((a, p) => a + p.rating, 0) / rated.length : 0;
    x.last = x.posts[0].date;
    x.cover = (x.posts.find(p => p.photos?.length) || {}).photos?.[0];
    x.city = x.city || x.posts.find(p => p.city)?.city || '';
    x.loc = x.posts.find(p => p.loc)?.loc || null;
    return x;
  });
}

function renderPlaces() {
  const sort = store.get('placeSort', 'recent'), mode = store.get('placeView', 'list');
  const groups = placeGroups().sort(sort === 'visits' ? (a, b) => b.posts.length - a.posts.length || b.last.localeCompare(a.last)
    : sort === 'rating' ? (a, b) => b.avg - a.avg || b.posts.length - a.posts.length
    : (a, b) => b.last.localeCompare(a.last));
  const unpinned = groups.filter(g => !g.loc).length;
  view.innerHTML = `<h1 class="page">Places</h1>
    <p class="sub">${groups.length} place${groups.length === 1 ? '' : 's'} you’ve written about.</p>
    ${groups.length ? `<div class="chips">
      <div class="seg mini">${[['list', 'List'], ['map', 'Map']].map(([k, l]) => `<button class="${mode === k ? 'on' : ''}" data-m="${k}">${l}</button>`).join('')}</div>
      ${mode === 'list' ? [['recent', 'Recent'], ['visits', 'Most visits'], ['rating', 'Best rated']].map(([k, l]) => `<button class="chip${sort === k ? ' on' : ''}" data-s="${k}">${l}</button>`).join('') : ''}</div>
    ${mode === 'map' ? `<div class="bigmap" id="map"></div>
      ${unpinned ? `<p class="muted" style="font-size:13px">${unpinned} place${unpinned === 1 ? ' isn’t' : 's aren’t'} on the map yet — open ${unpinned === 1 ? 'it' : 'one'} from the list and tap “Pin it”.</p>` : ''}`
    : `<div class="list cols">${groups.map(g => `<a class="item" href="#/place/${encodeURIComponent(g.key)}">
      ${g.cover ? `<img data-pid="${g.cover}" alt="">` : `<div class="ph">📍</div>`}
      <div><div class="t">${esc(g.name)}${g.loc ? '' : ' <span class="nopin" title="Not on the map yet">· no pin</span>'}</div><div class="m">${esc(g.city)}${g.city ? ' · ' : ''}${g.posts.length} dish${g.posts.length === 1 ? '' : 'es'} · ${esc(fmtDate(g.last))}</div></div>
      ${g.avg ? `<div class="r">★ ${g.avg.toFixed(1)}</div>` : ''}
    </a>`).join('')}</div>`}` : `<div class="empty"><div class="big">📍</div><p>Pick a restaurant when you write a post and it shows up here — and on the map.</p></div>`}`;
  Photos.hydrate(view);
  $$('.chip', view).forEach(b => b.onclick = () => { store.set('placeSort', b.dataset.s); renderPlaces(); });
  $$('.seg.mini button', view).forEach(b => b.onclick = () => { store.set('placeView', b.dataset.m); renderPlaces(); });
  if (mode === 'map' && groups.length) MapView.show($('#map'), groups);
}

function renderPlace(key) {
  const g = placeGroups().find(x => x.key === key);
  if (!g) { location.replace('#/places'); return; }
  view.innerHTML = `<a class="back" href="#/places" id="back" style="color:var(--muted);text-decoration:none;font-weight:600">← Places</a>
    <h1 class="page">${esc(g.name)}</h1>
    <p class="sub">${g.loc?.address ? esc(g.loc.address) + ' · ' : ''}${esc(g.city)}${g.city ? ' · ' : ''}${g.posts.length} dish${g.posts.length === 1 ? '' : 'es'}${g.avg ? ` · ★ ${g.avg.toFixed(1)} average` : ''}</p>
    ${g.loc ? `<div class="minimap" id="map"></div>` : `<div class="panel acwrap"><h3>📍 Pin it on the map</h3>
      <p>Search for ${esc(g.name)} and pick the right one.</p>
      <input class="in" id="pinq" value="${esc(g.name)}" autocomplete="off" placeholder="Restaurant name"></div>`}
    <div class="row" style="margin:0 0 16px"><a class="btn small" href="${mapsURL(g.name, g.city, g.loc)}" target="_blank" rel="noopener">Open in Google Maps</a>
      ${g.loc ? '<button class="btn small" id="repin">Move pin</button>' : ''}</div>
    ${gridHTML(g.posts, false)}`;
  $('#back').onclick = e => { e.preventDefault(); back('#/places'); };
  Photos.hydrate(view);
  if (g.loc) MapView.show($('#map'), [g], { zoom: 16, popups: false });
  $('#repin')?.addEventListener('click', async () => {
    for (const p of g.posts) { delete p.loc; await DB.put('posts', p); }
    renderPlace(key);
  });
  const q = $('#pinq');
  if (q) Geo.picker(q, {
    getCity: () => g.city, unpinned: false,
    onPick: async ({ city, loc }) => {
      if (!loc) { toast('Pick a result from the map search'); return; }
      /* Every visit to this place gets the pin; the name you used stays. */
      for (const p of g.posts) { p.loc = loc; if (!p.city && city) p.city = city; p.updated = Date.now(); await DB.put('posts', p); }
      toast('Pinned ✓');
      renderPlace(key);
    },
  });
}

/* ---------- Tags ---------- */
function tagCounts() {
  const c = new Map();
  for (const p of S.posts) for (const t of p.tags || []) c.set(t, (c.get(t) || 0) + 1);
  return new Map([...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function renderTags() {
  const c = tagCounts();
  view.innerHTML = `<h1 class="page">Tags</h1>
    ${c.size ? `<p class="sub">Tap a tag to see every dish with it.</p><div class="cloud">${[...c].map(([t, n]) => `<a href="#/tag/${encodeURIComponent(t)}">#${esc(t)}<small>${n}</small></a>`).join('')}</div>`
      : `<div class="empty"><div class="big">🏷️</div><p>Tags like <b>spicy</b>, <b>brunch</b> or <b>date night</b> group your dishes. Add them when you write a post.</p></div>`}`;
}

function renderTag(t) {
  const list = S.posts.filter(p => p.tags?.includes(t));
  view.innerHTML = `<a href="#/tags" id="back" style="color:var(--muted);text-decoration:none;font-weight:600">← Tags</a>
    <h1 class="page">#${esc(t)}</h1><p class="sub">${list.length} dish${list.length === 1 ? '' : 'es'}</p>${gridHTML(list, false)}`;
  $('#back').onclick = e => { e.preventDefault(); back('#/tags'); };
  Photos.hydrate(view);
}

/* ---------- Me ---------- */
async function renderMe() {
  const P = S.posts, rated = P.filter(p => p.rating);
  const avg = rated.length ? (rated.reduce((a, p) => a + p.rating, 0) / rated.length).toFixed(1) : '–';
  const photos = P.reduce((a, p) => a + (p.photos?.length || 0), 0);
  const kinds = KINDS.map(k => [k, P.filter(p => p.kind === k[0]).length]).filter(x => x[1]);
  const maxK = Math.max(1, ...kinds.map(x => x[1]));
  const best = [...rated].sort((a, b) => b.rating - a.rating || (b.date || '').localeCompare(a.date || '')).slice(0, 5);
  const lastBackup = store.get('lastBackup', '');
  const stale = P.length >= 3 && (!lastBackup || Date.now() - Date.parse(lastBackup) > 30 * 864e5);

  view.innerHTML = `<h1 class="page">Me</h1>
    <div class="field" style="max-width:420px"><label for="bname">Blog name</label>
      <input class="in" id="bname" value="${esc(Share.blogName())}" maxlength="40" placeholder="Plated"></div>
    <div class="stats">
      <div class="stat"><b>${P.length}</b><span>dishes</span></div>
      <div class="stat"><b>${placeGroups().length}</b><span>places</span></div>
      <div class="stat"><b>${avg}</b><span>average ★</span></div>
      <div class="stat"><b>${photos}</b><span>photos</span></div>
    </div>
    ${kinds.length ? `<div class="panel"><h3>What you eat</h3><div class="bars">${kinds.map(([k, n]) => `<div class="bar"><span>${k[1]} ${k[2]}</span><i style="width:${(n / maxK) * 100}%"></i><em>${n}</em></div>`).join('')}</div></div>` : ''}
    ${best.length ? `<div class="panel"><h3>Hall of fame</h3><div class="list" style="margin-top:10px">${best.map(p => `<a class="item" href="#/post/${p.id}">
      ${p.photos?.length ? `<img data-pid="${p.photos[0]}" alt="">` : `<div class="ph">${kindOf(p.kind)[1]}</div>`}
      <div><div class="t">${esc(p.title)}</div><div class="m">${esc(p.place || '')}</div></div><div class="r">★ ${p.rating}</div></a>`).join('')}</div></div>` : ''}
    <div class="panel"><h3>🌐 Turn it into a website</h3>
      <p>Builds one web page with all your posts and photos inside it. Keep it as a scrapbook, or put it online later (GitHub Pages, Netlify) when you’re ready to share.</p>
      <div class="row"><button class="btn primary" id="blog"${P.length ? '' : ' disabled'}>Export blog page</button>
      <label class="toggle" style="font-size:14px"><input type="checkbox" id="onlytop"> Only ★4 and up</label></div></div>
    <div class="panel"><h3>💾 Backup</h3>
      <p>Your blog lives only on this phone. A backup file keeps it safe if the phone is lost or the app’s data is cleared.
        ${lastBackup ? `Last backup: <b>${esc(new Date(lastBackup).toLocaleDateString())}</b>.` : '<b>No backup yet.</b>'}${stale ? ' ⚠️ Time for a new one.' : ''}</p>
      <div class="row"><button class="btn" id="bk"${P.length ? '' : ' disabled'}>Download backup</button><button class="btn" id="rs">Restore from file</button></div>
      <input type="file" id="rsfile" accept=".json,application/json" hidden></div>
    <p class="muted" style="font-size:13px" id="storage"></p>`;
  Photos.hydrate(view);

  $('#bname').addEventListener('input', e => store.set('blogName', e.target.value.trim()));
  $('#blog').onclick = async e => {
    const b = e.currentTarget, top = $('#onlytop').checked;
    const list = top ? P.filter(p => p.rating >= 4) : P;
    if (!list.length) { toast('No ★4+ posts yet'); return; }
    b.classList.add('busy'); b.textContent = 'Building…';
    try {
      const blob = await Share.blog(list);
      Share.download(blob, Share.slug(Share.blogName()) + '.html');
      toast(`Saved ${list.length} posts (${(blob.size / 1048576).toFixed(1)} MB) to Downloads`, 4000);
    } catch (err) { toast('Couldn’t build it: ' + err.message, 5000); }
    b.classList.remove('busy'); b.textContent = 'Export blog page';
  };
  $('#bk').onclick = async e => {
    const b = e.currentTarget; b.classList.add('busy'); b.textContent = 'Packing…';
    try {
      const blob = await Share.backup(P);
      Share.download(blob, `plated-backup-${today()}.json`);
      store.set('lastBackup', new Date().toISOString());
      toast(`Backup saved (${(blob.size / 1048576).toFixed(1)} MB)`);
      renderMe();
    } catch (err) { toast('Backup failed: ' + err.message, 5000); b.classList.remove('busy'); b.textContent = 'Download backup'; }
  };
  $('#rs').onclick = () => $('#rsfile').click();
  $('#rsfile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    toast('Restoring…', 20000);
    try {
      const r = await Share.restore(file);
      await load();
      toast(`Restored: ${r.added} new, ${r.updated} updated`, 4000);
      renderMe();
    } catch (err) { toast('Restore failed: ' + err.message, 5000); }
  };

  if (navigator.storage?.estimate) {
    const [est, kept] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted?.() ?? false]);
    const el = $('#storage');
    if (el) el.textContent = `Using ${(est.usage / 1048576).toFixed(1)} MB on this phone. ${kept ? 'Storage is marked “keep” — the browser won’t clear it to free space.' : 'Tip: install the app so Android keeps its storage.'}`;
  }
}

/* ---------- Router ---------- */
function route() {
  const h = location.hash || '#/feed';
  const [, name = 'feed', ...rest] = h.split('/');
  const arg = decodeURIComponent(rest.join('/'));

  /* Leaving a half-written post asks first. "Cancel" puts the editor back
     exactly as it was, because ED still holds it. */
  const editing = name === 'new' || name === 'edit';
  if (ED && (!editing || ED.route !== h)) {
    if (ED.dirty && !confirm('Discard this post?')) { location.hash = ED.route; return; }
    ED.shots.forEach(s => s.url && URL.revokeObjectURL(s.url));
    ED = null;
  }

  S.inApp++;
  closeSheet();
  MapView.clear();
  const tab = { feed: 'feed', post: 'feed', new: 'new', edit: 'new', places: 'places', place: 'places', tags: 'tags', tag: 'tags', me: 'me' }[name] || 'feed';
  $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  if (name !== 'feed') S.search = false;

  switch (name) {
    case 'post': renderPost(arg); break;
    case 'new': startEditor(null); ED && renderEditor(); break;
    case 'edit': startEditor(arg); ED && renderEditor(); break;
    case 'places': renderPlaces(); break;
    case 'place': renderPlace(arg); break;
    case 'tags': renderTags(); break;
    case 'tag': renderTag(arg); break;
    case 'me': renderMe(); break;
    default: renderFeed();
  }
  if (!editing) scrollTo(0, 0);
}

async function load() {
  S.posts = await DB.all('posts');
  sortPosts();
}

addEventListener('hashchange', route);
load().then(route).catch(err => {
  view.innerHTML = `<div class="empty"><h2>Storage isn’t available</h2><p>${esc(err.message)}</p><p>Private/incognito tabs can block it — open Plated in a normal tab or as an installed app.</p></div>`;
});

/* ---------- Install & updates ---------- */
let installEvt = null;
addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); installEvt = e;
  if (matchMedia('(display-mode: standalone)').matches) return;
  if (store.get('noInstall', '') === new Date().toDateString()) return;
  if (document.querySelector('.install-bar')) return;
  const bar = document.createElement('div'); bar.className = 'install-bar';
  bar.innerHTML = '<img src="icon-192.png" alt=""><div class="txt"><strong>Install Plated</strong><br>Opens like its own app, works offline.</div><button class="go">Install</button><button class="no" aria-label="Not now">✕</button>';
  bar.querySelector('.go').onclick = async () => { bar.remove(); installEvt.prompt(); try { await installEvt.userChoice; } catch {} installEvt = null; };
  bar.querySelector('.no').onclick = () => { bar.remove(); store.set('noInstall', new Date().toDateString()); };
  document.body.appendChild(bar);
});
addEventListener('appinstalled', () => { document.querySelector('.install-bar')?.remove(); toast('Installed — open Plated from your home screen'); });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  /* Reload onto a new build only when one replaces an older one — and never
     in the middle of writing a post. */
  const hadWorker = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'activated' && hadWorker) { if (ED?.dirty) toast('Update ready — it loads next time you open Plated', 4000); else location.reload(); }
      });
    });
  });
}
