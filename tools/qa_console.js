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
  ok('part number hit-test', tg.kind === 'part' && tg.p.code === part[0], tg.kind);
  B.activate(p.x, p.y);
  ok('part popover opens', !document.getElementById('partpop').hidden);
  document.getElementById('partpop').hidden = true;
  p = clientPt(7, 0.5, 0.06); B.activate(p.x, p.y);
  ok('click on plain page zooms', Zoom.open); Zoom.close(); await wait(20);

  await jump(77);
  ok('long jump', S.visible.includes(77), vis());
  await jump(89);
  ok('hidden blank page falls back', vis() === exp(87), vis());

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
