# Tailor Resume: one click, changes in place

Status: **designed 2026-10-25; step 1 built 2026-10-25** (placement and
the picked skills in the truth rule, behind today's screen). It replaces Tailor's proposals
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

1. **The student picks a resume** on the posting's Tailor screen: a built
   resume or an upload (KAN-318, as today).
2. **The API builds the view** of that resume once (`build_view`). Every
   later step reads this one view.
3. **The keyword match.** The posting's keywords (`keywords.ensure`, KAN-215)
   are matched against the view (`keywords.match`). The screen shows the
   matched and missing keywords, as today.
4. **The student picks the missing keywords to add as skills.** A keyword
   the student does not pick is never written into the resume. A picked
   skill goes on the tailored resume only, never into the experience bank
   ("A picked skill belongs to the tailored resume", below).
5. **The student clicks Tailor Resume.** One request does all of this,
   with no confirmation step:
   - places each picked skill in the resume's skills (group and position,
     from the model's answer, below),
   - rewrites the bullets the posting cares about (the model, under the
     truth rule),
   - orders each entry's bullets by rank (Postgres text search, as today),
   - saves the result as the posting's one tailored resume,
   - answers with the tailored resume's id and the **changes**: what each
     change replaced (below).
6. **The editor opens on the tailored resume**, compiled. Each change shows
   on a separate background colour. The student edits directly, and can
   revert any change. **Save** ends the review: the colours go, and a
   change can no longer be reverted (an edit still can change anything).

The matched and missing keywords from step 3 stay on the page after the
run, beside the new match.

## What is removed

| Today | After |
|---|---|
| `propose()` returns change cards (reword, order) | The run applies the changes itself |
| Accept and reject per card | Revert per change in the editor |
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

A wording may hold a number or tool only if its original bullet or the
**skills the tailored resume shows** hold it: the view's skills **plus the
picked skills** (decided 2026-10-25). The student says they have a picked
skill by picking it, so a rewording may name it. Today's rule reads the
view's skills only.

## Marking and reverting changes

The editor needs to know what the run changed, and what was there before,
to colour it and to undo it. **That record is needed only until Save**
(decided 2026-10-25): after Save nothing is reverted, so it is never
stored in the database.

**The run answers with the record, and the browser keeps it.** The run's
response lists each change with what it replaced, by handle and id:

```json
{
  "tailored_resume_id": "...",
  "changes": [
    {"kind": "reword", "handle": "b2", "bullet_id": "...", "before": "Wrote billing services in python"},
    {"kind": "order", "handle": "e2", "entry_id": "...", "before": ["<b1 id>", "<b2 id>"]},
    {"kind": "skill", "skill_id": "...", "name": "Go", "group": "Languages"}
  ]
}
```

| Change | Revert | Through |
|---|---|---|
| A new wording | Show the `before` wording again | The editor's choices PATCH: the bullet's wording back to the source's (its original, or the source's variant) |
| A new bullet order | Put the entry's bullets in the `before` order | The choices PATCH: the positions |
| A picked skill | Take it off the resume | Delete the resume-local skill (below) |

- **Not in the server's memory.** The API runs as several instances that
  restart (Cloudflare Containers, `backend/CLAUDE.md`, Deployment), so a
  record kept in one instance's memory is gone on the next request. The
  browser holds it in the editor's state.
- **The run saves the tailored resume before the editor opens**, so the
  editor, the PDF and Fit to One Page work on it as on any built resume.
  The record only colours and undoes; the resume never depends on it.
- **A revert or an edit drops that change from the record**, so its colour
  goes. Save drops the whole record.
- **A reload before Save loses the colours and the reverts**, not the
  resume. Keep a copy in `sessionStorage` (per tab, wrapped in try/catch)
  so a reload in the same tab keeps them; a new tab starts with none.
- **The student's own edits are not marked.** Only the run's changes are.

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
2. **Resume-local skills.** The migration, the `load_bank` default and
   the view's loading of one resume's own skills.
3. **The run saves.** The run refuses a posting that has a tailored
   resume, applies rewords, order and placed skills, writes the tailored
   resume and answers with the changes; Done and the proposal cards go.
   The screen picks skills before the run and opens the editor after it.
4. **The editor marks and reverts.** Colour each change from the run's
   answer; revert per change; a revert or an edit drops it; Save drops
   them all. Keep the record in `sessionStorage` for a reload.
5. **Clean up.** Remove the questions, `show_skill`, `TailorChange` and the
   proposal schemas; update `backend/CLAUDE.md` and `frontend/CLAUDE.md`.
