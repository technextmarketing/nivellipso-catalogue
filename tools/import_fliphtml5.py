"""Import a FlipHTML5 book (page images, thumbnails, text layer) into _import/.

FlipHTML5 encrypts its page list, so grab it from the open book first:
  1. Open the book in a browser, e.g. https://online.fliphtml5.com/wzcly/jxok/
  2. In the browser console (F12) run:
       copy(JSON.stringify(fliphtml5_pages.map(p => [p.n.split('?')[0], p.t.replace('./', '').split('?')[0]])))
  3. Paste the clipboard into _import/pages.json
  4. python tools/import_fliphtml5.py https://online.fliphtml5.com/wzcly/jxok/
  5. python tools/build_book.py
"""
import concurrent.futures as cf
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMP = os.path.join(ROOT, "_import")
UA = {"User-Agent": "Mozilla/5.0"}


def get(url, out):
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    with open(out, "wb") as f:
        f.write(data)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    base = sys.argv[1].split("#")[0].rstrip("/") + "/"
    pages = json.load(open(os.path.join(IMP, "pages.json"), encoding="utf-8"))
    for d in ("large", "thumb", "pos"):
        os.makedirs(os.path.join(IMP, d), exist_ok=True)

    jobs = [(base + "files/search/search_config.js", os.path.join(IMP, "search_config.js"))]
    for i, (large, thumb) in enumerate(pages, 1):
        jobs.append((base + large, os.path.join(IMP, "large", f"{i:03d}.webp")))
        jobs.append((base + thumb, os.path.join(IMP, "thumb", f"{i:03d}.webp")))
        jobs.append((base + f"files/search/text_position%5B{i}%5D.js", os.path.join(IMP, "pos", f"{i:03d}.js")))

    fails = []
    with cf.ThreadPoolExecutor(8) as ex:
        futs = {ex.submit(get, u, o): u for u, o in jobs}
        for f in cf.as_completed(futs):
            try:
                f.result()
            except Exception as e:  # keep going, report at the end
                fails.append((futs[f], str(e)))
    print(f"pages {len(pages)}  files {len(jobs)}  failed {len(fails)}")
    for u, e in fails[:20]:
        print("  FAIL", u, e)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
