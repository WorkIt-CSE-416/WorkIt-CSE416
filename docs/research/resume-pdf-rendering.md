# Rendering an ATS-safe resume PDF from the Python API on Vercel

Research for KAN-184 (map: KAN-181, resume builder redesign). Written
2026-10-12.

## Answer

**Use Typst, through the `typst` Python package, inside the FastAPI
function. Keep python-docx for the Word file.** It adds about 77 MB to the
bundle, against about 236 MB for the Tectonic prototype. It needs no system
libraries and no network at build or run time. It renders in about 0.1 to
0.5 s. Its PDFs are tagged by default, and in a local test the text came out
in the right order with ligatures intact. The cost: Jake's template must be
rewritten as a Typst template. It can be made to look very close to Jake's
Resume, but it is not Jake's LaTeX compiled byte for byte.

| Option | Bundle added | Runs on Vercel Python as-is | Render time | Match to Jake's | Text extraction |
| --- | --- | --- | --- | --- | --- |
| LaTeX via Tectonic (the KAN-176 prototype) | ~71 MB binary + cache; 236 MB bundle in all | Yes, but the build has to download the binary and TeX packages | ~0.7 s | Exact (same `.tex`) | Good in plain mode; layout mode splits kerned words |
| **Typst (`typst` on PyPI)** | **~77 MB unpacked (34 MB wheel)** | **Yes, a manylinux wheel** | **~0.45 s first, ~0.11 s after** | **Close, re-implemented** | **Good; tagged PDF by default** |
| WeasyPrint (HTML to PDF) | Small wheel, plus Pango, HarfBuzz and fontconfig shared libraries you must ship yourself | No: the libraries are not in the function runtime | Not measured | Close, in CSS | Good; tags with `pdf_tags` |
| `@react-pdf/renderer` in Next.js | A few MB, in the Node function | Moves rendering out of the API | Not measured | Close, in JSX styles | Known ligature copy bug with some fonts; no tagging |

## The constraint: Vercel Function size

- A Vercel Function may be 250 MB uncompressed, or **500 MB for Python**.
  "Large functions" (beta) go to 5 GB.
  [Vercel: Functions limits](https://vercel.com/docs/functions/limitations)
- Python functions bundle every reachable project file. "There is no automatic
  tree-shaking for Python." `excludeFiles` in `vercel.json` trims it.
  [Vercel: Python runtime](https://vercel.com/docs/functions/runtimes/python)
- The build image is Amazon Linux 2023. `dnf install` works in the install
  command, but only for the build container.
  [Vercel: Build image](https://vercel.com/docs/builds/build-image)
- The response body limit is 4.5 MB. A one-page resume PDF is far below it
  (the Typst test below made 29 KB).
  [Vercel: Functions limits](https://vercel.com/docs/functions/limitations)

## Option 1: LaTeX via Tectonic (the KAN-176 prototype)

The facts come from `backend/app/services/resume_render/CLAUDE.md` on branch
`origin/KAN-176-resume-builder-plan`:

- The build downloads a pinned static Tectonic binary, then compiles a sample
  once to fill the package cache: ~71 MB. A local `vercel build` bundled
  **236 MB** in all. That fits under 500 MB, but it is about half the budget.
- Render time was 0.7 s, cold or warm, in AWS Lambda's `python:3.12` image.
- At run time the cache is copied to `/tmp` once per process, because the
  bundle is read-only.
- **Risks the prototype recorded:** it was never built on Vercel itself, and
  the build must reach GitHub and the Tectonic package host. The fonts (Latin
  Modern) cover accented Latin only, not Cyrillic or CJK.
- **Match:** exact. It compiles Jake's own `.tex`
  ([jakegut/resume](https://github.com/jakegut/resume), MIT).
- **Text extraction:** LaTeX places words instead of writing spaces, and it
  kerns pairs such as "AW". pypdf's layout mode put two spaces between words
  and split "AWS" into "A WS"; plain mode read it cleanly. The prototype says
  Jake's own Overleaf PDF behaves the same.

**Verdict:** It is the only option that matches exactly, but the size is the
problem, and so are the network at build time and the moving parts (a binary,
a cache copy, a fallback renderer).

## Option 2: Typst via the `typst` Python package (recommended)

- **Package:** `typst` 0.15.0 (2026-06-16) binds the Typst compiler (Rust).
  It ships a manylinux x86-64 abi3 wheel for CPython 3.8 and later, so it
  installs from `pyproject.toml` with no build step.
  [PyPI: typst](https://pypi.org/project/typst/),
  [messense/typst-py](https://github.com/messense/typst-py)
- **Size, measured:** the wheel is 34.2 MB. Unpacked it is **77 MB**, nearly
  all one `_typst.abi3.so` (80 MB). The binary has Typst's default fonts built
  in (New Computer Modern, Libertinus Serif, DejaVu Sans Mono): their names are
  in its strings, and the test below rendered NewCM10 with no font files
  supplied. That is about a third of the Tectonic bundle, and nothing is
  fetched at build time.
- **API:** `typst.compile(source_bytes, sys_inputs={"data": json})` returns
  the PDF as bytes. A template reads the resume with
  `json(bytes(sys.inputs.data))`. A `typst.Compiler` object can be reused.
  [PyPI: typst](https://pypi.org/project/typst/)
- **No network at run time** as long as the template imports no `@preview`
  package. Those packages are downloaded into a cache
  (`package_cache_path`). Keep the template self-contained, or vendor any
  package with `package_path`.
  [messense/typst-py](https://github.com/messense/typst-py)
- **Tagged PDF by default** since Typst 0.14. Tags give the reading order and
  structure. PDF/UA-1 is opt-in.
  [Typst 0.14 changelog](https://typst.app/docs/changelog/0.14.0),
  [Typst blog: accessible PDF](https://typst.app/blog/2025/accessible-pdf)
- **Local test (Apple M4 Pro, 2026-10-12).** A Jake-style one-page section in
  New Computer Modern, with data passed through `sys_inputs`:
  - The first `import typst` took 1.3 s from a cold disk and 0.014 s after.
    The first compile took 0.45 to 0.57 s (font loading); later compiles took
    about 0.11 to 0.13 s.
  - pypdf and pdfminer.six both extracted the text in reading order. Ligature
    words ("offloaded", "fine-grained", "office", "affixed", "staff") came out
    as plain letters. Small-caps headings came out as "Experience". The
    document has a `StructTreeRoot`, so it is tagged.
  - One quirk: pypdf joined the two cells of a right-aligned date row
    ("Present" + "Undergraduate") with no space. pdfminer.six split them into
    separate lines. Jake's LaTeX uses a tabular for the same row, so the
    LaTeX PDF has the same layout. Test that row with the parser the team
    uses.
  - These timings are from a laptop. Vercel's 1 vCPU will be slower. Measure
    on a preview deployment.
- **Match to Jake's Resume:** close but not exact. Typst has the same font
  (New Computer Modern is the OpenType form of Computer Modern), small caps,
  rules, and `grid` for the right-aligned dates. Its line breaking and
  spacing are not TeX's, so a side-by-side check against Overleaf is needed.
  Typst Universe has templates that cite Jake's Resume as inspiration, for
  example `basic-resume` (Unlicense) and `simple-technical-resume`. They are
  starting points, not exact ports.
  [basic-resume](https://typst.app/universe/package/basic-resume),
  [simple-technical-resume](https://www.typst.app/universe/package/simple-technical-resume)
- **Safety:** pass applicant text as data (`sys_inputs`), never by pasting it
  into Typst markup. That way no escaping is needed, which the LaTeX path
  depended on.

## Option 3: WeasyPrint (HTML and CSS to PDF)

- WeasyPrint needs Python 3.10+ and **Pango 1.44+**, plus HarfBuzz and
  fontconfig, as system libraries.
  [WeasyPrint: First steps](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html)
- The Vercel Python runtime does not include them. A `dnf install` in the
  install command changes only the build container
  ([Vercel: Build image](https://vercel.com/docs/builds/build-image)). So the
  `.so` files would have to be copied into the project and found at run time.
  This is an inference. WeasyPrint points serverless users to a community AWS
  Lambda layer (Kotify), which shows that it does not work out of the box.
- It supports ligatures (`font-variant-ligatures`) and tagged output
  (`pdf_tags`, `pdf/ua-1`). The docs warn that PDF/UA output is "not
  guaranteed to be valid".
  [WeasyPrint: API reference](https://doc.courtbouillon.org/weasyprint/stable/api_reference.html)

**Verdict:** It gives good PDFs, but shipping native libraries by hand brings
back the same kind of build fragility as Tectonic.

## Option 4: `@react-pdf/renderer` in the Next.js app

- `@react-pdf/renderer` 4.9.0 is 320 KB unpacked, on top of pdfkit and its
  own layout packages: a few MB in all (`npm view`). It can run in a Next
  route handler.
- **Text extraction risk:** in issue #915, users reported that text copied
  from react-pdf output was wrong wherever an "fi" ligature appeared (Lato,
  Roboto, Inter). The workaround was to re-export the font through
  FontForge or BirdFont. The issue was closed in 2024 without a code fix in
  the thread.
  [diegomura/react-pdf#915](https://github.com/diegomura/react-pdf/issues/915)
  An open issue reports a wrong Unicode text layer for Arabic.
  [#3533](https://github.com/diegomura/react-pdf/issues/3533)
- It does not produce tagged PDFs (nothing in its docs or issues says it
  does).
- **Architecture cost:** rendering moves from the API to the Next app. The
  root `CLAUDE.md` keeps data and logic behind FastAPI. The API would also
  lose its own page count for the over-one-page warning.

**Verdict:** It is small, but it risks ATS text errors and splits the
renderer from the API.

## Word (.docx)

None of the four writes .docx. Keep **python-docx** (1.2.0, a 253 KB pure
Python wheel), as the prototype did. Use one column, real text, and a right
tab stop for dates, not a table.

## What makes a resume parse well in hiring systems

Primary sources (the vendors' own help pages):

- **Greenhouse** accepts .doc, .docx, .pdf, .rtf and .txt, up to 100 MB. The
  article does not describe what makes parsing fail.
  [Greenhouse: Supported formats](https://support.greenhouse.io/hc/en-us/articles/360052218132)
- **Workday:** "Resume parsing results can vary based on resume format and
  order of words. For best results, use resumes that don't have images or
  image-based styles." Workday does not auto-fill Skills or Languages from a
  resume.
  [Workday admin guide: resume parsing](https://doc.workday.com/admin-guide/en-us/human-capital-management/recruiting/candidates/set-up-prospects-and-candidates/hdc1552497830785.html)
- **Lever** parses Word, PDF, RTF, WordPerfect, HTML and ODF, but not images
  (JPG, PNG). Its test: "if you cannot highlight text, the document is likely
  not parseable." (The page did not load for a full read. These quotes are
  from its search snippet.)
  [Lever: Understanding Resume Parsing](https://help.lever.co/hc/en-us/articles/20087345054749)

Most advice past this point comes from resume-tool vendors and blogs, not the
hiring systems, so treat it as consensus, not fact: use one column, standard
section headings, no tables, text boxes, headers or footers, and no
graphics. Some blogs claim a 2.5 MB Greenhouse parse limit, which Greenhouse
does not document.

What follows for us, all within our control:

1. **Real, selectable text with a correct Unicode map.** No images of text.
   Ligatures must map back to their letters (Typst passed this in the test;
   react-pdf has a known failure).
2. **Content order equals reading order.** One column. Tagged PDF helps.
3. **No tables, text boxes, columns, headers or footers** for content. The
   prototype's "ATS-safe by construction" rule (no such block types) carries
   over.
4. **Standard fonts, embedded.** Typst embeds subsets of New Computer Modern.
5. **Offer .docx as well**, since every system above takes it.

## Open questions

- Measure Typst cold start and render time on a Vercel preview at 1 vCPU.
- Build Jake's template in Typst and compare it side by side with Overleaf.
  Decide whether "very close" is acceptable, since the KAN-176 prototype was
  told to match "exactly" (2026-10-12).
- Choose a font for Cyrillic and CJK names. New Computer Modern covers
  Cyrillic and Greek, but not CJK. A Noto CJK fallback adds size.
- Run the output through the team's `resume_parser` test, as the prototype
  did.
