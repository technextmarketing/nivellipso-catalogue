# nivellipso® Product Catalogue 2026 — interactive reader

An interactive flip-book of the Nivellipso Product Catalogue 2026 (91 pages), rebuilt from the
FlipHTML5 edition at <https://online.fliphtml5.com/wzcly/jxok/> into a site we own and can change freely.
No ads, no FlipHTML5 branding, no subscription.

**Status: unlisted test link** (`noindex`, `robots.txt` disallows all) until the client signs off.

## What it does (beyond FlipHTML5)

| | |
|---|---|
| **Book** | Realistic page curl. Drag from anywhere on a page, swipe, use the arrow keys or the wheel (one turn per gesture). Spreads on desktop, single pages on phones and tall tablets. The closed cover and back cover sit centred and the book re-centres as the page turns. All pages are loaded up front (no lazy loading) and pre-decoded around the current spread, so turns never wait for an image. |
| **Scroll** | All pages in one column, with real, selectable text you can copy (table rows copy as lines). |
| **Pages** | Every page as a thumbnail, grouped by chapter. |
| **Zoom** | Click or tap any spot on a page to zoom in there. Wheel or pinch zooms to 600%, drag pans, and a text tool lets you select. |
| **Contents** | All 12 chapters and 74 sections, filterable. The printed contents on pages 3–4 are clickable too, and they jump to the right page (see QA). |
| **Search** | Full text plus 2,005 indexed part numbers. Separators don't matter (`7710161`, `771 0161`, `771-0161-000` all match), and a partial number lists every matching code. Matches are highlighted on the page. |
| **Inquiry list** | Click any part number on a page (or add it from search or by hand), set quantities, add notes, then **Email inquiry**. That opens the visitor's own mail app with the list addressed to info@nivellipso.com. Nothing is sent automatically. |
| **Bookmarks** | Saved per browser; marked on the chapter rail and in Pages view. |
| **Links** | `#p=40` opens page 40, which is the same scheme FlipHTML5 uses, so old links keep working. Share copies a link to the current page. |
| **Extras** | Light and dark mode, page-turn sound, auto-flip, full screen, keyboard shortcuts, and resume where you left off. |

## Change the book — edit `book/book.json`, then rebuild

```bash
python tools/build_book.py
```

- **Chapters / sections / page titles:** `chapters[]` — real page numbers (the folio in each page footer).
- **Hotspots (links, videos, pop-ups on any area of a page):** add to `hotspots[]`:
  ```json
  {"page": 39, "rect": [0.08, 0.10, 0.50, 0.08], "type": "link", "href": "https://www.nivellipso.com/aligner", "label": "Aligners on nivellipso.com"}
  ```
  `rect` = x, y, width, height as fractions of the page. Types: `page` (`"target": 12`), `link`, `email`,
  `video` (mp4 or YouTube URL, opens in a pop-up), `image`, `note` (`"text": "..."`).
  Email addresses and web links printed on pages become clickable automatically.
- **Inquiry email:** `inquiry.to`, `subject`, `intro`.
- **Book-mode spacers:** `settings.hideInBookMode` (pages 88–90 are blank and are dropped so the back cover lands on the left).

After any change to CSS/JS, bump the `?v=` numbers in `index.html` (GitHub Pages caches for 10 minutes).

## New edition

From FlipHTML5, which gives page images plus the text layer (so search and part numbers keep working):

1. Open the new book, run in the browser console:
   `copy(JSON.stringify(fliphtml5_pages.map(p => [p.n.split('?')[0], p.t.replace('./', '').split('?')[0]])))`
2. Paste into `_import/pages.json`, then:
   ```bash
   python tools/import_fliphtml5.py https://online.fliphtml5.com/<user>/<book>/
   ```
3. Update `book/book.json` chapters, then run `python tools/build_book.py`.

From exported page images (InDesign / Acrobat JPG or PNG), which gives pages only, with no search text:

```bash
python tools/import_images.py "path/to/pages"
```

## Files

```
index.html               reader shell
assets/reader.css        design system (Swiss red #E30613, Inter, light + dark)
assets/reader.js         reader engine (book / scroll / pages / zoom / search / inquiry)
assets/vendor/           StPageFlip 2.0.7 (MIT) - PATCHED: run python tools/patch_pageflip.py after any re-download
book/book.json           EDITABLE content model
book/manifest.json       generated: pages, titles, hotspots
book/text.json           generated: search text
book/parts.json          generated: part number -> pages
book/words/NNN.json      generated: text runs + part-number boxes per page
book/md                  1100 px pages used by the flip-book (light to decode and repaint)
book/pages, book/thumbs  full 1555 px pages (zoom, high-DPI screens) and thumbnails
tools/                   importers + build
_import/                 raw import cache (git-ignored)
```

Local preview: `python -m http.server 3986` in this folder (launch entry `nivellipso-catalogue`).

## QA

Paste `tools/qa_console.js` into the browser console on the reader and run `await NVLQA()`. It runs up to 33 checks
by driving the flip engine frame by frame (it works in a background tab too): cover and back-cover
centring, turns onto a single page uncovering the page beneath (no page popping in or out), the shadow following the paper, drags (corner, middle of page, spring-back), next/prev, contents links, part numbers, zoom, jumps, the progress rail,
search and all three views. Run it at desktop, tablet and phone sizes. It never sends an email.

### Fixes in the vendored StPageFlip (`tools/patch_pageflip.py`)

1. `flipNext`/`flipPrev` aimed their synthetic corner click without the book's offset. Every button or
   keyboard turn was dropped whenever the book was centred with space around it (phones, tall windows).
2. The render loop rewrote every page's `style.cssText` on every frame, even when idle. Writes are now
   de-duplicated (idle frame cost went from 0.29 ms to 0.003 ms).
3. Covers were forced to "hard" 3D pages that overshoot the book in perspective. All pages now curl.
4. The click-to-turn corner zone was a fifth of the page diagonal (~150 px), so links near the corners turned
   the page instead. It is now ~60 px.
