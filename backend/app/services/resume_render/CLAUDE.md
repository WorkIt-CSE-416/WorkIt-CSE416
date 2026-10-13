# CLAUDE.md — resume rendering

How a built resume becomes a PDF: Jake's Resume's own LaTeX, compiled by
Tectonic inside the API's Vercel Function (ADR 0002), and a plain Word file.
Loaded on top of `../../../CLAUDE.md`. KAN-204 proved Tectonic with a fixed
resume; KAN-207 renders the bank and retired the proof endpoint.

## The interface

- **`render(view, identity, template)` is the one way to a PDF.** It takes a
  built resume view (`../resume_view.py`, the shape every resume feature
  reads), the profile's `Identity` and a template id, and returns
  `Rendered(pdf, page_count, missing_characters)`. An unknown template id is
  a `ValueError`. The editor overlay (KAN-209) adds the boxes to `Rendered`;
  add fields there, never a second render function.
- **A template is a function from the view and identity to a LaTeX body**
  (`jakes.py`), registered by its stable id in `render()`. The id is stored
  on `built_resumes.template`, so never rename one.
- **`fields.py` is how a field reads as text** (dates, GPA, headings, skill
  groups), shared by the PDF and the Word file so the two never disagree.
  Change wording there, not in a layout.
- **The Word file is `word.py`'s one plain layout**, Letter only. It is not a
  copy of Jake's look and has no template id.
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
  put applicant text into the LaTeX any other way, URLs included.
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
  (`backend/vercel.json`) before anything is installed.
- **What it builds:** `backend/vendor/tectonic/` (gitignored): the binary on
  Linux x86_64, and a package cache warmed by compiling `sample.py` (Jake's
  sample content as a view, through the real `jakes.py`) once online
  (~44 MB). On a Mac it uses `brew install tectonic` from PATH and
  warms the same cache. Run `python3 scripts/fetch_tectonic.py` from
  `backend/` once; `--check` compiles offline from the cache.
- **Runtime:** `compile_pdf` uses `vendor/tectonic/tectonic`, else
  `tectonic` on PATH. A read-only cache (a Vercel Function writes only under
  `/tmp`) is copied to `/tmp` once per process, and a binary that lost its
  execute bit runs from a copy there. No binary or cache raises
  `TectonicUnavailable`, and the endpoint answers 503. There is no fallback
  renderer.
- **Warming covers only what `sample.py` draws.** Latin Modern keeps each
  optical size in its own file, and a package fetches no font until a glyph is
  drawn: in the prototype a `\LARGE` name the warm-up missed failed offline.
  The warm-up goes through `jakes.py`, so it fetches what a real resume uses;
  a template change that adds a size or shape must show up in `sample.py`'s
  render too (GPA and coursework lines are there for that reason).
- **Tests:** `tests/test_resume_render.py` (seam 3: text, page count,
  missing characters) and the render route's tests in
  `tests/test_built_resumes.py` skip their Tectonic tests when the cache is
  missing, unless `CI` is set (GitHub sets it; the job runs the
  script first), so in CI they fail instead.
- **Measured:** about 0.3 to 0.5 s a render on an M-series Mac, warm. The
  prototype measured 0.7 s in AWS Lambda's Python image, read-only and
  offline, in a 236 MB bundle (limit 500 MB). The proof endpoint's
  `Server-Timing` header went with it; KAN-209 measures the real round trip.

## Still open

- **The first Vercel preview:** confirm the build log ends "tectonic and its
  cache ready" and that Generate then PDF downloads a resume from the bank
  page. If Vercel's build machine cannot reach GitHub or
  the Tectonic package host, the binary and cache come from a release asset
  in this repo (ADR 0002).
- **Each PDF download renders again** (about a second of function time).
  Sent resumes (KAN-208) store the file and reuse it for a repeat.
- **No Cyrillic or CJK.** The template's font covers accented Latin only.
