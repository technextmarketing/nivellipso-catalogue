"""Build the reader's data files from the raw import + the editable book/book.json.

    python tools/import_fliphtml5.py   # once per edition: downloads pages/text into _import/
    python tools/build_book.py         # every time book.json changes

Outputs (all generated - do not hand-edit):
    book/pages/NNN.webp     full-resolution page images
    book/thumbs/NNN.webp    thumbnails
    book/text.json          clean page text for search
    book/words/NNN.json     word boxes + part numbers + links per page
    book/manifest.json      page list, titles, chapters, hotspots
"""
import json, os, re, shutil, sys, unicodedata
from datetime import datetime, timezone

from PIL import Image, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMP = os.path.join(ROOT, "_import")
BOOK = os.path.join(ROOT, "book")
Q = 10000  # coordinates are stored as integers in 1/10000 of the page
MD_W = 1100  # width of the display-size page images used by the flip-book

PART_FULL = re.compile(r"^[0-9A-Z]{3}-\d{4}-\d{3}$")          # 771-0161-000, 7D5-0221-100, 430-5131-055
PART_SHORT = re.compile(r"^[A-Z]{2}-\d{4}K?$")                # AW-1288, EL-9001K, AD-1113K, BD-1033K
PART_HEAD = re.compile(r"^[0-9][A-Z]$")                       # "2F" in "2F 1-0161-070"
PART_TAIL = re.compile(r"^\d-\d{4}-\d{3}$")
EMAIL = re.compile(r"^[\w.+-]+@[\w-]+\.[\w.]+$")
URL = re.compile(r"^(https?://)?(www\.)?[a-z0-9-]+\.(com|ch|net|org)(/\S*)?$", re.I)
BOILERPLATE = [
    re.compile(r"^ALTGRABEN 31 .*GMBH$"),
    re.compile(r"^nivellipso®$"),
    re.compile(r"^PRODUCT ?CATALOGUE( 2026| · EDITION 2026)?$"),
    re.compile(r"^\d\d ?· ?[A-Za-z].*$"),          # running header "01 · Aesthetic Brackets"
    re.compile(r"^.$"),                                 # vertical spine letters
    re.compile(r"^(W\.NIV|LIP|O\.C|—)$"),
]


def load_positions(n):
    """FlipHTML5 stores text RUNS (a phrase per entry) with one width per character."""
    path = os.path.join(IMP, "pos", f"{n:03d}.js")
    s = open(path, encoding="utf-8").read()
    data = json.loads(s[s.index("=") + 1:].strip().rstrip(";"))
    out = []
    for w in data.get("positions", []):
        p = w["p"]
        xs, ys = (p[0], p[2], p[4], p[6]), (p[1], p[3], p[5], p[7])
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        cw = p[8:]
        if len(cw) != len(w["w"]):          # fall back to evenly spread characters
            cw = [(x1 - x0) / max(1, len(w["w"]))] * len(w["w"])
        out.append({"t": w["w"], "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0, "cw": cw})
    return out


def tokens(run):
    """Split a run into space-separated tokens with their own boxes (via character widths)."""
    out, cw = [], run["cw"]
    for m in re.finditer(r"\S+", run["t"]):
        a, b = m.start(), m.end()
        x = run["x"] + sum(cw[:a])
        out.append({"t": m.group(0), "x": x, "y": run["y"], "w": sum(cw[a:b]), "h": run["h"]})
    return out


def keep_word(w):
    """Drop the vertical spine lettering at the page edges and empty tokens."""
    if not w["t"].strip():
        return False
    if w["x"] + w["w"] < 0.07 or w["x"] > 0.95:
        return False
    return True


def q(v):
    return int(round(v * Q))


def box(ws):
    x0 = min(w["x"] for w in ws); y0 = min(w["y"] for w in ws)
    x1 = max(w["x"] + w["w"] for w in ws); y1 = max(w["y"] + w["h"] for w in ws)
    return x0, y0, x1 - x0, y1 - y0


def clean_token(t):
    return t.strip().strip(",;:()[]").upper()


def find_parts(words):
    parts = []
    for i, w in enumerate(words):
        t = clean_token(w["t"])
        if PART_FULL.match(t) or PART_SHORT.match(t):
            parts.append((t, box([w])))
        elif PART_TAIL.match(t) and i > 0 and PART_HEAD.match(clean_token(words[i - 1]["t"])):
            head = words[i - 1]
            if abs(head["y"] - w["y"]) < 0.01 and 0 <= w["x"] - (head["x"] + head["w"]) < 0.02:
                parts.append((clean_token(head["t"]) + t, box([head, w])))
    return parts


def find_links(words):
    links = []
    for w in words:
        t = w["t"].strip().strip(",;:()").rstrip(".")
        if w["y"] > 0.93:          # running footer on every page: not a hotspot (sits in the corner-drag zone)
            continue
        if EMAIL.match(t):
            links.append({"type": "email", "href": "mailto:" + t, "label": t, "rect": box([w])})
        elif URL.match(t) and "." in t:
            href = t if t.lower().startswith("http") else "https://" + t.lower()
            links.append({"type": "link", "href": href, "label": t.lower(), "rect": box([w])})
    return links


def norm(s):
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().lower()


def toc_hotspots(page, words, entries):
    """Make each printed table-of-contents line clickable, pointing at the REAL page
    (the printed TOC numbers run one page ahead of the folios)."""
    nums = [w for w in words if re.fullmatch(r"\d{1,2}", w["t"].strip())]
    spots = []
    for label, target, is_chapter in entries:
        want = norm(label)
        found = None
        for i, w in enumerate(words):
            # a printed line can be split over several runs on the same baseline
            line = [w]
            for nxt in words[i + 1:i + 4]:
                if abs(nxt["y"] - w["y"]) < 0.004 and nxt["x"] > line[-1]["x"]:
                    line.append(nxt)
                else:
                    break
            for k in range(1, len(line) + 1):
                got = re.sub(r"^\d\d(?=\s)\s*", "", norm(" ".join(r["t"] for r in line[:k])))
                if got == want or (len(want) > 12 and got.startswith(want)):
                    found = line[:k]
                    break
            if found:
                break
        if found:
            w = found[0]
            if True:
                x, y, ww, h = box(found)
                right_col = x > 0.5
                col_nums = [n for n in nums if (n["x"] > 0.5) == right_col and abs(n["y"] - y) < 0.03]
                x1 = max([n["x"] + n["w"] for n in col_nums] + [x + ww]) + 0.01
                lead = 0.0
                if is_chapter and not re.match(r"^\d\d", w["t"].strip()):
                    lead = 0.032                 # include the red chapter number printed in its own run
                x0 = x - lead - 0.008
                pad = 0.006
                spots.append({
                    "page": page, "type": "page", "target": target,
                    "label": ("Chapter " if is_chapter else "") + label + f" — p. {target}",
                    "rect": [round(x0, 4), round(y - pad, 4), round(x1 - x0, 4), round(h + 2 * pad, 4)],
                })
    return spots


def is_blank_image(path):
    im = Image.open(path).convert("L").resize((120, 170))
    st = ImageStat.Stat(im)
    return st.mean[0] > 250 and st.stddev[0] < 3


def main():
    cfg = json.load(open(os.path.join(BOOK, "book.json"), encoding="utf-8"))
    raw_text = open(os.path.join(IMP, "search_config.js"), encoding="utf-8").read()
    texts = json.loads(raw_text[raw_text.index("["): raw_text.rindex("]") + 1])
    n_pages = len(texts)
    for d in ("pages", "thumbs", "words"):
        os.makedirs(os.path.join(BOOK, d), exist_ok=True)

    # ---- page -> chapter / section titles from book.json -------------------------------
    chapter_of, section_of = {}, {}
    starts = []
    for ch in cfg["chapters"]:
        starts.append((ch["page"], ch, None))
        for title, p in ch["sections"]:
            starts.append((p, ch, title))
    starts.sort(key=lambda s: s[0])
    for i, (p, ch, title) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else n_pages
        for pg in range(p, end):
            chapter_of[pg] = ch["no"]
            section_of[pg] = title

    manifest_pages, all_parts, hotspots = [], {}, []
    toc_entries = []
    for ch in cfg["chapters"]:
        toc_entries.append((ch["title"], ch["page"], True))
        toc_entries += [(t, p, False) for t, p in ch["sections"]]

    def sync(src, dst):
        if (not os.path.exists(dst) or os.path.getsize(dst) != os.path.getsize(src)
                or os.path.getmtime(src) > os.path.getmtime(dst)):
            shutil.copyfile(src, dst)

    # a shorter new edition must not leave old pages behind
    for d in ("pages", "thumbs", "words", "md"):
        if not os.path.isdir(os.path.join(BOOK, d)):
            continue
        for f in os.listdir(os.path.join(BOOK, d)):
            m = re.match(r"(\d{3})\.", f)
            if m and int(m.group(1)) > n_pages:
                os.remove(os.path.join(BOOK, d, f))

    os.makedirs(os.path.join(BOOK, "md"), exist_ok=True)
    for n in range(1, n_pages + 1):
        src = os.path.join(IMP, "large", f"{n:03d}.webp")
        sync(src, os.path.join(BOOK, "pages", f"{n:03d}.webp"))
        sync(os.path.join(IMP, "thumb", f"{n:03d}.webp"), os.path.join(BOOK, "thumbs", f"{n:03d}.webp"))
        # display-size copy for the flip-book: far less to decode and repaint per frame than 1555 px
        md = os.path.join(BOOK, "md", f"{n:03d}.webp")
        if not os.path.exists(md) or os.path.getmtime(src) > os.path.getmtime(md):
            im = Image.open(src).convert("RGB")
            im.resize((MD_W, round(im.height * MD_W / im.width)), Image.LANCZOS).save(md, "WEBP", quality=82, method=6)
        w_, h_ = Image.open(src).size

        words = [w for w in load_positions(n) if keep_word(w)]
        toks = [t for w in words for t in tokens(w)]
        parts = find_parts(toks)
        links = find_links(toks)
        for code, _ in parts:
            all_parts.setdefault(code, set()).add(n)
        for l in links:
            hotspots.append({"page": n, "type": l["type"], "href": l["href"], "label": l["label"],
                             "rect": [round(v, 4) for v in l["rect"]], "auto": True})
        if n in cfg["settings"].get("tocPages", []):
            hotspots += toc_hotspots(n, words, toc_entries)

        blank = not texts[n - 1].strip() and is_blank_image(src)
        with open(os.path.join(BOOK, "words", f"{n:03d}.json"), "w", encoding="utf-8") as f:
            json.dump({
                "w": [[w["t"], q(w["x"]), q(w["y"]), q(w["w"]), q(w["h"]), [q(c) for c in w["cw"]]] for w in words],
                "p": [[c, q(b[0]), q(b[1]), q(b[2]), q(b[3])] for c, b in parts],
            }, f, ensure_ascii=False, separators=(",", ":"))

        label = cfg.get("pageLabels", {}).get(str(n))
        ch_no = chapter_of.get(n)
        if not label:
            if blank:
                label = "Blank page"
            elif ch_no and section_of.get(n) is None:
                ch = next(c for c in cfg["chapters"] if c["no"] == ch_no)
                label = f"Chapter {ch_no} · {ch['title']}"
            else:
                label = section_of.get(n) or ""
        manifest_pages.append({"n": n, "w": w_, "h": h_, "blank": blank, "title": label,
                               "chapter": ch_no, "parts": len(parts)})

    # ---- clean search text --------------------------------------------------------------
    clean = []
    for t in texts:
        lines = [l.strip() for l in t.replace("\r", "").split("\n")]
        lines = [l for l in lines if l and not any(b.match(l) for b in BOILERPLATE)]
        clean.append("\n".join(lines))
    with open(os.path.join(BOOK, "text.json"), "w", encoding="utf-8") as f:
        json.dump(clean, f, ensure_ascii=False, separators=(",", ":"))

    pw, ph = manifest_pages[0]["w"], manifest_pages[0]["h"]
    manifest = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pageCount": n_pages,
        "pageSize": [pw, ph],
        "pages": manifest_pages,
        "hotspots": hotspots + cfg.get("hotspots", []),
        "stats": {"parts": len(all_parts), "partMentions": sum(len(v) for v in all_parts.values())},
    }
    with open(os.path.join(BOOK, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(BOOK, "parts.json"), "w", encoding="utf-8") as f:
        json.dump({c: sorted(p) for c, p in sorted(all_parts.items())}, f, separators=(",", ":"))

    # ---- white logo for dark mode -------------------------------------------------------
    logo = os.path.join(ROOT, "assets", "brand", "logo_black.webp")
    if os.path.exists(logo):
        im = Image.open(logo).convert("RGBA")
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px[x, y]
                if a and max(r, g, b) < 90 and abs(r - g) < 30 and abs(g - b) < 30:
                    px[x, y] = (255, 255, 255, a)
        im.save(os.path.join(ROOT, "assets", "brand", "logo_white.webp"), "WEBP", quality=92)

    toc_spots = [h for h in hotspots if h["type"] == "page"]
    print(f"pages {n_pages}  blanks {[p['n'] for p in manifest_pages if p['blank']]}")
    print(f"part numbers {len(all_parts)} unique / {manifest['stats']['partMentions']} page mentions")
    print(f"hotspots: toc {len(toc_spots)} / {len(toc_entries)} entries, links {len(hotspots) - len(toc_spots)}")
    missing = [e[0] for e in toc_entries if not any(e[0] in h["label"] for h in toc_spots)]
    if missing:
        print("TOC entries not found on the printed TOC:", missing)


if __name__ == "__main__":
    sys.exit(main())
