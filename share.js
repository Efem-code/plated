/* Plated sharing: Instagram-ready cards, a stand-alone blog page, and backup.
   All of it is built on the phone. Nothing is uploaded anywhere — sharing
   hands a file to Android's share sheet or saves it to Downloads. */
const KINDS = [
  ['restaurant', '🍽️', 'Restaurant'], ['cafe', '☕', 'Café'], ['street', '🌮', 'Street food'],
  ['bakery', '🥐', 'Bakery'], ['home', '🏠', 'Home-cooked'], ['takeout', '🥡', 'Takeout'],
];
const kindOf = k => KINDS.find(x => x[0] === k) || KINDS[0];

const Share = (() => {
  const SERIF = 'Georgia, "Noto Serif", "Times New Roman", serif';
  const SANS = 'system-ui, -apple-system, Roboto, "Segoe UI", sans-serif';
  const CREAM = '#fbf4e8', INK = '#2a211b', MUTED = '#7a6a5d', PAPRIKA = '#c8553d';

  const FORMATS = {
    portrait: { W: 1080, H: 1350, panel: 410, lines: 2, label: 'Post 4:5' },
    square:   { W: 1080, H: 1080, panel: 330, lines: 1, label: 'Square' },
    story:    { W: 1080, H: 1920, panel: 560, lines: 3, label: 'Story 9:16' },
  };

  function lines(x, text, maxW, max) {
    const words = String(text).split(/\s+/).filter(Boolean), out = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (x.measureText(t).width <= maxW || !cur) cur = t;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    if (out.length > max) {
      out.length = max;
      let last = out[max - 1];
      while (last && x.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      out[max - 1] = last.trimEnd() + '…';
    }
    return out;
  }

  async function card(post, format = 'portrait') {
    const F = FORMATS[format], { W, H, panel } = F;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const photoH = H - panel;

    x.fillStyle = CREAM; x.fillRect(0, 0, W, H);
    const pid = post.photos?.[0];
    const ph = pid && await DB.get('photos', pid);
    if (ph) {
      const img = await Photos.decode(ph.full);
      /* Cover-crop from the source so nothing spills into the text panel. */
      const k = Math.max(W / img.width, photoH / img.height);
      const sw = W / k, sh = photoH / k;
      x.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W, photoH);
      img.close?.();
    } else {
      x.fillStyle = PAPRIKA; x.fillRect(0, 0, W, photoH);
      x.font = `${photoH * 0.4}px ${SANS}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(kindOf(post.kind)[1], W / 2, photoH / 2);
      x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    }

    const pad = 72, maxW = W - pad * 2;
    let y = photoH + 76;
    const [, emoji, label] = kindOf(post.kind);
    x.fillStyle = PAPRIKA; x.font = `700 26px ${SANS}`;
    if ('letterSpacing' in x) x.letterSpacing = '4px';
    x.fillText(`${label.toUpperCase()}${post.price ? '  ·  ' + '$'.repeat(post.price) : ''}`, pad, y);
    if ('letterSpacing' in x) x.letterSpacing = '0px';

    x.fillStyle = INK; x.font = `700 66px ${SERIF}`;
    const tl = lines(x, post.title || 'Untitled dish', maxW, F.lines);
    y += 84;
    for (const l of tl) { x.fillText(l, pad, y); y += 76; }

    const where = [post.place, post.city].filter(Boolean).join(', ');
    if (where) {
      x.fillStyle = MUTED; x.font = `34px ${SANS}`;
      x.fillText('📍 ' + lines(x, where, maxW - 50, 1)[0], pad, y - 14);
    }

    if (format === 'story' && post.story) {
      x.fillStyle = INK; x.font = `italic 34px ${SERIF}`;
      let sy = y + 50;
      for (const l of lines(x, '“' + post.story.replace(/\s+/g, ' ').trim() + '”', maxW, 2)) { x.fillText(l, pad, sy); sy += 46; }
    }

    const by = H - 58;
    if (post.rating) {
      x.font = `44px ${SANS}`; x.fillStyle = PAPRIKA;
      x.fillText('★'.repeat(post.rating), pad, by);
      x.fillStyle = '#e3d6c6'; x.fillText('★'.repeat(5 - post.rating), pad + x.measureText('★'.repeat(post.rating)).width, by);
    }
    if (post.again) {
      x.font = `700 28px ${SANS}`; x.fillStyle = MUTED;
      x.fillText('↻ would order again', pad + (post.rating ? 260 : 0), by - 6);
    }
    x.font = `italic 700 34px ${SERIF}`; x.fillStyle = PAPRIKA; x.textAlign = 'right';
    x.fillText(blogName(), W - pad, by - 4);
    x.textAlign = 'left';

    return new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
  }

  function blogName() {
    try { return localStorage.getItem('plated.blogName') || 'Plated'; } catch { return 'Plated'; }
  }

  const slug = s => String(s || 'plated').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'plated';

  const toDataURL = blob => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob);
  });

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  /* Android's share sheet when it accepts the file, otherwise a download.
     Returns 'shared', 'saved' or 'cancelled'. */
  async function send(blob, name, title) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title }); return 'shared'; }
      catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
    }
    download(blob, name); return 'saved';
  }

  /* A single self-contained HTML file: photos embedded, no scripts, no links
     back to anything. It opens in any browser and can be dropped onto any
     static host (GitHub Pages, Netlify) as a blog later. */
  async function blog(posts, title = blogName()) {
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const arts = [];
    for (const p of posts) {
      const imgs = [];
      for (const id of p.photos || []) {
        const ph = await DB.get('photos', id);
        if (ph) imgs.push(`<img src="${await toDataURL(ph.full)}" width="${ph.w}" height="${ph.h}" alt="${esc(p.title)}" loading="lazy">`);
      }
      const [, emoji, label] = kindOf(p.kind);
      const where = [p.place, p.city].filter(Boolean).map(esc).join(', ');
      const story = (p.story || '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean).map(t => `<p>${esc(t).replace(/\n/g, '<br>')}</p>`).join('');
      arts.push(`<article id="${slug(p.title)}-${p.id}">
${imgs.length ? `<div class="ph${imgs.length > 1 ? ' many' : ''}">${imgs.join('')}</div>` : ''}
<div class="body">
<div class="kick">${emoji} ${esc(label)}${p.price ? ' · ' + '$'.repeat(p.price) : ''} · <time datetime="${esc(p.date)}">${esc(fmtDate(p.date))}</time></div>
<h2>${esc(p.title || 'Untitled dish')}</h2>
${where ? `<div class="where">📍 ${where}</div>` : ''}
${p.rating ? `<div class="stars" aria-label="${p.rating} out of 5">${'★'.repeat(p.rating)}<span>${'★'.repeat(5 - p.rating)}</span>${p.again ? ' <em>↻ would order again</em>' : ''}</div>` : ''}
${story}
${p.tags?.length ? `<div class="tags">${p.tags.map(t => `<span>#${esc(t)}</span>`).join(' ')}</div>` : ''}
</div>
</article>`);
    }
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(posts.length === 1 ? posts[0].title + ' — ' + title : title)}</title>
<style>
:root{--bg:#f7f1e8;--card:#fffaf2;--ink:#2a211b;--muted:#7a6a5d;--acc:#c8553d;--line:#e8dccd}
@media (prefers-color-scheme:dark){:root{--bg:#1c1714;--card:#26201b;--ink:#f3ebe1;--muted:#b3a393;--line:#3a312a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.65 Georgia,"Noto Serif",serif}
header{text-align:center;padding:56px 16px 24px}header h1{margin:0;font-size:clamp(34px,7vw,56px);font-style:italic;color:var(--acc)}
header p{margin:6px 0 0;color:var(--muted);font:15px system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:0 16px 64px}
article{background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden;margin:0 0 32px}
.ph img{display:block;width:100%;height:auto}
.ph.many{display:flex;overflow-x:auto;scroll-snap-type:x mandatory}.ph.many img{flex:0 0 100%;scroll-snap-align:start;object-fit:cover;aspect-ratio:4/5}
.body{padding:22px 24px 26px}.kick{font:700 12px system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--acc)}
h2{margin:6px 0 4px;font-size:32px;line-height:1.2}.where{color:var(--muted);font:15px system-ui,sans-serif}
.stars{color:var(--acc);font-size:22px;margin:8px 0}.stars span{color:var(--line)}.stars em{font:600 14px system-ui,sans-serif;color:var(--muted)}
.tags{margin-top:14px;font:600 14px system-ui,sans-serif;color:var(--muted)}.tags span{margin-right:8px}
footer{text-align:center;color:var(--muted);font:13px system-ui,sans-serif;padding:0 16px 40px}
</style></head><body>
<header><h1>${esc(title)}</h1><p>${posts.length === 1 ? esc(fmtDate(posts[0].date)) : posts.length + ' dishes'}</p></header>
<main>
${arts.join('\n')}
</main>
<footer>Made with Plated</footer>
</body></html>`;
    return new Blob([html], { type: 'text/html' });
  }

  async function backup(posts) {
    const photos = [];
    for (const p of posts) for (const id of p.photos || []) {
      const ph = await DB.get('photos', id);
      if (ph) photos.push({ id, w: ph.w, h: ph.h, full: await toDataURL(ph.full) });
    }
    const data = { app: 'plated', version: 1, exported: new Date().toISOString(), blogName: blogName(), posts, photos };
    return new Blob([JSON.stringify(data)], { type: 'application/json' });
  }

  /* Merges a backup in: a post is replaced only by a newer copy of itself.
     Thumbnails aren't in the file; they are rebuilt from the full photo. */
  async function restore(file) {
    const data = JSON.parse(await file.text());
    if (data.app !== 'plated' || !Array.isArray(data.posts)) throw new Error('That isn’t a Plated backup');
    const have = new Map((await DB.all('posts')).map(p => [p.id, p]));
    let added = 0, updated = 0;
    const wanted = new Set();
    for (const p of data.posts) {
      const old = have.get(p.id);
      if (old && (old.updated || 0) >= (p.updated || 0)) continue;
      (p.photos || []).forEach(id => wanted.add(id));
      await DB.put('posts', p);
      old ? updated++ : added++;
    }
    for (const ph of data.photos || []) {
      if (!wanted.has(ph.id)) continue;
      const blob = await (await fetch(ph.full)).blob();
      const img = await Photos.decode(blob);
      const k = Math.min(1, 640 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const thumb = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.8));
      await DB.put('photos', { id: ph.id, full: blob, thumb, w: ph.w, h: ph.h });
      Photos.forget(ph.id);
    }
    if (data.blogName && !localStorage.getItem('plated.blogName')) try { localStorage.setItem('plated.blogName', data.blogName); } catch {}
    return { added, updated };
  }

  return { FORMATS, card, blog, backup, restore, send, download, slug, blogName };
})();

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
