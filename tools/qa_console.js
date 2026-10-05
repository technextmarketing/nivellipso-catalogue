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
