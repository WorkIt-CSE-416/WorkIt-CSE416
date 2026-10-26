# Tailor Resume: one click, changes in place

Status: **steps 1 to 4 built 2026-10-25** (placement, the truth rule's
known words, resume-local skills (migration `a3d7f1c9e2b4`), the run that
saves, and the editor's review). Step 5, the clean-up, is left. It replaces Tailor's proposals
and Done (KAN-217, `backend/CLAUDE.md`, "Tailor"). Build it in the steps at
the end; each step ships on its own.

## Goal

A student tailors a resume to a job posting in one click and lands in the
editor with the tailored resume already compiled. There are no proposal
cards to accept and no Done. Every change WorkIt made is marked in the
editor, and the student can revert each one there until they click Save.

**One tailored resume per posting, made once.** A posting that already has
a tailored resume cannot be tailored again: the screen opens the existing
one in the editor instead, and the run answers 409 if called. This saves
model tokens; the student changes the tailored resume in the editor.

## The flow

1. **The student picks a resume** on the posting's Tailor screen, from the
   shared resume list every resume dialog uses (KAN-318, KAN-406): a built
   resume or an upload. It never starts on a resume tailored to another
   posting, which would carry that job's changes in.
2. **The API builds the view** of that resume once (`build_view`). Every
   later step reads this one view.
3. **The keyword match.** The posting's keywords (`keywords.ensure`, KAN-215)
   are matched against the view (`keywords.match`). The screen shows the
   matched and missing keywords, as today.
4. **The student picks the missing keywords to add as skills.** A keyword
   the student does not pick is never written into the resume. A picked
   skill goes on the tailored resume only, never into the experience bank
   ("A picked skill belongs to the tailored resume", below). The missing
   keywords show Required, then Preferred. A note says a picked skill may
   be named in the bullets. Add All, a text button beside the list, asks
   first, then picks every missing keyword, and reads Clear All while all
   are picked (KAN-408).
5. **The student clicks Tailor Resume.** One request does all of this,
   with no confirmation step:
   - places each picked skill in the resume's skills (group and position,
     from the model's answer, below),
   - rewrites the bullets the posting cares about (the model, under the
     truth rule),
   - orders each entry's bullets by rank (Postgres text search, as today),
   - saves the result as the posting's one tailored resume, named
     "{student's name} {company} {title} Resume" (`routers/tailor.py`'s
     `_name`): the title loses any bracketed part ("(Seattle, WA)",
     "[Remote]"), and a name over Rename's 80 characters cuts the title,
     never "Resume",
   - answers with the tailored resume's id and the **changes**: what each
     change replaced (below).

   While it waits, the button names the run's real phase. The screen runs
   it through `/api/tailor`, which streams the API's `POST
   .../tailor/stream` as NDJSON: the button says Retrieving Info until the
   `asking` line (the prompt has gone to the model), Asking AI until
   `generating` (its answer is back and the run applies and saves it),
   Generating Resume until `done`, then Compiling Resume while the editor
   loads. Every check before the model call (an empty bank, a posting
   already tailored) still answers as an HTTP status, since the route runs
   to the model call before it starts the stream; a failure after that is
   an `error` line with the same status and message. `POST .../tailor`
   answers the same run as one JSON body and stays for other callers.
6. **The review opens on the tailored resume**, compiled, in the editor
   on Tailor's page, with a Suggestions panel beside it (below,
   "Suggestions"): the run's keyword match before and after ("Keyword
   Match 3 of 14 → 9 of 14" and the keywords it added), then one card per
   change to accept or reject. Each change's line is tinted on the resume
   until its card is handled. The student edits directly, and editing a
   changed item removes its mark and card.

## What is removed

| Today | After |
|---|---|
| `propose()` returns change cards (reword, order) | The run applies the changes itself |
| Accept and reject per card, before saving | The change is saved; its card's Accept keeps it, Reject undoes it |
| `POST .../tailor/done` | Gone: the run saves |
| "Have you used X?" questions, and `show_skill` changes | Gone: step 4 picks the skills before the run |
| Yes added the skill to the experience bank | A picked skill stays on the tailored resume only |
| A second run on a posting replaced its tailored resume | Refused: the posting's tailored resume opens in the editor |
| Done's second truth-rule check (the browser could send any text) | Gone: no text comes from the browser; the run checks the model's text once |

## The view is the working copy

The run changes the resume as a view: it starts from the picked resume's
view and changes it in memory (new wording, new order, new skills). The
editor and the PDF read a view too, so what the student sees is what the
run made.

**A view is never stored.** It is a pure function of the bank and a
resume's choices (`resume_view.py`). So the run saves its changes as the
tailored resume's **choices** (and each new wording as a bullet variant,
as Done does today), and the editor builds the same view from them. The
rule in `backend/CLAUDE.md` holds: every resume feature reads the built
resume view, and a rule about what shows lives in `build_view` only.

## The model's job

One call per run, as today. The prompt holds the posting's job part, its
keywords, the view (entries and bullets with handles, in the resume's own
order and wording, and only the skills it shows), and the picked skills to
place. The reply has two lists:

```json
{
  "rewords": [{"bullet": "b2", "text": "..."}],
  "placements": [{"skill": "Go", "group": "Languages", "after": 2}]
}
```

`rewords` keeps today's rules: the handle check, the truth rule, the
overlap check (`keeps_its_bullet`), the token budget and the reply cap
(`backend/CLAUDE.md`, "Tailor").

## Skill placement

The prompt numbers each skill the resume shows once, by group. The numbers
never change during the run:

```
The resume's skills:
Languages: [1] Python, [2] Java
Tools: [3] Git, [4] Docker

Place these skills: Go, Kubernetes, Terraform
```

For each picked skill the model answers a **group** (an existing one, or a
new name when none fits) and **after**: the number of the existing skill it
goes after, or 0 for first in its group. The model copies a number it can
see, like a bullet handle; it never counts or shifts numbers.

Code checks each placement on its own, so one bad line loses nothing else:

| The placement | Code does |
|---|---|
| `after` is a skill in the same group | Insert after it |
| Two placements share one `after` | Both go there, in reply order |
| `after` is out of range | End of its group |
| `after` names a skill in another group | Trust the group: end of its group |
| A new group name | Keep it if it is short, is not an existing group in other case ("tools" for "Tools"), holds no identity placeholder, and the run has made at most two new groups; else "Other" |
| A picked skill with no placement, or a name the model changed | End of "Other" |

**The group wins over the number**: the student sees the group label, and
a skill under the wrong label looks wrong, while one place off in its line
does not. Code then walks the existing skills in order, inserts the new
ones after the skill each names, puts `after: 0` first in its group and new
groups last, and renumbers every position from 0. The model's numbers never
become positions, so the saved list has no duplicate or gap.

Today `with_changes` can only append a skill at the end; this needs an
insert with renumbering.

## The truth rule

A wording may hold a number or tool only if its original bullet or what
the student has already said holds it (`tailor.known`, decided
2026-10-25): the view's skills, **the picked skills** (picking one says
the student has it), and **the posting's keywords the resume already shows
anywhere** (`keywords.match`, coursework included). So "algorithms", in
the resume's coursework, may go in a bullet; "backend", missing and not
picked, may not. Each missing keyword has one way in: the student's pick.

## Marking and reverting changes

The editor needs to know what the run changed, and what was there before,
to colour it and to undo it. The browser keeps that record in sessionStorage;
it is never stored in the database.

**The run answers with the record, and the browser keeps it.** The run's
response lists each change with what it replaced, by handle and id:

```json
{
  "resume": {"id": "...", "name": "Sam Seeker Acme Backend Intern Resume"},
  "edits": [
    {"kind": "reword", "bullet_id": "...", "text": "Built Python billing services",
     "before": "Wrote billing services in python", "before_variant_id": null},
    {"kind": "order", "entry_id": "...", "label": "Software Intern, Acme",
     "bullet_ids": ["<b2 id>", "<b1 id>"], "before_ids": ["<b1 id>", "<b2 id>"]},
    {"kind": "skill", "skill_id": "...", "label": "Go", "group": "Languages"}
  ]
}
```

| Change | Revert | Through |
|---|---|---|
| A new wording | Show the `before` wording again | The editor's choices PATCH: `variant_id` = `before_variant_id` (null: the bank's own wording) |
| A new bullet order | Put the entry's bullets back in `before_ids` order | The choices PATCH: the entry's positions |
| A picked skill | Take it off the resume | The choices PATCH: `shown` false (the skill row goes with the resume) |

- **Not in the server's memory.** The API runs as several instances that
  restart (Cloudflare Containers, `backend/CLAUDE.md`, Deployment), so a
  record kept in one instance's memory is gone on the next request. The
  browser holds it in the editor's state.
- **The run saves the tailored resume before the editor opens**, so the
  editor, the PDF and Fit to One Page work on it as on any built resume.
  The record only colours and undoes; the resume never depends on it.
- **Accept, Reject or an edit drops that change from the record**, so its
  tint and card go. The record stays while it holds the run's match, so
  the panel keeps the score once every card is handled.
- **The record lives in `sessionStorage`** (per tab, wrapped in
  try/catch), so a reload in the same tab keeps the suggestions; a new tab
  or device starts with none and the page says so in one line.
- **The student's own edits are not marked.** Only the run's changes are.

## Suggestions

The review step (`/jobs/[jobId]/tailor?resumeId=`) shows one resume, the
tailored one in the editor, and a Suggestions panel on its right, as a
document's suggestions sit in its margin
(`jobs/[jobId]/tailor/tailor-suggestions.tsx`). It replaced a before and
after side by side (2026-10-26), which the user found showed too much at
once, with the changes and their Revert controls hard to follow.

- **The panel's top** holds the keyword match ("3 → 5 of 8" and the
  keywords the run added, `tailor-score.tsx`), the count ("5
  Suggestions"), and Reject All and Accept All. It stays in view while
  the cards scroll under it. A slot for View Original (the source resume
  in a dialog) waits beside the heading.
- **One card per change**: a new wording shows the old words struck and
  the new ones highlighted, inline when only a run in the middle changed,
  else the old line over the new one; a new order names the entry and each
  bullet's place before and now ("2nd → 1st"); an added skill shows its
  name and group.
- **Accept keeps the change** (it is saved already): the card and the
  line's tint go. **Reject undoes it** through the choices PATCH
  (`revertOf`, above) and drops it. Reject All is one PATCH
  (`revertAll`), each bullet's parts merged into one row. Accept All
  empties the list.
- **Linked both ways.** Pointing at or focusing a card outlines its lines
  on the resume and brings the first into view; clicking a tinted line
  selects it for editing, as any line, and brings its card up, lit. The
  hover Revert and the "Before" tooltip on lines are gone: the cards hold
  both.
- **Only Tailor's page reviews.** The editor takes the panel as a prop
  (`suggestions`); without it, as on `/resumes/[id]`, it shows no tints.
  The panel shares the Ask Scout column and gives way to the assistant
  while it is open. With a record, the review widens to the shell's width,
  up to 76rem, so the page keeps its size beside the 360px panel.
- **On a phone** the panel is a sheet opened by "Suggestions (5)" in the
  bottom bar; tapping a card's text closes the sheet and outlines its
  line.
- **When every card is handled**, the panel says so in one line under the
  score.

## Other rules

- **One run, one `TAILOR` use**, counted after the model answers (lifted
  for now, KAN-319).
- **One tailored resume per posting, made once** (above). The run checks
  `tailored_for(applicant, posting)` before any model call and answers 409
  with the tailored resume's id, so a refused run spends no tokens.
- **The source resume never changes.** The run writes only the posting's
  tailored resume, its local skills and the new wordings' variants.

## A picked skill belongs to the tailored resume

A picked skill is never written into the experience bank (decided
2026-10-25): it shows on the tailored resume and nowhere else. But a
resume shows a skill through a choice row (`built_resume_skills`) that
points at a `bank_skills` row, so the skill still needs a row.

**A resume-local skill** (decided 2026-10-25), as the bank already has
resume-local wording (`bank_bullet_variants.built_resume_id`, the editor's
typed wording). It needs the database, not the browser: the server builds
the resume from saved rows every time it shows it (the PDF, the Word file,
Apply's snapshot, auto apply with no tab open, another device), and
`built_resume_skills.skill_id` must point at a `bank_skills` row. A new
table (`built_resume_local_skills`) was the other option: bank readers
could never see it, but `build_view`, positions, the editor and the
renderer would each handle two kinds of skill. The column reuses all of
them:

- `bank_skills` gains `built_resume_id uuid NULL`, FK `built_resumes.id`
  **ON DELETE CASCADE**: deleting the tailored resume deletes its skills.
  A skill has at most one owner: an upload (`resume_id`), a built resume
  (`built_resume_id`), or neither (the student's own); a CHECK allows only
  one.
- **`load_bank` leaves resume-local skills out by default**, so the
  Experiences view, Generate, Scout, the recommender, the embedding and
  essay answers never see them. Only the tailored resume's own view loads
  them (one filter, in one place). Without that default, every reader
  that lists "every skill" would need its own filter, and one would miss
  it.
- The skill name index (`NULLS NOT DISTINCT`, ADR 0005) gains the new
  column, so "Go" on one tailored resume does not clash with "Go" in the
  bank.
- One migration, applied before the deploy that maps the column
  (`backend/CLAUDE.md`, Deployment).
- **A failed run saves nothing.** The skills, variants and choices go in
  one commit after the model answers; a model failure answers 503 with the
  message from `services/ai_messages.py`.

## Build order

1. **Placement, alone. Built.** The run takes `skills` (the picked
   missing keywords; any other name is ignored), prints the resume's skills
   numbered by group with "Place these skills", and counts the picked
   skills for the truth rule. The reply has `placements`, and
   `place_skills` turns them into the tailored resume's skill order (the
   checks above). Nothing saves that order yet: step 3 writes it. Tests:
   each row of the placement table (`tests/test_tailor.py`).
2. **Resume-local skills. Built.** Migration `a3d7f1c9e2b4`,
   `load_bank(..., local_to=)` (left out by default), `add_local_skill`,
   and every reader of one built resume naming it (`backend/CLAUDE.md`).
   Nothing writes one yet: step 3 does.
3. **The run saves. Built.** `POST .../tailor/match` reads the source's
   match; the run refuses a posting that has a tailored resume (409 before
   any model call), applies rewords, order and placed skills, writes the
   tailored resume in one commit and answers with `edits`
   (`TailorEdit`). Done, the proposal cards and "Have you used X?" are
   gone. The screen picks skills before the run, stores the edits in
   sessionStorage and opens the editor.
4. **The editor marks and reverts. Built.** `resumes/[resumeId]/
   tailor-review.tsx`: `marksOf` tints the lines (green a new wording or
   skill, amber a moved bullet) on Tailor's page; the Suggestions panel
   offers each change's Accept and Reject; `revertOf` builds the choices
   PATCH; `untouched` drops a
   change the student's own PATCH touches, and `reverted` drops a reverted
   one. An order is read against the current choices: every bullet at
   another place than in `before_ids` is marked moved, even one a
   sibling's move pushed there. Each one reverts on its own to its before
   place, its siblings shifting around it, so a revert can put another
   bullet out of place again; the order change goes once no bullet is out
   of place. The screen stores `{edits}` in
   sessionStorage.
5. **Clean up.** Remove the questions, `show_skill`, `TailorChange` and the
   proposal schemas; update `backend/CLAUDE.md` and `frontend/CLAUDE.md`.
