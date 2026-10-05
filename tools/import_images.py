"""Import a new edition from a folder of page images (JPG/PNG/WebP exported from InDesign or Acrobat).

    python tools/import_images.py "path/to/exported pages"
    python tools/build_book.py

Files are taken in natural name order (page1, page2 ... page10). Images are converted to
1555 px wide WebP pages + 339 px thumbnails. Without FlipHTML5 there is no text layer, so
search, part numbers and highlights stay empty unless _import/search_config.js and
_import/pos/*.js are provided (re-import from FlipHTML5 to get them).
"""
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMP = os.path.join(ROOT, "_import")
PAGE_W, THUMB_W = 1555, 339


def natural(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    src = sys.argv[1]
    files = sorted((f for f in os.listdir(src) if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))), key=natural)
    if not files:
        print("no images found in", src)
        return 1
    for d in ("large", "thumb", "pos"):
        os.makedirs(os.path.join(IMP, d), exist_ok=True)
    for i, name in enumerate(files, 1):
        im = Image.open(os.path.join(src, name)).convert("RGB")
        h = round(im.height * PAGE_W / im.width)
        im.resize((PAGE_W, h), Image.LANCZOS).save(os.path.join(IMP, "large", f"{i:03d}.webp"), "WEBP", quality=84)
        th = round(im.height * THUMB_W / im.width)
        im.resize((THUMB_W, th), Image.LANCZOS).save(os.path.join(IMP, "thumb", f"{i:03d}.webp"), "WEBP", quality=78)
        pos = os.path.join(IMP, "pos", f"{i:03d}.js")
        if not os.path.exists(pos):
            with open(pos, "w", encoding="utf-8") as f:
                f.write(f'positionForPages[{i - 1}]={{"page":{i},"positions":[]}};')
        print(f"{i:03d}  {name}")
    sc = os.path.join(IMP, "search_config.js")
    if not os.path.exists(sc):
        with open(sc, "w", encoding="utf-8") as f:
            f.write("var textForPages =" + json.dumps([""] * len(files)) + ";")
    print(f"imported {len(files)} pages - now run: python tools/build_book.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
