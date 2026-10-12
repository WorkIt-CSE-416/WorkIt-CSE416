# CLAUDE.md — an applicant's own LaTeX

A resume the applicant wrote in LaTeX themselves (KAN-176): pasted in,
edited by its words, tailored by rewording its bullets, and compiled exactly
as written. Loaded on top of `../../../CLAUDE.md` (the Python API). The
routes are `../../routers/latex_resumes.py`; the editor is
`frontend/src/app/(seeker)/resume-builder/latex/`.

```
__init__.py   compile_source (the only way this LaTeX reaches Tectonic) and
              read_back (PDF text -> the resume parser -> parsed_json)
tokens.py     the source as tokens with byte spans
fields.py     where the words are: heading, bullet and text fields
inline.py     a field's LaTeX as plain text (**bold**, *italic*) and back
splice.py     edits by field id: change words, add or remove a bullet
safety.py     the gate before Tectonic; nothing compiles without it
packages.txt  the packages and classes a pasted resume may load
```

## The model: structure is locked, words are fields

`fields()` reads the document body into **fields**, each a byte span of the
source: a `\section` title (`heading`), the argument of a one-argument macro
whose definition makes an `\item` or the text after a plain `\item`
(`bullet`), and any other run of words (`text`: a name, a company, a date).
Everything else (the preamble, commands, lengths, link targets, environments
and their arguments) is structure.

- **Never write into the source outside a field's span.** Every edit, typed
  or from the model, goes through `splice.apply`, which replaces only its
  own field's characters (or, to add or remove a bullet, copies or cuts that
  bullet's whole construct). A source with no edits comes back byte for
  byte; `tests/test_latex_source.py` diffs both fixtures to hold this.
- **No template is named in code.** Bullet macros are found from the
  preamble (`macros()`): Jake's `\resumeItem` is a bullet because its
  `\newcommand` body makes an `\item` and it takes one argument. A
  four-argument `\resumeSubheading` also makes an `\item`, so its arguments
  are text fields, not bullets.
- **A skills list is never a bullet**, so tailoring never rewords one: an
  item in a section whose title says skills, tools, languages, coursework
  and the like, or a line that is a comma list of short items, is `text`.
- **A field plain text can't say is read-only** (`editable` False, its raw
  LaTeX as `text`): a `\href` inside a bullet, a command `inline.py`
  doesn't know. The Words view shows it with "Edit in Source"; it is never
  guessed at.
- **Ids are positions** ("f0", "f1", …), so every request carries the
  source it was made against, and the server keeps nothing between calls.
  An edit naming a field the source doesn't have is "reload and try again".
- **Removing an entry's last bullet is refused**: an empty `itemize` is a
  LaTeX error (`resume_render/CLAUDE.md` has the same rule).

## The safety gate — `safety.py`

**Tectonic's `--untrusted` does not stop file reads** (tried 2026-10-12,
Tectonic 0.17): `\input{/etc/hosts}` compiled, and `\openin` + `\read`
printed the file's first line into the PDF. On a server,
`/proc/<pid>/environ` holds `DATABASE_URL` and `SUPABASE_SERVICE_KEY`. Jake's
template path was safe only because every typed character is escaped; an
applicant's own LaTeX is not escaped, so `prepare()` runs before every
compile and refuses:

- **anything that opens a file by name**: any command whose name contains
  `input` (`\input`, `\@@input`, `\InputIfFileExists`, `\lstinputlisting`,
  `\verbatiminput`, …), `\include`, `\openin`/`\read`, `\includegraphics`,
  `\font`, the pdfTeX file primitives and every `\XeTeX…` primitive;
- **anything that writes a file or runs one**: `\write`, `\openout`,
  `\immediate`, `\directlua`, `\special`, the `filecontents` environment;
- **anything that could build those from harmless-looking text**:
  `\csname`, `\catcode`, `\scantokens`, and `^^` character codes (`^^5c` is
  a backslash before TeX reads any command, so that check runs on the raw
  text, comments blanked, never token by token);
- **a package or class not in `packages.txt`**.

The tokenizer reads `@` as a letter even without `\makeatletter`, so
`\@@input` is the one command it is. The one `\input` allowed is
`\input{glyphtounicode}`, which Jake's template as published runs; it and
`\pdfgentounicode=1`, both pdfTeX-only, are wrapped in
`\ifdefined\pdfgentounicode … \fi` on the same line, so error line numbers
still match what was pasted. Comments are skipped.

**The second wall:** every compile gets a scrubbed environment
(`resume_render/to_latex.py`, `_env`): `PATH`, `HOME` and the cache
locations, never the API's own. That alone would not stop
`/proc/<parent>/environ`, which is why the gate comes first. A new ban goes
in `BANNED` with a test line in `test_anything_that_reads_or_writes_a_file_is_refused`.

## Packages — `packages.txt`

One list, two readers: `safety.py` allows exactly these, and
`scripts/fetch_tectonic.py` compiles one document per entry into the
deployed cache, which compiles `--only-cached`. A package missing from the
cache fails there even though a laptop, online, fetches it silently. **Add a
name here and both follow**; the warm marker is named for the file's hash,
so the next build warms again.

Each warm document draws text in every size from `\tiny` to `\Huge`, every
shape, and under every point size its class offers (10/11/12pt). Latin
Modern keeps each optical size in a file of its own, and a package fetches
no font until a glyph is drawn: a warm body with one size missed
`lmroman17`, which `\LARGE` needs, and the second fixture failed offline
(2026-10-12). Measured: about 90 s to warm from nothing, 50 MB of cache (the
template alone was about 40).

## Compiling and reading back

`compile_source` is `compile_tex(prepare(source))` with a 30 s timeout
(Jake's has 60: an applicant's document could loop). `LatexError` carries
TeX's first complaint and its line ("Line 12: Undefined control sequence");
the editor offers to show that line in Source. **There is no fpdf fallback**
for an applicant's own LaTeX: a PDF in some other layout would not be theirs.

`parsed_json` is the compiled PDF's text (plain mode, as
`resume_render/CLAUDE.md` says to read a LaTeX PDF) through
`utils/resume_parser.py`, so matching, Scout and the profile read a LaTeX
resume like any other. It is refreshed on every save.

## Tailoring

Only `bullet` fields that are `editable` are ranked against the posting
(`services/matching/overlap.py`) and, the top `tailoring.MAX_REWRITES` with a
score above zero, sent to `workit_scout.builder.tailor_bullets`. The model
sees the words without their `**` marks (`unmarked`); `remarked` puts bold
and italic back wherever the marked words survive verbatim. Nothing is
reordered: the layout is the applicant's. The accepted rewordings are saved
as a new resume (edit ops on the source the tailor call returned, with
`target_job_id`); the original is never changed.

## Still open

- **A compile per pause costs about a second of a function.** The preview
  waits 1.2 s after typing stops and the API caps compiles at 600 a day per
  account (`DAILY_COMPILES`, in-process like Scout's caps). Watch the
  function's duration once real applicants use it.
- **Classes beyond `article`/`extarticle`** (moderncv, Awesome-CV's own
  `.cls`): a custom class is a second file, which a paste can't carry.
- **Images** stay refused (`\includegraphics` reads a file by path).
- **The Words view shows `**` marks as typed**, not as bold text inside the
  field; the preview shows the real formatting.
