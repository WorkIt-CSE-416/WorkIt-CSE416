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
   (Education, Experience, Skills, Projects, Certifications, etc.). Text
   between consecutive headers becomes one section. Returns `{}` when no
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
preserves these), then falls back to a 1-2 word city regex.

Known ceilings:
- US-only (no international locations)
- Max 2-word city names -- misses "Salt Lake City", "New York City"
- No apostrophes in city names -- misses "O'Fallon"

### Bullet joining (`_bullets`)

Handles two cases:
- **Marked bullets** (`*`, `-`, etc.) -- strips the marker, joins PDF
  continuation lines (lowercase start, no marker) back onto the previous bullet.
- **No markers** (PDF drew bullets as shapes) -- a line starting a new sentence
  after a period starts a new item.

### Date parsing

Three patterns, checked in priority order:
1. `Expected Month Year` -- education graduation dates
2. `Month Year - Month Year` (or Present/Current/Now) -- date ranges
3. `Month Year` alone at end of line -- bare date, treated as end date

Day is always 1 (resumes don't specify days). "Present", "Current", "Now" store
as `None` (null end date).

### Known ceilings

- Section headers must be standalone lines. Inline bold headers won't split.
- Entry boundaries depend on dates. A dateless entry merges into the previous.
- `_is_header_line` requires uppercase start -- lowercase company names (eBay,
  npm) are not recognized as headers when they're the 2nd+ entry.
- Single-column assumption. Multi-column PDFs may interleave columns.
- No OCR. Scanned-image PDFs produce no text, so nothing to parse.

Upgrade path for any of these: LLM structured output (send raw_text + the
Pydantic schema to Claude/OpenAI).

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
