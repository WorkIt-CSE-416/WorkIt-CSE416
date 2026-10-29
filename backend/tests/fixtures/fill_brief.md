# Fill report 7f3c2a10: greenhouse, First Name reads back wrong

> A WorkIt student sent this from the extension's panel. It is written for a coding agent: fix the fill
> so the fields below fill and read back right, and add the fixture as a test. Every value the student
> typed or WorkIt planned was taken out in their browser before it was sent: «planned» and «shown» stand
> for the planned answer and what the page showed, «redacted», «email» and «phone» for other personal text.

## Summary

- **What the student said:** It typed my name but the box shows something else.
- **Fields at issue:** First Name (`first_name`)
- **Job system:** greenhouse (the engine's jobOf: site `greenhouse`, on its form, board=acme, job=123)
- **Opened by:** readback · **status:** triaged · **reported:** 2026-10-28T14:03:05Z
- **Admin note:** Greenhouse retypes the name.

## Reproduce

1. Open https://job-boards.greenhouse.io/acme/jobs/123 in Chrome with the WorkIt extension loaded.
2. Press Autofill This Page in the WorkIt panel. Never press the employer's Submit.
3. Look at First Name (`first_name`) at `#first_name`.
4. Offline: load `fill-report-7f3c2a10.html` (the form as the student's page had it, values out) in the engine's tests; `question-set.json` beside it is the form's Question set.

## Expected vs actual

### First Name (`first_name`)

- **Expected:** the field takes the planned answer (text of 3 characters, from profile) and reads back as it.
- **Actual:** status `failed`, error `Readback`, read-back `differs` (the page shows text of 3 characters).
- **The fill's reason:** meant «planned», page shows «shown»
- **The field:** kind `text`, required, selector `#first_name`, visible.

## Fields

| # | Field | Name | Kind | Req | Visible | Selector | Source | Planned | Status | Read-back | Marked |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | First Name | `first_name` | text | yes | yes | `#first_name` | profile | text:3 | failed | differs | **wrong** |
| 2 | Are you authorized to work in the US? | `question_7` | select | yes | yes | `#question_7` | profile | option | filled | matches |  |

## Timeline

| t (ms) | Event | Field | Status | Detail |
|---|---|---|---|---|
| 0 | plan |  |  | 2 questions, 2 planned |
| 40 | field | `first_name` | start |  |
| 310 | field | `first_name` | failed | meant «planned», page shows «shown» |
| 900 | error |  |  | TypeError: x is undefined |

Stack at 900 ms:

```
TypeError: x is undefined
    at fill (engine.js:10:5)
```

## Where to look

- `autofiller_extension/fill-engine/src/greenhouse.ts`: the engine's Filler for greenhouse (its question set, fill and read-back of each kind).
- `autofiller_extension/fill-engine/src/readback.ts`: the read-back comparison: what counts as the page showing the answer.
- `autofiller_extension/src/content/content-script.js`: the extension's fill loop (plan, fill, read back, the checklist's statuses).
- Engine version `0.3.2+fcaaf20`, commit `fcaaf20d`.

## Fixture

`fill-report-7f3c2a10.html` (1 KB): the form's HTML with every value, selection and personal text taken out; structure, labels and attributes kept.
Save it with `question-set.json` as `autofiller_extension/fill-engine/test/fixtures/forms/greenhouse-report-7f3c2a10/` and write the failing spec against it first.

## Environment

- Extension 0.1.0, engine `0.3.2+fcaaf20`, Chrome 141, frame top.
- Captured 2026-10-28T14:03:00Z.
