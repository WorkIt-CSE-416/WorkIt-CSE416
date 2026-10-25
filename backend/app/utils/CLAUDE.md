# CLAUDE.md -- utils

Utility modules that are not models, routers, or config. Imported by routers
and services, never by models.

## resume_parser.py -- heuristic resume parser

Pure-function pipeline that turns extracted resume text into a `ParsedResume`
Pydantic object (defined in `app/models/dto.py`). No I/O, no LLM -- regex and
string splitting only. Single external dependency: `ftfy` for mojibake repair.

### Pipeline

```
raw_text -> _clean_text -> _split_sections -> per-section parser -> ParsedResume
```

1. **`_clean_text`** -- `ftfy.fix_text`, normalize bullet chars to `*`, collapse
   blank lines.
2. **`_split_sections`** -- `SECTION_RE` matches standalone header lines
   (Education, Experience, Skills, Projects, Certifications, Leadership &
   Activities, Awards, etc.). Text between consecutive headers becomes one
   section. `_normalize_header` checks the leadership words (Leadership,
   Activities, Extracurricular, Involvement) and the award words (Award,
   Honor) before "experience", so "Leadership Experience" never lands in the
   job section. Returns `{}` when no
   headers are found, which makes `parse_resume` return `None`.
3. **Per-section parsers** -- each returns a list of the matching Pydantic model
   or `[]` on empty input.

### Entry splitting (`_split_entries`)

Shared by education, experience, and projects. A date-bearing non-bullet line
is an **anchor**; non-date lines immediately above it are that entry's header
(company name, institution). The anchor rules:

- Full date ranges (`DATE_RANGE_RE`) and `Expected` dates are always anchors.
- Bare dates (`BARE_DATE_RE`, e.g. "May 2025" at end-of-line) are anchors
  **only if** `_is_header_line` returns True (starts uppercase). This prevents
  PDF continuation lines like "completing the rollout by May 2025" from
  splitting an entry in two.

### Experience layout detection

Resumes put company, title, dates, and location in different orders.
`_parse_experience` detects layout per-entry using these signals:

| Signal | Layout |
|--------|--------|
| Date line is bare (only dates + location) | Title / Company / Dates above |
| Pipe in the header line | `Title \| Company` or `Company \| Title` (ROLE_KEYWORDS decides) |
| ROLE_KEYWORDS on the line after the date | Company+Date / Title+Location / bullets |
| None of the above | Company / Title+Date / bullets (default) |

`ROLE_KEYWORDS` is the set of common job title words (Engineer, Manager, Intern,
etc.) used to tell title from company when both are plain text.

### Location detection (`_extract_location`)

Matches `City, ST` at the end of a line, where ST is a US state/territory code
from `US_STATES`. Two passes: first looks for a multi-space gap (PDF extraction
preserves these), then falls back to a 1-2 word city regex. "Remote" or "Hybrid" after a multi-space gap
is the location too ("Engineer| Ruby, Rails  Remote").

Known ceilings:
- US-only (no international locations)
- Max 2-word city names -- misses "Salt Lake City", "New York City"
- No apostrophes in city names -- misses "O'Fallon"

### Bullet joining (`_bullets`)

Handles two cases:
- **Marked bullets** (`•`, `-`, etc.) -- strips the marker, joins PDF
  continuation lines (no marker) back onto the previous bullet. A line before
  the first marker becomes its own item rather than being dropped.
  A project's line that is only its link is left out first: it is the
  project's `url`, and once such lines were kept it became a bullet too.
- **No markers** (PDF drew bullets as shapes) -- a line that does not start
  lowercase, after a line ending in a period, starts a new item.

A hyphen before a digit is a minus sign, not a marker. "-20% churn" read as a
marker made the section look marked, and every unmarked line above it was
dropped (KAN-224). A hyphen glued to a word ("-Built X") is still a marker.

### Leadership & Activities and Awards (KAN-211)

Leadership & Activities reuses `_parse_experience`: a club role has the same
organization, role, dates and bullets as a job, so `ParsedResume.leadership`
holds `Experience` objects. Awards are one per line (`_parse_awards`):
"Award – Issuer  Date" or "Award | Issuer | Date", issuer and date optional. A
year alone at the end of the line ("Merit Scholarship  2024") becomes January
of that year.

### Date parsing

Three patterns, checked in priority order:
1. `Expected Month Year` -- education graduation dates, also "Expected
   Graduation: May 2027" and "Anticipated Grad Date May 2027". Without the
   longer forms, "Expected Graduation:" stayed in the school's name.
2. `Month Year - Month Year` (or Present/Current/Now) -- date ranges
3. `Month Year` alone at end of line -- bare date, treated as end date

Day is always 1 (resumes don't specify days). "Present", "Current", "Now" store
as `None` (null end date).

### Education fields

- The degree keeps its full name ("Bachelor of Science", not "Bachelor").
- The field of study ends at a PDF gap or "GPA": "Bachelor of Science,
  Computer Science  GPA: 3.81/4.00" gives "Computer Science".
- `GPA_RE` reads the scale too: "3.81/4.00" fills `Education.gpa_scale`.
- A plain line after a coursework or bullet line that ends in a comma, or that
  starts lowercase, is that line wrapped by the PDF and joins it. Before
  this, the second line of a two-line coursework list was dropped.

### Projects and skills

- **Undated projects** give `_split_entries` no date to split on, so
  `_split_undated_projects` splits them: where bullets carry markers, a plain
  line is a new project when it holds a "|" or opens a new sentence after a
  finished bullet. Jake's Resume from LaTeX lists projects this way; before
  this, three projects merged into one.
- **A project's tools** follow the last "|" as a comma list ("Robot | C++,
  Python") or sit in parentheses with a comma; they go to
  `Project.technologies`, and import adds those missing from the skills
  section as ungrouped skills. One phrase after the bar is a subtitle and
  stays in the name ("WorkIt | Full Stack Recruiting Platform"); with a
  subtitle and a list ("Robot | Club| C++, Go") the name keeps both phrases
  and only the list is tools (`split_tools`). Before, the first bar split,
  and "Club| C++" became a skill.
- **A role's tools** work the same way: "Software Engineer Intern| C++, Go"
  keeps only the role as the title, and the list goes to
  `Experience.technologies` (jobs and leadership), then to ungrouped skills.
  Before, the whole tail stayed in the title.
- **Skills a reading keeps** (`bank_import.skill_pairs`, for the parser's and
  the model's readings alike) leave out what is not a skill (`not_a_skill`):
  a name still holding a "|", a qualification (degree, years, clearance), or
  a vague phrase ending in "tools" or "skills" ("AI tools").
- **A skills line that ends in a comma** continues on the next line, which
  keeps its group. Before this, a wrapped "Concepts:" list lost its group.

### Clean-up

- A run of spaces inside a bullet is a PDF gap (after a bold phrase), not
  wording, and becomes one space.
- `∼` (U+223C, which resume fonts lack) becomes `~`, so the rendered PDF has
  no missing glyph.

### Known ceilings

- Section headers must be standalone lines. Inline bold headers won't split.
- Entry boundaries depend on dates. A dateless entry merges into the previous,
  except in Projects (above).
- `_is_header_line` requires uppercase start -- lowercase company names (eBay,
  npm) are not recognized as headers when they're the 2nd+ entry.
- Single-column assumption. Multi-column PDFs may interleave columns.
- No OCR. Scanned-image PDFs produce no text, so nothing to parse.

### The model upgrade path (KAN-222)

The model is the parser's upgrade path, and it is built: import's model
parsing (`app/services/bank_import.py`, `read_with_model`) sends the stored
`raw_text` and the `ModelReading` schema through `LLM.complete_json`, the
provider seam that removes identity data from every message first. It runs
only when the student asks ("Read It With AI", Import Again's
`read_with_ai: true`), never as a fallback (ADR 0003). Rules:

- **This parser stays first and stays free.** Every upload and every plain
  Import Again runs it alone; the model costs a parsing use (cap 1 a day,
  10% of the pool), so it waits for the student's click. A resume that parses wrong still becomes a fixture
  here before the parser changes; the model is not a reason to stop fixing it.
- **The model's reading is checked, never trusted.** `ModelReading` is loose so
  one odd field does not throw away the whole reply (a `null` list, which
  Groq's gpt-oss sends for a job's coursework, is an empty one); each entry then passes
  the entry schema on its own (`model_drafts`), which clips text, drops an
  entry with no title and drops dates that do not fit together. A reply that
  is not JSON or misses the shape raises `InvalidReply` and counts no use.
- **It never sees links.** URLs reach the model as `[link]`, so the model
  schema has no `link` field and a field holding a placeholder is emptied.
  Project links come only from this parser.
- Either reading goes straight into the experience bank through
  `services/bank.py`'s `import_upload`; nothing keeps the reading itself
  (`resumes.parsed_json` was dropped in KAN-240).

## Text extraction (lives in `app/routers/resumes.py`, not here)

Extraction is in the router because it runs on the uploaded file bytes before
the parser. Two extractors:

- **`_extract_pdf_text`** -- pypdf with two modes: layout (glyph positions) and
  plain (content-stream order). Picks the winner by comparing section header
  counts, with a median-words-per-line guard against fragmented output.
- **`_extract_docx_text`** -- python-docx, iterating paragraphs and tables in
  document order. Restores bullet markers that Word stores as numbering
  properties. Deduplicates merged table cells.

Both return `str | None`. Errors are logged and return `None` -- extraction
failure does not block the upload.

## Tests

`tests/test_resume_parser.py` with fixtures in `tests/fixtures/*.txt`. Each
fixture is the extracted text of a real resume layout. The heuristics
interact -- a fix for one layout has broken another more than once. When a new
resume parses wrong, add it as a fixture with expected output before touching
the parser.
