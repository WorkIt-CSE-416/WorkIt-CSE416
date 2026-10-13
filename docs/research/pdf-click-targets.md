# Click targets on the Tectonic PDF

Research for KAN-181 (resume builder redesign). The question: the editor
chosen in KAN-195 makes the PDF page itself the editor. The student clicks a
line (a bullet, an entry title, dates) and types in place. How does the
Next.js app place click targets and text fields over the PDF that Tectonic
renders, and map each one back to the bank entry or bullet that made it?

**Read and measured on 2026-10-13.** The renderer under test is the one on
branch `KAN-176-resume-builder-plan`: `backend/app/services/resume_render/`
(`jakes.tex`, `to_latex.py`), Tectonic 0.17.0 (the version
`backend/scripts/fetch_tectonic.py` pins), run as `tectonic -X compile
--untrusted`. The body was Jake's own sample content. Timings come from a
macOS laptop with a warm cache. The test files and scripts were throwaway
and are not committed.

"Measured" means we ran it. "Source" means we read it in docs or code.

## The answer in short

- **Use position markers written to a side file** (option 2). The LaTeX body
  puts a zero-width `\pdfsavepos` marker at the start and end of each bullet
  and each entry field. Each marker writes `id start|end x y page` to
  `resume.pos`. The API turns those points into boxes and sends them with the
  PDF.
- **The markers do not change the page.** With the markers, the page's
  content stream was byte for byte the same as without them (measured). So
  the preview is still exactly the file that downloads. The CI text test sees
  no change.
- **The markers need one trick.** A marker at the end of an italic field
  removes LaTeX's italic correction, and the dates moved 0.4 to 0.8 pt. An
  explicit `\/` before the end marker restores it. After that, all 398 words
  sat at the same positions (measured).
- **SyncTeX works but is coarse** (option 1). It maps to the source line of
  a whole macro call, so it cannot tell an entry's title from its dates. It
  also puts the end of one bullet on the next bullet's line.
- **The text layer is the most fragile** (option 3). Identical text appears
  twice in Jake's own sample ("Southwestern University"). Matching needs
  the TeX ligatures and escapes undone.
- **An HTML imitation** (option 4) gives instant typing but breaks "the
  preview shows the PDF" (ADR 0002). Line breaks and page count would
  differ from the PDF.
- **Every PDF option has the same latency.** Each edit is a full Tectonic
  compile: 0.28 s on a laptop, 0.7 s in the Lambda image (KAN-176's note).
  The field must show the typed text itself until the new PDF arrives.

## Comparison

| | 1. SyncTeX | 2. `\pdfsavepos` side file | 2b. Link annotations / named dests | 3. pdf.js text layer | 4. HTML imitation |
|---|---|---|---|---|---|
| Granularity | One macro call (a bullet, or a whole entry header) | Any span the body marks: a bullet, a title, a date | Any span; annotations give one rect per wrapped line | One text run per line, per font | Any element |
| Accuracy | Baselines exact; boxes need heuristics | Exact points; boxes rebuilt from start, end and column edges | Exact rects (annotations); a point only (dests) | Exact positions, but the match to an id is a guess | Exact for the HTML, not for the PDF |
| PDF changed? | No | No. Content stream identical (measured) | Yes. `/Annots` or `/Dests` added; must be stripped for download | No | Preview is not the PDF |
| Backend cost | stdlib `gzip` + `re`; parse 1.5 ms | stdlib; one small text file | `pypdf`, already a dependency | None | None |
| Frontend cost | pdf.js (~111 KB + 287 KB worker, gzip) | Same | Same | Same | None |
| CI text test | Unchanged | Unchanged | Text unchanged | Unchanged | Still tests the PDF, which the student no longer sees while editing |
| Complexity | Medium: undocumented format, heuristics | Low: two macros, one reader | Medium: second clean file or strip step | High: fuzzy matching | High: a second renderer to keep in step |

## How the page is drawn today, and what changes

`frontend/src/components/resume-preview.tsx` (KAN-176) shows the PDF in an
`<iframe>`. The browser's own PDF viewer draws it. A page cannot place
elements over that viewer. **Options 1 to 3 all need pdf.js** to draw the page
onto a canvas, with the click targets as absolutely positioned elements on
top.

pdf.js 5.4.149 measured: `pdf.min.mjs` is 394 KB (111 KB gzip) and
`pdf.worker.min.mjs` is 1,039 KB (287 KB gzip). Load it only on the editor
page. Open and first page took 25 ms in Node. The PDF puts the origin at the
bottom left, in points (1/72 in). CSS puts it at the top left. pdf.js's page
viewport converts between them (`viewport.convertToViewportRectangle`).

## 1. SyncTeX from Tectonic

**Support.** Tectonic has had `--synctex` since 0.1.6 (2017): "SyncTeX output
is now fully supported, activated with the new `--synctex` option". 0.6.0
fixed its file paths. 0.16.0 added a `synctex` key to `Tectonic.toml`
(Tectonic `CHANGELOG.md`, release branch). The pinned 0.17.0 accepts
`tectonic -X compile --synctex` (measured, `--help`). The flag works
together with `--untrusted`.

**What the file holds.** The format is in `synctex(5)` (jlaurens/synctex,
`man5/synctex.5`). Records are boxes (`[` vbox, `(` hbox, `v`/`h` void boxes,
each with width, height and depth) and points (`k` kern, `g` glue, `$` math,
`x` current). Each record carries `tag,line` (an input file and a line
number). **There are no glyph records.** The units are scaled points
(1/65536 TeX pt). The man page also warns that the structure "should not be
considered public" and should be read through the `synctex` tool or its C
parser. Tectonic ships neither.

**What we saw** (Jake's sample, one `\resumeItem` per source line, 7.6 KB
gzipped):

- Glue records on the bullet's own line give each baseline and its x range.
  A bullet that wraps gives two baselines. That part is exact.
- The hbox for a line of a paragraph gets the line number where the paragraph
  ended. The previous bullet ends when the next `\item` is read. So line N
  also holds a stray record at the right margin of bullet N-1. A reader must
  drop it with a rule such as "ignore rows with only right-margin glue".
- All four fields of `\resumeSubheading` came out on one line number. TeX
  reads all of a macro's arguments before it typesets them, so the fields
  cannot be told apart by line. Telling title from dates means a geometric
  rule for each template (left or right column, first or second row).
- Tectonic wrote `Input:2:` to `Input:29:` with empty names for the package
  files. Only the main file has a path. That is harmless here, because the
  body is in the main file.
- A 40-line Python parser read the file in 1.5 ms.

**Mapping to ids.** `to_latex.body()` already writes one `\resumeItem{...}`
per line. It would also return a map from line number to id. Applicant text
must never hold a newline, or every later line shifts. The current `escape()`
does not remove newlines.

**Verdict.** It works for bullets and needs heuristics. It cannot separate
the fields of an entry header, which KAN-195 needs (click the dates).

## 2. Markers without SyncTeX

### 2a. `\pdfsavepos` to a side file (recommended)

**Support.** Tectonic's XeTeX has the pdfTeX position primitives:
`PdfSavePos PDF_SAVE_POS_NODE` in `crates/xetex_format/src/enums/simple.rs`,
and `pdflastxpos` / `pdflastypos` in `.../enums/dynamic.rs`
(tectonic-typesetting/tectonic). XeTeX gained them in 0.994, in 2006 (Kew
on the tex-live list, January 2007). zref's `zref-savepos` module wraps the
same primitives. We do not need it: loading a package would change the
preamble, which must stay byte for byte.

**The macros.** They are defined after `\begin{document}`, so `jakes.tex`'s
preamble does not change. `body()` writes them:

```latex
\newwrite\wipos\immediate\openout\wipos=\jobname.pos
\def\wimark#1#2{\leavevmode\pdfsavepos
  \write\wipos{#1 #2 \the\pdflastxpos\space\the\pdflastypos\space\thepage}}
\def\wiend#1{\/\wimark{#1}{e}}
% a bullet
\resumeItem{\wimark{b-42}{s}Developed a REST API ...\wiend{b-42}}
% an entry header: one pair per field
\resumeSubheading
  {\wimark{e-7.title}{s}Southwestern University\wiend{e-7.title}}{...}
```

The `\write` is not immediate, so it runs when the page ships out. The
position and page number are then final. The ids are ours (UUIDs or
integers), never applicant text, so they need no escaping.

**What we measured.**

- It compiles under `--untrusted --only-cached`. Tectonic kept `resume.pos`
  in `--outdir` without `--keep-intermediates`.
- `\leavevmode` is needed. Without it, the first marker sits in vertical
  mode and records the left margin (36 pt), not the text start (70.8 pt).
- **Italic correction:** a marker after the last letter of an italic field
  replaces LaTeX's italic correction. "College Station, TX" moved 0.82 pt and
  "Aug. 2014 -- May 2018" moved 0.43 pt. The cause: XeTeX's Latin Modern
  reports a slant (`\fontdimen1`) of 0 pt, but `\textit` still adds `\/`.
  So a test on slant does not work. An unconditional `\/` before the end
  marker does.
- **With `\/`, the page content stream was byte for byte the same** as the
  unmarked compile (16,765 bytes). All 398 words were at the same
  positions. The markers add nothing to the PDF.
- 20 bullets and 20 header fields gave 80 lines in `resume.pos`, a start
  and an end for each. A wrapped
  bullet gave a start point (70.8, baseline 224.9) and an end point (545.9,
  baseline 236.8). PyMuPDF's line boxes for that bullet ended at 568.7 and
  545.9, with baselines on the same rows.

**From points to boxes.** Convert sp to PDF points (`sp / 65536 * 72 /
72.27`). `\pdflastypos` counts from the bottom of the page. Jake's Resume is
Letter, so the top is 792 pt. A field is a box from its start x to its end x
on one baseline. A bullet runs from its start baseline to its end baseline.
The first row runs from the start x to the column's right edge, the middle
rows span the column, and the last row ends at the end x. Height is the
font's ascent and descent: about 10 pt for `\small`, read from the template.
A click target can be a little loose, so this is accurate enough. It is exact
at the edges where the text starts and stops.

**Pages.** `\thepage` is recorded at shipout, so a bullet on page 2 says 2.
A bullet split across a page break gives a start on one page and an end on
the next. The reader must handle that case, or the builder can keep its
one-page warning and treat that case as rare.

### 2b. Link annotations or named destinations

Tectonic's PDF backend is a port of dvipdfmx. It honours
`\special{pdf:bann <<...>>}` ... `\special{pdf:eann}` (a breakable
annotation) and `\special{pdf:dest (name) [@thispage /XYZ @xpos @ypos null]}`.

- **Measured:** a `/Link` annotation with `/URI (workit:b1)` came out as one
  rect per line of a wrapped bullet. pdf.js `getAnnotations()` returned it
  as `unsafeUrl: "workit:b1"` with `url` unset, because `workit:` is not an
  allowed scheme (`pdf.worker.mjs`, `parseDestDictionary`). Named
  destinations came back from `getDestinations()` as one point each.
- **The catch:** these live in the PDF. A student's PDF reader would show
  `workit:` links that do nothing. The download would have to be a second
  compile without them, or the annotations stripped with `pypdf`. Either
  way the preview is no longer the downloaded file. The same italic
  correction shift applies.
- It has no gain over 2a for the editor. Rects per line are its one
  advantage. 2a rebuilds those cheaply.

## 3. The pdf.js text layer

`page.getTextContent()` returns items with `str`, a `transform` (position and
size) and `width`. In Jake's sample there was one item per run of one font on
one line (measured, pdf.js 5.4.149).

- **Ligatures:** the PDF holds `ﬀi` (U+FB00) for "ffi". pdf.js normalizes text
  by default; `disableNormalization: true` turns that off (`api.d.ts`). With
  the default, "ffi" came back plain. `pypdf` and PyMuPDF returned `ﬀi`.
- **Small caps:** the section heading came back as "Experience", not
  "EXPERIENCE". Matching on it works.
- **Hyphenation:** Jake's Resume is `\raggedright`. The right margin is
  `0pt plus 1fil`, so every line's badness is 0. TeX's first pass, with no
  hyphenation, then always succeeds. We saw no hyphens.
- **The real fragility is matching**, not extraction:
  - Identical text appears twice. Jake's own sample lists "Southwestern
    University" and "Georgetown, TX" more than once.
  - A wrapped bullet is two items. A bold skill label and its text are
    separate items.
  - TeX changes the text: `--` prints as an en dash, `\&` as "&", and quote
    ligatures as curly quotes.
  - Order on the page decides between duplicates, which breaks when the
    student reorders entries.
- **Cost:** none on the server. It runs in the browser after each render.

Use it only as a fallback, never as the primary map.

## 4. An HTML page that imitates the PDF

The KAN-195 prototype already does this (`frontend/src/app/prototype-editor/
paper.tsx`, a stand-in for Jake's Resume). `to_pdf.py` (KAN-176) imitates
the template in fpdf2 and is "measured to match the LaTeX closely, not
exactly".

- **Gain:** typing is instant, with no network and no compile. Every
  element has its id for free.
- **Loss:** ADR 0002 says "The rendered PDF is the only look: the preview
  shows it". A browser breaks lines differently from TeX, so the page count
  and the one-page warning can disagree with the file. Every template would
  be built twice, which ADR 0002 rejected for Typst.
- **A hybrid** shows the HTML while the student types and swaps in the PDF
  after a pause. It shows two looks that jump between each other. It still
  needs two renderers.

Choose it only if the measured latency on Vercel makes the PDF editor feel
broken.

## Latency per edit (all PDF options)

- A warm compile of Jake's sample took 0.28 s on the laptop. `--synctex`
  added nothing measurable. KAN-176 measured 0.7 s for the deployed bundle in
  AWS Lambda's `python:3.12` image, cold or warm.
- A cold function also copies the ~40 MB package cache to `/tmp` once per
  process (`to_latex._vendored_cache`).
- So the field must not wait for the PDF. The plan:
  1. On click, place a text field over the box. Set it in CMU Serif, which
     is already in the repo under the SIL OFL, at the line's size.
  2. The student types into the field, which grows as needed. The PDF under
     it is stale.
  3. Save and re-render after a pause of about 600 to 800 ms, and on blur
     or Enter. Number each request and drop any response older than the
     latest.
  4. When the new PDF and boxes arrive, swap them in and move the field to
     the new box.
- **Never compile on each keystroke.** Each compile is a function call that
  costs money and occupies an instance.

## Recommendation

Use **option 2a: `\pdfsavepos` markers written to `resume.pos`**.

1. `to_latex.body()` takes an id with each block and wraps each bullet and
   each entry field as `\wimark{id}{s}...\wiend{id}`. The macros are defined
   right after `\begin{document}`, and the preamble stays byte for byte.
2. `write_latex_pdf()` also reads `resume.pos` and returns boxes:
   `{id, page, x0, y0, x1, y1}` in PDF points, top-left origin.
3. The API sends the PDF and its boxes together, or as a pair the client can
   tie together (the same render id).
4. The editor draws the page with pdf.js on a canvas, places a button per
   box, and opens an in-place field on click. The sticky bar acts on the
   selected id.
5. A CI test compiles one resume with and without markers and asserts that
   the page content streams match. That catches a future template whose
   markers move text.

Keep SyncTeX and the text layer out. Revisit option 4 only if real latency is
too slow.

## What the decision waits on

- **Real latency on Vercel:** a warm and a cold edit-to-new-PDF round trip
  from a preview deployment. The 0.7 s figure is from a Lambda image, not
  Vercel. It sets the debounce and decides whether option 4 is needed.
- **The team accepts pdf.js** in place of the browser viewer on the editor
  page: about 400 KB gzip, loaded only there. Zoom, text selection and the
  full-size view become ours to build.
- **The response shape:** PDF and boxes in one response (JSON with the PDF
  base64-encoded, or a header), or two calls tied by a render id. Each
  affects caching and the download route.
- **Ids in blocks:** `Bullet` and `EntryHeader` carry text only today
  (`blocks.py`). They need the bank entry id and the bullet id, and a field
  name for each header field.
- **Each new template** places its own markers and must pass the same
  content-stream test.
- **Newlines in applicant text** must never reach the LaTeX source unescaped.
  That matters for every option and is open today.

## Sources

- Tectonic `CHANGELOG.md`, release branch: `--synctex` in 0.1.6, SyncTeX
  path fix in 0.6.0, `synctex` key in 0.16.0, 0.17.0 dated 2026-07-27.
  https://github.com/tectonic-typesetting/tectonic/blob/release/CHANGELOG.md
- Tectonic source, position primitives:
  `crates/xetex_format/src/enums/simple.rs` (`PdfSavePos`),
  `crates/xetex_format/src/enums/dynamic.rs` (`pdflastxpos`, `pdflastypos`).
  https://github.com/tectonic-typesetting/tectonic
- `synctex(5)`, the file format: https://github.com/jlaurens/synctex/blob/main/man5/synctex.5
- XeTeX position primitives since about June 2006 (Jonathan Kew):
  https://www.tug.org/pipermail/tex-live/2007-January/012170.html and
  https://tug.org/pipermail/xetex/2006-June/003813.html
- pdf.js 5.4.149 (`pdfjs-dist`): `types/src/display/api.d.ts`
  (`disableNormalization`), `build/pdf.worker.mjs` (`unsafeUrl`).
  https://github.com/mozilla/pdf.js
- PyMuPDF 1.28.2 on PyPI: AGPL-3.0 or Artifex commercial, 25.8 MB wheel. It
  was used here only to measure. Do not add it to the API.
  https://pypi.org/project/PyMuPDF/
- pdfminer.six 20260107 on PyPI: MIT, 6.6 MB wheel. It is not needed.
  https://pypi.org/project/pdfminer.six/
- Jake's Resume: https://github.com/jakegut/resume (`resume.tex`, MIT)
- WorkIt: `docs/adr/0002-built-resumes-render-with-latex.md`; branch
  `KAN-176-resume-builder-plan`, `backend/app/services/resume_render/`
  (`CLAUDE.md`, `to_latex.py`, `blocks.py`, `jakes.tex`),
  `frontend/src/components/resume-preview.tsx`; branch
  `prototype/KAN-195-resume-editor`.
