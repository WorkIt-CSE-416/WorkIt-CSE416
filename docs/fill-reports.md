# Fill reports and the fix brief (KAN-369)

WorkIt's extension fills job applications. When it fills a field wrong, the
student reports it from the panel (Report this on the row, or ⋯ → Report a
problem). The report is built for a developer's coding agent: an admin
exports it as a **fix brief**, a Markdown file that says what went wrong,
how to reproduce it, and where in the code to look, with the form attached
as a test fixture.

Where the code is: the extension builds and previews the report
(`autofiller_extension/src/content/report.js`, `src/background/report.js`,
`src/shared/report-parts.js`; `autofiller_extension/CLAUDE.md`, "Report a
problem"); the API stores it and writes the brief
(`backend/app/routers/fill_reports.py`, `backend/app/services/fill_brief.py`;
`backend/CLAUDE.md`, "Problem reports"); admins read it at
`/admin/fill-reports` (`frontend/src/app/admin/fill-reports/`).

## Getting a brief

An admin is an account whose email or id is on the API's `WORKIT_ADMINS`.

- **Web:** `/admin/fill-reports`, open a report: Copy Fix Brief, Download Fix
  Brief, Download Form Fixture, and its status (new / triaged / fixed) and note.
- **curl:** `curl -H "Authorization: Bearer $TOKEN" $API/admin/fill-reports/<id>/brief`
  (and `.../fixture` for the HTML; `GET /admin/fill-reports?job_system=greenhouse&status=new`
  lists them, newest first).
- **Script**, from `backend/`: `uv run python -m app.scripts.fill_report <id>`
  (or `--latest [--job-system greenhouse]`) writes `fill-reports/fill-report-<id8>/`:
  `brief.md`, `fill-report-<id8>.html` (the fixture), `question-set.json` (the
  fields as the engine's Question set) and `report.json`. It also names the
  engine commit the report's engine version was built from.

## What a report holds, and what it never does

It holds the page (job system, the posting's link with only its posting ids,
the engine's and extension's versions, browser, the engine's recognition of
the page), every field the fill touched (name, label, kind, options,
required, selector, visible, the Plan's source, the planned answer's shape,
status, reason, read-back, error, whether the student edited it or marked it
wrong), the fill's timeline (with stacks), the form's HTML with values out,
and the student's note.

**It never holds a value**: no answer, nothing the student typed or picked,
no name, email, phone, link or address. The extension takes them out before
the student's preview, the background again with the profile's values, and
the API scrubs emails and phones a third time. In their place:

| Marker | Stands for |
|---|---|
| `«planned»` | the answer WorkIt planned for this field |
| `«shown»` | what the page showed in the field (or a choice it shows as text) |
| `«redacted»` | other personal text, or a value a reason quoted |
| `«email»`, `«phone»`, `«file»` | something that looked like one |

A **shape** says what kind of answer without the answer: `text:12` (12
characters of text), `option` (one option), `options:3`, `file`, `none`.

## The brief's sections

`backend/tests/fixtures/fill_brief.md` is a whole example, kept equal to the
code's output by a test.

1. **Title**: `# Fill report <id8>: <job system>, <the first field at issue and what happened>`.
2. **Summary**: the student's note, the fields at issue (those they marked
   wrong, else those that failed or that they edited), the job system and
   the engine's recognition, what opened the report, its status, the admin
   note.
3. **Reproduce**: the posting's link, which field and its selector, and the
   fixture to load offline. Never press the employer's Submit.
4. **Expected vs actual**, per field at issue: the planned answer's shape and
   source; the status, error, read-back and what the page shows (a shape);
   the fill's reason, values out; the field's kind, selector, visibility and
   options.
5. **Fields**: a table of every field.
6. **Timeline**: each step `t` ms after the plan, then any stack.
7. **Where to look**: the engine's Filler for the job system
   (`autofiller_extension/fill-engine/src/<system>.ts`), the file for the
   error's kind (`readback.ts` for Readback, `planner.ts` for NoAnswer,
   `page.ts` for FillError, `jobs.ts` for NoForm, `steps.ts` for Handoff),
   the extension's fill loop, and the engine version (and commit).
8. **Fixture**: the HTML file's name and where it goes in the engine:
   `autofiller_extension/fill-engine/test/fixtures/forms/<system>-report-<id8>/`
   with `question-set.json`. Write the failing spec against it first.
9. **Environment**: extension, engine, browser, frame, page address, time.

## For the agent fixing it

- The fixture has no values: fill it with a test profile, as the engine's
  other fixtures do. Its structure, ids, names, classes, labels and options
  are the employer's form as the student's page had it after the fill.
- Read-back `differs` with `«planned»` / `«shown»` in the reason means the
  page shows something other than what was typed: look at how the Filler
  types and commits that kind, and at `readback.ts`.
- `edited: true` with no error means WorkIt's answer read back fine but the
  student changed it: the Plan (the answer chosen) is the suspect, not the
  Filler.
- A fix lands in the engine repo (its own PR) and the WorkIt submodule pin.
  Mark the report fixed with the commit in its note.
