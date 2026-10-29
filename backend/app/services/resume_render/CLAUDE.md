# CLAUDE.md — resume rendering

How a built resume becomes a PDF: Jake's Resume's own LaTeX, compiled by
Tectonic inside the API (ADR 0002): a Vercel Function until the KAN-296
cutover, then the Cloudflare Container (ADR 0004). And a plain Word file.
Loaded on top of `../../../CLAUDE.md`. KAN-204 proved Tectonic with a fixed
resume; KAN-207 renders the bank and retired the proof endpoint.

## The interface

- **`render(view, identity, template)` is the one way to a PDF.** It takes a
  built resume view (`../resume_view.py`, the shape every resume feature
  reads), the profile's `HeaderIdentity` (`built_resumes.load_header_identity`) and a template id, and returns
  `Rendered(pdf, page_count, missing_characters, boxes)`. An unknown template
  id is a `ValueError`. Add fields to `Rendered`, never a second render
  function.
- **A template is a function from the view and identity to a LaTeX body**
  (`jakes.py`), registered by its stable id in `_document()`. The id is stored
  on `built_resumes.template`, so never rename one.
- **`fields.py` is how a field reads as text** (dates, GPA, headings, skill
  groups), shared by the PDF and the Word file so the two never disagree.
  Change wording there, not in a layout.
- **`latex(view, identity, template)` is the same document's source**,
  for the editor's Download LaTeX (`GET .../built-resumes/{rid}/tex`): the
  body with `marks=False`, so the student gets Jake's own `.tex` with no
  `\wimark` lines, ready for Overleaf. It shares `_document()` with
  `render()`, so the two never print different text. It needs no Tectonic.
- **The Word file is `word.py`'s one plain layout**, Letter only. It is not a
  copy of Jake's look and has no template id.
- **Boxes place the editor's click targets** (KAN-209): one `Box(item_id,
  kind, page, x0, y0, x1, y1)` per bullet, skill and shown entry field, in
  PDF points from the page's top left, y growing down. `item_id` is the
  bank id (the entry's for its fields), and `kind` is `bullet`, `skill` or
  the field: `title`, `organization`, `location`, `dates`, `degree`
  (Education's subtitle, which also names the school), `gpa`, `coursework`,
  `honors`. `fields.heading_fields()` says which field each heading slot
  shows. The header's boxes have `item_id` `HEADER` ("header", not a
  bank id) and the profile column as `kind`: `full_name`, `phone_number`,
  `email`, `linkedin_url`, `github_url`, `portfolio_url`, `other_url`, which
  is why `HeaderIdentity.links` carries each link's column. The `email` box
  prints the profile's `email_for_employers`: the contact email, else the
  sign-in email (KAN-262). The editor never types it; My Profile sets it.
  **"U.S. Citizen"** (`fields.US_CITIZEN`) leads the contact line, PDF,
  LaTeX and Word alike, when `HeaderIdentity.us_citizen` is set: the
  answer bank's `work_authorization_status` is `us_citizen` (My Profile's
  Application Questions, onboarding's Profile step). It has
  no box, since the editor types only fields it can save. The line's
  order is U.S. Citizen, phone, email, LinkedIn, GitHub, portfolio, other. A sent resume's
  hash and snapshot leave `us_citizen` out while it is false
  (`sent_resumes._identity`), so a resume sent before it still repeats.
  The name's box
  reaches `NAME_ASCENT`/`NAME_DESCENT`, since it prints `\Huge`. The editor
  types them into the profile. The render route sends them as `RenderResponse.boxes`
  (`schemas/built_resume.py`).
  **Each box carries the words it prints** (`Box.text`, KAN-391), labels
  included ("GPA: 3.8/4.0"): `jakes.body(..., printed=)` notes each marked
  line's plain text under its marker's name as it writes the line, and
  `render()` puts it on the box. The editor opens its typing field on it
  and the live page draws it (`../../../../docs/live_page.md`), so the
  browser holds no copy of `fields.py`. A new template notes its text the
  same way, from the same string it escapes, never from a second rule.
- **`Rendered.lines_over` is read from the boxes** (KAN-218): the distinct
  baselines past page 1, a wrapped box counting each line
  (`box_lines`, `WRAPPED_LINE`). Section headings and the space
  between entries have no box, and blocks move whole across the page
  break, so it can run several lines short (`line_count` is the shared
  count): the editor's chip shows it, and Fit to One Page re-renders and
  puts back what it did not need rather than trust it.
- **Page count and missing characters come from Tectonic itself**: the page
  count from XeTeX's "Output written on ... (N pages" log line
  (`--keep-logs`), the missing characters from its "Missing character: There
  is no X (U+XXXX)" warnings on stderr, read by code point because stderr
  can garble the character. Each is reported once, in page order. No PDF
  library is needed, so the render path stays stdlib.

## Rules

- **Jake's preamble stays byte for byte.** `jakes.tex` is the KAN-176
  prototype's copy of jakegut/resume (MIT, Jake Gutierrez), and only that file
  is reused from the prototype. Its one change from the published original,
  commented in the file, skips the two pdfTeX-only `\pdfgentounicode` lines,
  which XeTeX lacks and does not need. `tests/test_resume_render.py` pins its
  SHA-256. Never edit it to fix a layout; write the body differently. Its
  header comment names `to_latex.py`, a prototype file that does not exist
  here: the body goes in at `%%BODY%%` through `jakes_document()`.
- **All applicant text goes through `escape()`**, the one escape function,
  tested directly with `\input{/etc/passwd}` and newlines. It also turns every
  newline into a space: a blank line ends a command's argument early. Never
  put applicant text into the LaTeX any other way. **A `\href` target is the
  one exception, and goes through `escape_url()`**: the same table, except
  `~` and `^` become `\string~` and `\string^`, because hyperref turns
  `\textasciitilde{}` into `~{}` and the link breaks
  (`cs.example.edu/~jdoe`). `\_`, `\%` and `\#` already reach the link as
  the bare character. `tests/test_resume_render.py` reads the PDF's link
  targets back.
  **The PDF's Title is the other exception, and goes through `pdf_title()`**
  (KAN-317): "Jane Doe Resume", from the identity's name, written by
  `render()` at the start of every template's body as an xdvipdfmx
  `\special{pdf:docinfo ...}`. The name goes in as UTF-16 hex digits, so it
  never meets the TeX parser or PDF string syntax; the test renders a name
  holding `\input{...}`, brackets and `>>` and reads it back. With no Title,
  Chrome's viewer showed the in-app dialog's `blob:` link id as the name.
  A special is a whatsit, so the page and its content stream are unchanged,
  and the sent resume's content hash (view, identity, template) is too.
  `latex()` leaves the Title out: pdfLaTeX, Overleaf's default, ignores an
  xdvipdfmx special with a warning, and the student's `.tex` should be
  Jake's own.
  **`--untrusted` is not what keeps this safe:** it turns off shell escape,
  but Tectonic still reads any file the process can (`\input{/etc/hosts}`
  compiled in the prototype, 2026-10-12). Escaping is the guard.
- **Tectonic runs `--untrusted --only-cached`**, so a render never reaches the
  network. `offline=False` exists only for the build script's warm-up.
- **A compile never sees the API's environment.** `_env()` passes `PATH`,
  `HOME` and the cache location only, never the database URL or the
  service-role key.
- **An empty itemize is a LaTeX error**, so a bullet list opens only around
  bullets.
- **Every `\resumeItem` argument ends in `\ignorespaces`** (KAN-391). Jake's
  macro puts a space after its argument (`{#1 \vspace{-2pt}}`); when a
  bullet's last line was full, TeX broke at that space and printed an
  empty line after the bullet, 14.9 pt where bullets sit 2.9 pt apart, in
  Overleaf too. `\ignorespaces` swallows the space, so `jakes.tex` stays
  byte for byte. A new template whose macros leave a space before a
  `\vspace` needs the same.
- **Position markers never move the page.** `MARKS` (in `__init__`) goes at
  the start of the body, after `\begin{document}`, so the preamble stays
  byte for byte; `mark(id, kind, latex)` wraps each line. `\pdfsavepos`
  writes each start and end point to `resume.pos` at shipout, and
  `_boxes()` turns them into boxes: a wrapped line runs to the text's right
  edge, a line split across pages gives a box on each, and a box reaches
  `ASCENT`/`DESCENT` around its baselines. Three things learned the hard
  way (research branch `research/KAN-181-pdf-click-targets`, and here):
  `\leavevmode` first, or a marker records the margin; `\/` before each end
  marker, or an italic field loses its italic correction (dates moved
  0.4 to 0.8 pt); and **no marker between two characters**, which drops
  their kerning ("NumPy," moved when a marker sat before the comma, so each
  skill's comma is inside its markers). `body(..., marks=False)` exists for
  the test that compares each page's content stream with and without
  markers; every new template must pass it.
- **Everything the build script imports stays stdlib**: this package's
  `__init__`, `fields.py`, `jakes.py`, `sample.py` and `../resume_view.py`.
  `scripts/fetch_tectonic.py` imports them before Vercel installs anything;
  only `word.py` may use a dependency. `python3 -I -c "import sys;
  sys.path.insert(0, '.'); import app.services.resume_render.sample"` from
  `backend/` checks it.
- **TeX's font mapping still applies to escaped text**: `'` prints as `’`,
  `--` as `–`, ``` `` ``` as `“`. Harmless for a resume; a text test expects
  the curly form.
- **Read the PDF in plain mode** (pdfminer `extract_text`, pypdf plain). The
  PDF is untagged, and LaTeX places words rather than writing spaces. pdfminer
  reads the right-hand column (places, dates) as its own block, so the text
  test checks each field alone, never a whole row.

## Tectonic: build and runtime

- **Pinned:** `scripts/fetch_tectonic.py` holds the version (0.17.0) and the
  static Linux build's SHA-256, and refuses a download that does not match.
  It is stdlib only, because it runs as Vercel's build command
  (`backend/vercel.json`) before anything is installed. The container image
  runs the same script in `backend/Dockerfile`, after `uv sync`.
- **What it builds:** `backend/vendor/tectonic/` (gitignored): the binary on
  Linux x86_64, and a package cache warmed by compiling `sample.py` (Jake's
  sample content as a view, through the real `jakes.py`) once online
  (~44 MB). On a Mac it uses `brew install tectonic` from PATH and
  warms the same cache. Run `python3 scripts/fetch_tectonic.py` from
  `backend/` once; `--check` compiles offline from the cache.
- **Warming gets 10 minutes, a render 60 s** (`WARM_TIMEOUT_SECONDS`,
  `COMPILE_TIMEOUT_SECONDS`). The online compile downloads every package,
  and under the render's 60 s it failed CI on a cold cache; Vercel builds
  cold every time, so the same limit could fail a production deploy.
- **Runtime:** `compile_pdf` uses `vendor/tectonic/tectonic`, else
  `tectonic` on PATH. A read-only cache (a Vercel Function writes only under
  `/tmp`) is copied to `/tmp` once per process, and a binary that lost its
  execute bit runs from a copy there. Each copy is made under a staging name
  and renamed into place only when finished (`_copy_once`): a Function
  serves several renders at once on threads, and a plain "copy if missing"
  let a second render read a half-copied cache, and a copy that died partway
  failed every render on that instance until it recycled. **In the
  container none of that copying runs**: the Dockerfile gives `vendor/` to
  the user the API runs as, so the binary keeps its execute bit and the
  cache is written in place. Keep that `chown`, or every render pays the
  ~44 MB copy once per instance. No binary or cache raises
  `TectonicUnavailable`, and the endpoint answers 503. There is no fallback
  renderer.
- **Warming also compiles `sample.fonts()`**: a word in every size, shape
  and weight of Jake's preamble. The sample alone missed `\large` upright
  (`lmroman12-regular`), which a section heading selects only at some page
  breaks: Fit to One Page moved "Technical Skills" across one and every
  render of that resume answered 503 offline (KAN-218). After pulling this
  change, run `python3 scripts/fetch_tectonic.py` again (without
  `--check`) so a local cache gets the missing files.
- **Warming covers only what `sample.py` draws.** Latin Modern keeps each
  optical size in its own file, and a package fetches no font until a glyph is
  drawn: in the prototype a `\LARGE` name the warm-up missed failed offline.
  The warm-up goes through `jakes.py`, so it fetches what a real resume uses;
  a template change that adds a size or shape must show up in `sample.py`'s
  render too (GPA and coursework lines are there for that reason).
- **Tests:** `tests/test_resume_render.py` (seam 3: text, page count,
  missing characters, the unchanged content stream, and boxes checked
  against where pdfminer finds each line) and the render route's tests in
  `tests/test_built_resumes.py` skip their Tectonic tests when the cache is
  missing, unless `CI` is set (GitHub sets it; the job runs the
  script first), so in CI they fail instead.
- **Measured:** about 0.3 to 0.5 s a render on an M-series Mac, warm. The
  prototype measured 0.7 s in AWS Lambda's Python image, read-only and
  offline, in a 236 MB bundle (limit 500 MB). The container image rendered
  `sample.py` in 0.8 s, warm, under linux/amd64 emulation on an M-series Mac
  (2026-10-20). The editor's Render Again
  shows the round trip from the browser (KAN-209).

## Still open

- **The edit-to-PDF round trip on a Vercel preview, warm and cold** (KAN-209):
  read it from the editor's bar after a save ("Saved, 412 ms", KAN-218).
  The team chose the HTML copy of the page for typing (research option 4)
  as step 1, with this package's PDF still the only output, and is
  considering Typst for step 2 (`docs/live_page.md`, ADR 0002's status).

- **The first Vercel preview:** confirm the build log ends "tectonic and its
  cache ready" and that Generate then PDF downloads a resume from the bank
  page. If Vercel's build machine cannot reach GitHub or
  the Tectonic package host, the binary and cache come from a release asset
  in this repo (ADR 0002).
- **Each PDF download renders again** (about a second of function time).
  Sent resumes (KAN-208) store the file and reuse it for a repeat.
- **No Cyrillic or CJK.** The template's font covers accented Latin only.
