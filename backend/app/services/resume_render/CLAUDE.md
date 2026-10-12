# CLAUDE.md — resume rendering

How a resume becomes a PDF or Word file (KAN-176). Loaded on top of
`../../../CLAUDE.md` (the Python API).

```
__init__.py   render(resume, name, contacts, template, fmt) and TEMPLATES
blocks.py     what a template is made of: Name, Contact, Heading, EntryHeader,
              Bullet, SkillLine
jakes.py      Jake's Resume as blocks, and its date style ("Aug. 2018")
jakes.tex     Jake's LaTeX exactly as published (jakegut/resume, MIT, Jake
              Gutierrez; the Overleaf template), body left as a %%BODY%% marker
to_latex.py   blocks -> that LaTeX -> PDF with Tectonic. The PDF
to_docx.py    blocks -> .docx with python-docx, Times New Roman
to_pdf.py     blocks -> PDF with fpdf2 and CMU Serif: the fallback when TeX
              can't run. Measured to match the LaTeX closely, not exactly
fonts/        CMU Serif for to_pdf.py, SIL OFL 1.1 (OFL.txt)
```

## The PDF is Jake's own LaTeX, compiled

**It must look exactly like the Overleaf template** (asked for, 2026-10-12),
so it is not imitated: `jakes.tex` is the original preamble and commands,
byte for byte, and `to_latex.body()` writes each block as the command the
original uses (`\resumeSubheading`, `\resumeProjectHeading`, `\resumeItem`, the
skills itemize). One change, commented in the file: Tectonic is XeTeX, which
has no `\pdfgentounicode`, so the two pdfTeX-only lines are skipped under it.
They only map glyphs to Unicode, which XeTeX does by itself; the page is the same.
Checked against Overleaf's render with Jake's own sample content.

- **Everything typed is escaped** (`escape`, tested with `\input{/etc/passwd}`)
  and Tectonic runs `--untrusted`. Never put applicant text into the LaTeX any
  other way.
- **An empty itemize is a LaTeX error**, so `body()` opens a bullet list only
  when a bullet arrives. Keep that when adding a block type.
- **Tectonic** is one binary that fetches the TeX packages a document needs into
  a cache (~40 MB for this template). On a laptop: `brew install tectonic`; the
  first compile downloads, later ones take about a second.
- **Deployed:** `backend/vercel.json`'s `buildCommand` runs
  `scripts/fetch_tectonic.py` on every deploy. It downloads the pinned static
  Linux build (SHA-256 checked) and compiles a sample once into
  `backend/vendor/tectonic/` (binary + warm cache, ~71 MB, gitignored, built
  not committed). At runtime `to_latex.py` copies the cache to `/tmp` once per
  process (a function can write nowhere else), runs the binary from `/tmp`
  if its execute bit was lost, and compiles `--only-cached`, never touching
  the network.
- **How that was checked, without deploying (2026-10-12):** `vercel build`
  (CLI 59.23.2) with Root Directory `backend` and the repo's `.gitignore` ran
  the build command from `vercel.json` and bundled every file it made into the
  function, 236 MB in all (Python's limit is 500 MB). That exact bundle, run in
  AWS Lambda's `python:3.12` image read-only with no network and the binary's
  execute bit stripped, compiled Jake's sample in 0.7 s, cold or warm. **Not
  yet seen on Vercel itself:** that its build machine reaches GitHub and the
  Tectonic package host. If it can't, the build fails loudly rather than
  shipping without TeX. Look at the first preview's build log.
- **Fallback:** no binary, a failed compile or a timeout raises
  `LatexUnavailable`, and `render()` logs it at ERROR and draws with
  `to_pdf.py` instead, so a resume still downloads. In the log means the
  deployment isn't drawing the exact template.

## Rules

- **A template only lays out blocks.** Add one as a module with `KEY`,
  `TITLE` and `layout(resume, name, contacts) -> list[Block]`, list it in
  `TEMPLATES`, and give it a `.tex` if its PDF should be LaTeX.
- **ATS-safe by construction.** There is no image, table, column or text-box
  block. Don't add one. The DOCX right-aligns dates with a tab stop, not a
  table, for the same reason (macOS Quick Look ignores right tabs; Pages and
  Word honour them).
- **Read a LaTeX PDF in plain mode.** LaTeX places words rather than writing
  spaces, and kerns pairs like "AW", so pypdf's layout mode puts two spaces
  between words and splits "AWS" into "A WS". Plain mode reads it cleanly;
  Jake's own Overleaf PDF behaves the same, so it is no less ATS-readable.
  `tests/test_experience.py` reads it that way and runs `resume_parser` on it.
- **Name and contact line come from the profile at render time**, never from
  `parsed_json` and never from a model.
- **Page count:** from the compiled PDF (`Rendered.pages`); the builder warns
  past one page. A .docx is paginated by whatever opens it.

## Still open

- **The first real Vercel build** (above): confirm the build log shows
  "tectonic and its cache ready" and a resume's PDF Producer is `xdvipdfmx`.
- **No Cyrillic or CJK in the LaTeX PDF.** Latin Modern, the template's font,
  covers accented Latin only; "Иван" or "李" come out as missing glyphs. The
  fpdf2 fallback's CMU Serif has Cyrillic but not CJK either.
- The second and third templates.
