/* Reader regression suite - paste into the browser console on the reader (local or live) and run:
     await NVLQA()
   Drives the page-flip engine frame by frame (works even when the tab is in the background),
   so every flip, drag, jump and click path is checked deterministically. Returns {pass, fail, results}.
   Never clicks the "Email inquiry" button and never opens an email hotspot. */
window.NVLQA = async function NVLQA() {
  const { S, Book: B, Zoom, Scroll, goTo, setView, applyQuery } = window.NVL;
  const results = [];
  const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: typeof info === 'string' ? info : JSON.stringify(info) });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 600 && !B.flip; i++) await wait(25);   // boot waits for the opening spread to decode
  const F = () => B.flip, R = () => F().getRender();
  let t = R().timer || performance.now();
  R().render(t);
  const step = () => { t += 16; R().render(t); B.frame(); };
  const settle = () => { let i = 0; while (i++ < 240 && B.state !== 'read') step(); step(); return i; };
  const sim = action => { const shifts = []; action(); for (let i = 0; i < 240; i++) { step(); shifts.push(B.shift); if (B.state === 'read' && i > 2) break; } return shifts; };
  const maxStep = a => a.reduce((m, v, i) => (i ? Math.max(m, Math.abs(v - a[i - 1])) : 0), 0);
  const vis = () => S.visible.join('-');
  const exp = n => B.spreadOf(n).join('-');          // expected visible pages for page n in the current orientation
  // drag in page-local units: side 'R' = right (or only) page, 'L' = left page; fx may run past the page edge
  const drag = (side, fx0, fy0, fx1, fy1, steps = 20) => {
    const r = F().getBoundsRect(), base = side === 'L' ? r.left : r.left + r.pageWidth;
    const pt = (fx, fy) => ({ x: base + fx * r.pageWidth, y: r.top + fy * r.height });
    const a = pt(fx0, fy0), b = pt(fx1, fy1); F().startUserTouch(a);
    for (let i = 1; i <= steps; i++) { F().userMove({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }, false); step(); }
    F().userStop(b, false); settle();
  };
  const until = async (cond, ms = 3000) => { const t0 = performance.now(); while (!cond() && performance.now() - t0 < ms) await wait(25); return cond(); };
  // jumps decode the target pages first, so wait until the book has actually landed
  const jump = async n => { goTo(n, { animate: false }); await until(() => B.state === 'read' && S.visible.join('-') === B.spreadOf(n).join('-')); await wait(30); };
  const clientPt = (n, fx, fy) => { const s = B.slots().find(x => x.n === n), hr = document.getElementById('bookHost').getBoundingClientRect(); return { x: hr.left + s.x + fx * s.w, y: hr.top + s.y + fy * s.h }; };

  setView('book'); await wait(80);
  ok('book built', B.built && document.querySelectorAll('.book-root .page').length === B.pages.length, B.pages.length + ' pages');
  ok('no lazy images', !document.querySelector('img[loading="lazy"]'));
  const landscape = !B.portrait;
  const pw = F().getBoundsRect().pageWidth;

  await jump(1);
  ok('cover centred', !landscape || Math.abs(B.shift + pw / 2) < 1, Math.round(B.shift));
  let s = sim(() => B.next());
  ok('open cover: smooth centring', maxStep(s) <= pw * 0.04 && Math.abs(s[s.length - 1]) < 1 && vis() === exp(2), { step: Math.round(maxStep(s)), vis: vis() });
  s = sim(() => B.prev());
  ok('close cover: smooth, ends centred', maxStep(s) <= pw * 0.04 && vis() === '1' && (!landscape || Math.abs(B.shift + pw / 2) < 1), { step: Math.round(maxStep(s)), vis: vis() });
  await jump(87);
  s = sim(() => B.next());
  ok('to back cover: smooth, ends centred', maxStep(s) <= pw * 0.04 && vis() === String(S.N) && (!landscape || Math.abs(B.shift - pw / 2) < 1), { step: Math.round(maxStep(s)), vis: vis() });
  B.next(); step();
  ok('next at the end is ignored', B.state === 'read' && vis() === String(S.N));
  s = sim(() => B.prev());
  ok('off back cover', vis() === exp(87) && Math.abs(B.shift) < 1, vis());

  await jump(1);
  drag('R', 0.97, 0.95, -0.7, 0.85);
  ok('drag cover open', vis() === exp(2) && B.state === 'read', vis());
  const before = vis();
  if (landscape) drag('L', 0.04, 0.95, 0.2, 0.9); else drag('R', 0.96, 0.95, 0.82, 0.9);
  ok('short drag springs back', vis() === before && Math.abs(B.shift) < 1, { vis: vis(), shift: Math.round(B.shift) });
  await jump(40);
  const at40 = vis();
  drag('R', 0.8, 0.5, -0.8, 0.5);
  ok('drag from middle of a page', vis() !== at40 && S.visible[0] > 40, vis());
  if (landscape) drag('L', 0.2, 0.5, 1.8, 0.5); else drag('R', 0.1, 0.5, 0.95, 0.5);
  ok('drag back from middle', vis() === at40, vis());
  await jump(10);
  s = sim(() => B.next());
  ok('next button turns one spread', S.visible[0] > 10 && B.state === 'read', vis());
  s = sim(() => B.prev());
  ok('prev button turns back', vis() === exp(10), vis());

  await jump(3);
  const toc = S.man.hotspots.find(h => h.page === 3 && h.label.startsWith('Aligner Systems'));
  let p = clientPt(3, toc.rect[0] + toc.rect[2] / 2, toc.rect[1] + toc.rect[3] / 2);
  let tg = B.targetAt(p.x, p.y);
  ok('contents line is a link (not a corner)', tg.kind === 'hs' && tg.h.target === 39, tg.kind);
  B.activate(p.x, p.y); await until(() => S.visible.includes(39));
  ok('contents link jumps to real page', S.visible.includes(39), vis());
  await jump(7);
  await (window.NVL && new Promise(r => setTimeout(r, 120)));
  const w7 = await (await fetch('book/words/007.json')).json(), part = w7.p[0], Q = 10000;
  p = clientPt(7, (part[1] + part[3] / 2) / Q, (part[2] + part[4] / 2) / Q);
  tg = B.targetAt(p.x, p.y);
  ok('clicking a part number is a normal page click (no cart)', tg.kind === 'page', tg.kind);
  B.activate(p.x, p.y);
  ok('part number click zooms, nothing is added anywhere', Zoom.open && !document.getElementById('partpop') && !document.getElementById('btnInquiry') && !document.querySelector('.pn'));
  Zoom.close(); await wait(20);
  ok('zoom view has no add-to-cart buttons', !document.querySelector('.pn, [data-addpart]'));
  p = clientPt(7, 0.5, 0.06); B.activate(p.x, p.y);
  ok('click on plain page zooms', Zoom.open); Zoom.close(); await wait(20);

  await jump(77);
  ok('long jump', S.visible.includes(77), vis());
  await jump(89);
  ok('hidden blank page falls back', vis() === exp(87), vis());

  // the panel slides OVER the stage: opening it must never resize the stage or re-measure/rebuild the book
  // (regression: the panel used to squeeze the stage, so the book was clipped mid-slide and then snapped)
  await jump(40);
  const $id = id => document.getElementById(id);
  const stageW0 = $id('stage').clientWidth, bounds0 = JSON.stringify(F().getBoundsRect()), root0 = B.root;
  $id('btnContents').click(); await wait(80);
  const side = $id('app').classList.contains('panel-side');
  ok('panel opens without resizing the stage', $id('stage').clientWidth === stageW0, { before: stageW0, after: $id('stage').clientWidth });
  ok('panel opens without re-measuring or rebuilding the book', JSON.stringify(F().getBoundsRect()) === bounds0 && B.root === root0);
  if (side) {
    const tx = parseFloat(($id('bookHost').style.transform.match(/translate3d\(([-\d.]+)px/) || [0, 0])[1]);
    const rr = F().getBoundsRect(), hostL = $id('viewBook').offsetLeft + $id('bookHost').offsetLeft;
    const left = hostL + rr.left + (B.portrait ? rr.pageWidth : 0) + tx, right = hostL + rr.left + 2 * rr.pageWidth + tx;
    ok('wide screen: the book glides clear of the panel', left >= $id('panel').offsetWidth + 23 || right >= $id('stage').clientWidth - 25, { shift: tx, left: Math.round(left), panel: $id('panel').offsetWidth });
  } else {
    ok('narrow screen: the panel overlays with a scrim', !$id('scrim').hidden);
  }
  $id('panelClose').click(); await wait(80);
  ok('closing the panel puts the book back', !$id('bookHost').style.transform && $id('scrim').hidden && !$id('app').classList.contains('panel-open'));
  B.activate(...Object.values(clientPt(S.visible[S.visible.length - 1], 0.5, 0.5)));
  const z0 = Zoom.z, zt0 = $id('zoomContent').style.transform;
  $id('btnContents').click(); await wait(80);
  ok('opening the panel over zoom leaves the zoom untouched', Zoom.open && Zoom.z === z0 && $id('zoomContent').style.transform === zt0);
  $id('panelClose').click(); Zoom.close(); await wait(40);

  // turning onto a single-page spread must uncover the page under the lifting sheet progressively
  // (regression: it used to stay fully drawn for the whole turn, then vanish at the end)
  if (landscape) {
    const polyArea = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
    const visibleFrac = n => {
      const e = document.querySelector(`.book-root .page[data-n="${n}"]`);
      if (!e || e.style.display === 'none') return 0;
      const m = (e.style.clipPath || '').match(/evenodd,(.*)\)/);
      if (!m) return 1;
      const nums = m[1].split(',').map(x => x.trim().split(/\s+/).map(parseFloat)), hole = nums.slice(5, nums.length - 2);
      return 1 - polyArea(hole) / (parseFloat(e.style.width) * parseFloat(e.style.height));
    };
    const track = (action, n) => { const fr = []; action(); for (let i = 0; i < 240; i++) { step(); const c = F().flipController.calc; fr.push({ p: c ? c.getFlippingProgress() : 100, v: visibleFrac(n), sw: parseFloat(document.getElementById('bookShadow').style.width) }); if (B.state === 'read' && i > 2) break; } return fr; };
    const uncovers = fr => { const mid = fr.filter(f => f.p > 40 && f.p < 60); return fr.every((f, i) => !i || f.v <= fr[i - 1].v + 0.002) && mid.length && mid.every(f => f.v < 0.8 && f.v > 0.2); };
    await jump(3);
    let fr = track(() => B.prev(), 2);
    ok('close onto front cover: page 2 uncovers as the sheet lifts', uncovers(fr) && vis() === '1', fr.filter((_, i) => i % 8 === 0).map(f => f.v.toFixed(2)).join(' '));
    await jump(87);
    fr = track(() => B.next(), 87);
    ok('open onto back cover: page 87 uncovers as the sheet lifts', uncovers(fr) && vis() === String(S.N), fr.filter((_, i) => i % 8 === 0).map(f => f.v.toFixed(2)).join(' '));
    await jump(1);
    fr = track(() => B.next(), 2);
    ok('opening the cover: no shadow ahead of the turning page', fr.filter(f => f.p < 45).every(f => f.sw <= pw + 1) && Math.abs(fr[fr.length - 1].sw - 2 * pw) < 2, fr.filter((_, i) => i % 8 === 0).map(f => Math.round(f.sw)).join(' '));
  }

  // rail = reading progress: page 1 at the far left with nothing filled, last page at the far right, all filled
  const segFills = () => [...document.querySelectorAll('.rseg')].map(k => parseFloat(k.style.getPropertyValue('--fill')) || 0);
  await jump(1);
  const rail = document.getElementById('railTrack'), marker = () => parseFloat(document.getElementById('railMarker').style.left);
  ok('rail at page 1: marker at the start, no fill', marker() <= 2.01 && segFills().every(f => f === 0), { x: marker(), fills: segFills().slice(0, 3) });
  await jump(S.N);
  ok('rail at last page: marker at the end, all filled', Math.abs(marker() - (rail.getBoundingClientRect().width - 2)) < 1 && segFills().every(f => f === 100), { x: marker(), w: rail.getBoundingClientRect().width });
  await jump(7);
  const fills7 = segFills();
  ok('rail mid-book: filled up to the marker only', fills7[0] === 100 && fills7[1] > 0 && fills7[1] < 100 && fills7.slice(2).every(f => f === 0), fills7.slice(0, 4));

  let r = await applyQuery('771-0161');
  ok('search part number', r.length && r[0].n === 7, r.map(x => x.n));
  r = await applyQuery('2F1-0161-070');
  ok('search code split in the PDF text', r.length && r[0].n === 23);
  r = await applyQuery('nickel titanium');
  ok('search words', r.length >= 8, r.length);
  await applyQuery('');

  setView('scroll'); await wait(300);
  Scroll.goTo(41, false); await wait(150);
  ok('scroll view goTo', S.page === 41, S.page);
  setView('grid'); await wait(150);
  ok('grid view current tile', !!document.querySelector('.tile.current'));
  setView('book'); await until(() => S.visible.includes(41));
  ok('back to book keeps page', S.visible.includes(41), vis());

  const fails = results.filter(x => !x.pass);
  console.table(results);
  return { pass: results.length - fails.length, fail: fails.length, failed: fails, results };
};

/* UI flows - drives the real controls (buttons, inputs, keyboard) the way a visitor does:
     await NVLQA_UI()
   Never sends email, never opens share sheets. */
window.NVLQA_UI = async function NVLQA_UI() {
  const { S, Book: B, Zoom, goTo, setView } = window.NVL;
  const results = [];
  const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: typeof info === 'string' ? info : JSON.stringify(info) });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (cond, ms = 3000) => { const t0 = performance.now(); while (!cond() && performance.now() - t0 < ms) await wait(25); return cond(); };
  const $id = id => document.getElementById(id), app = $id('app');
  const key = (k, extra = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  const visible = el => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  const land = async n => { goTo(n, { animate: false }); await until(() => B.state === 'read' && S.visible.includes(n)); await wait(30); };
  for (let i = 0; i < 600 && !B.flip; i++) await wait(25);
  setView('book'); await land(20);
  if (app.classList.contains('panel-open')) $id('panelClose').click();

  // ---- search
  const headerSearch = visible($id('searchForm'));
  if (headerSearch) {
    $id('q').focus(); $id('q').value = 'nickel titanium'; $id('q').dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    $id('btnSearch').click(); await wait(80);
    $id('q2').value = 'nickel titanium'; $id('q2').dispatchEvent(new Event('input', { bubbles: true }));
  }
  await until(() => $id('results').querySelectorAll('.result').length >= 8);
  ok('search opens the Search tab with results', app.classList.contains('panel-open') && !document.querySelector('[data-pane="search"]').hidden && $id('results').querySelectorAll('.result').length >= 8);
  ok('header and panel search fields stay in sync', $id('q').value === $id('q2').value);
  const firstRes = $id('results').querySelector('.result'), firstPage = +firstRes.dataset.go;
  firstRes.click();
  await until(() => S.visible.includes(firstPage));
  ok('clicking a result opens its page', S.visible.includes(firstPage), firstPage);
  await until(() => document.querySelectorAll('.book-root .hl').length > 0, 2500);
  ok('search matches are highlighted on the page', document.querySelectorAll('.book-root .hl').length > 0);
  const input = headerSearch ? $id('q') : $id('q2');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await until(() => !document.querySelectorAll('.hl').length, 2500);
  ok('Escape clears the search and its highlights', !input.value && !document.querySelectorAll('.hl').length);
  input.blur();
  if (app.classList.contains('panel-open')) $id('panelClose').click();

  // ---- contents
  $id('btnContents').click(); await wait(60);
  ok('contents button opens the Contents tab', app.classList.contains('panel-open') && !document.querySelector('[data-pane="contents"]').hidden);
  $id('tocFilter').value = 'aligner'; $id('tocFilter').dispatchEvent(new Event('input', { bubbles: true }));
  const secs = [...document.querySelectorAll('#toc .toc__sec')].filter(b => b.offsetParent !== null);
  ok('contents filter narrows the list', secs.length >= 1 && secs.length < 10, secs.length);
  const target = +secs[0].dataset.go;
  secs[0].click(); await until(() => S.visible.includes(target));
  ok('a contents entry opens its page', S.visible.includes(target), target);
  $id('tocFilter').value = ''; $id('tocFilter').dispatchEvent(new Event('input', { bubbles: true }));
  if (app.classList.contains('panel-open')) $id('panelClose').click();
  await wait(40);

  // ---- bookmarks
  await land(33);
  const had = S.bookmarks.has(S.page);
  if (had) key('b');
  key('b');
  ok('B bookmarks the page', S.bookmarks.has(S.page) && $id('btnBookmark').getAttribute('aria-pressed') === 'true');
  ok('Saved count shows on its tab', $id('savedN').textContent === String(S.bookmarks.size));
  $id('btnContents').click(); document.querySelector('.tab[data-tab="saved"]').click(); await wait(40);
  const row = document.querySelector(`#saved [data-unmark="${S.page}"]`);
  ok('the bookmark is listed under Saved', !!row);
  if (row) row.click();
  await wait(40);
  ok('it can be removed again', !S.bookmarks.has(S.page) && $id('btnBookmark').getAttribute('aria-pressed') === 'false');
  if (had) key('b');
  if (app.classList.contains('panel-open')) $id('panelClose').click();

  // ---- go to page
  $id('pageCount').click(); await wait(30);
  ok('page counter opens a go-to field', visible($id('gotoForm')) && document.activeElement === $id('gotoInput'));
  $id('gotoInput').value = '61'; $id('gotoForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await until(() => S.visible.includes(61));
  ok('go-to field jumps to the page', S.visible.includes(61) && !visible($id('gotoForm')), S.visible);
  $id('pageCount').click(); await wait(30);
  $id('gotoInput').value = '999'; $id('gotoForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await until(() => S.visible.includes(S.N));
  ok('an out-of-range page number goes to the last page', S.visible.includes(S.N), S.visible);

  // ---- keyboard
  key('Home'); await until(() => S.visible.includes(1));
  ok('Home goes to the cover', S.visible.includes(1));
  key('End'); await until(() => S.visible.includes(S.N));
  ok('End goes to the back cover', S.visible.includes(S.N));
  key('2'); await wait(250);
  ok('2 switches to Scroll view', S.view === 'scroll' && visible($id('viewScroll')));
  key('3'); await wait(150);
  ok('3 switches to the Pages grid', S.view === 'grid' && visible($id('viewGrid')));
  const tile = document.querySelector('#grid [data-tile="47"]');
  tile.click(); await until(() => S.view === 'book' && S.visible.includes(47));
  ok('a grid tile opens that page in the book', S.view === 'book' && S.visible.includes(47), S.visible);
  key('z'); await wait(60);
  ok('Z opens zoom', Zoom.open);
  const z0 = Zoom.z; key('+');
  ok('+ zooms in', Zoom.z > z0);
  key('0');
  ok('0 fits again', Zoom.z === 1);
  key('Escape'); await wait(40);
  ok('Escape closes zoom', !Zoom.open);

  // ---- settings
  $id('btnSettings').click(); await wait(30);
  ok('settings popover opens', visible($id('settings')));
  document.querySelector('#themeSeg [data-theme="dark"]').click();
  ok('theme switches to dark', document.documentElement.dataset.theme === 'dark');
  document.querySelector('#themeSeg [data-theme="auto"]').click();
  ok('theme back to auto', !document.documentElement.dataset.theme);
  const sound0 = S.sound; $id('optSound').click();
  ok('page-turn sound toggles', S.sound === !sound0);
  $id('optSound').click();
  key('Escape'); await wait(30);
  ok('Escape closes settings', !visible($id('settings')));

  // ---- deep link
  location.hash = '#p=50'; await until(() => S.visible.includes(50));
  ok('a #p= link opens that page', S.visible.includes(50), S.visible);

  const fails = results.filter(x => !x.pass);
  console.table(results);
  return { pass: results.length - fails.length, fail: fails.length, failed: fails, results };
};
