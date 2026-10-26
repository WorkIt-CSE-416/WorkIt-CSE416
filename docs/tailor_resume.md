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

**One tailored resume per posting; running Tailor again replaces it.** The
posting's page opens its tailored resume's review once it has one. The
review's Back opens Choose Keywords again on the resume the run started
from, and a new run replaces the tailored resume in place: the same id,
name and star, made again (2026-10-26). Step 2 says so above Tailor Resume,
since the run asks for no confirmation. It was made once, a second run
refused with a 409 to save model tokens, until the student wanted to go
back and pick other keywords.

## The flow

The screen shows three steps (`TailorSteps`): Pick a Resume (1 below),
Choose Keywords (3 and 4), and Review Changes (6). The run (5) is a
loader over Choose Keywords, not a step: until 2026-10-26 it was a fourth
step, Tailor, a view that only waited.

1. **The student picks a resume** on the posting's Tailor screen, from the
   shared resume list every resume dialog uses (KAN-318, KAN-406): a built
   resume or an upload. It never starts on a resume tailored to another
   posting, which would carry that job's changes in.
2. **The API builds the view** of that resume once (`build_view`). Every
   later step reads this one view.
3. **The keyword match.** The posting's keywords (`keywords.ensure`, KAN-215)
   are matched against the view (`keywords.match`). The screen shows the
   matched keywords and their share ("3 of 14 keywords matched", over a
   bar) and the missing ones, on one card.
4. **The student picks the missing keywords to add as skills.** A keyword
   the student does not pick is never written into the resume. A picked
   skill goes on the tailored resume only, never into the experience bank
   ("A picked skill belongs to the tailored resume", below). The missing
   keywords show Required, then Preferred. A note says a picked skill may
   be named in the bullets. A count says how many are picked ("4 of 11
   selected"). Select All, a small button, asks first, then picks every
   missing keyword; Clear, beside it, drops every pick (KAN-408; one text
   link, Add All then Clear All, until 2026-10-26).
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

   While it waits, a loader in the middle of the window (`TailorRunning`,
   a modal that Esc and a click outside do not close) lists the run's
   real phases, the done ones checked. The screen runs it through
   `/api/tailor`, which streams the API's `POST .../tailor/stream` as
   NDJSON: the loader says Retrieving Info until the
   `asking` line (the prompt has gone to the model), Asking AI until
   `generating` (its answer is back and the run applies and saves it),
   Generating Resume until `done`, then Compiling Resume while the editor
   loads. Every check before the model call (an empty bank, a posting
   already tailored) still answers as an HTTP status, since the route runs
   to the model call before it starts the stream; a failure after that is
   an `error` line with the same status and message. A failure closes the
   loader and shows its message on the Choose Keywords card. `POST .../tailor`
   answers the same run as one JSON body and stays for other callers.
6. **The review opens on the tailored resume**, compiled, in the editor
   on Tailor's page, with a Suggestions panel beside it (below,
   "Suggestions"): one row per change to accept or reject, with Accept
   All and Reject All under them. The run's keyword match before and after
   is kept with the record but not shown: Choose Keywords already showed
   the match. Each change's line is tinted on the resume
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
once, with the changes and their Revert controls hard to follow. A first
panel with every card open and every line tinted was then made quiet
after Quinncia's resume review (2026-10-26): everything had the same
weight.

- **The page's top row**, in the brand tint with its ring and rounded,
  as the panel is, so the page's frame stands apart from the content
  under it: Back at the left (`TailorBack`: Choose Keywords again on the
  run's source, to pick other keywords and run again, which replaces this
  resume; Pick a Resume when this tab has no record of the run; the Jobs
  page until 2026-10-26), the step in the
  middle on one line ("Review Changes · Step 3 of 3"; the flow's name
  over the step, two lines, said more than the row needs), and Finish at
  the right, which leaves for the job posting's page, where the student
  applies. Download sat beside Finish for a day; it is back on the
  toolbar with the page's tools. Every change is saved as it is made, so
  Finish saves nothing, and suggestions not handled stay as the run made
  them. There was no Finish until 2026-10-26, so the review had no end.
- **Under it, the resume's name**, spanning the page and the panel, with
  the view switch at its right end over the column it changes: one
  switch of three, Resume Only (the page alone at full width, to edit
  with nothing beside it), Suggestions (with its count) or Original
  (`SideSwitch`, on `SegmentedToggle`). One is always chosen: the page
  alone was first reached by pressing the chosen option again, which
  nobody would find. It sat in the toolbar until 2026-10-26; it changes
  what is shown, not the page, so it left. Then two columns that start
  level: the toolbar and the page, and beside them the panel,
  "Suggestions" with its count in a filled pill at its top. The name renames in place (`ResumeTitle`): it
  reads as text, shows a faint outline and a pencil when pointed at, and a
  click makes it a field in the same box; Enter or a click away saves
  (`renameBuiltResume`), Esc cancels. They were grey small capitals
  ("RESUME · <name>", "SUGGESTIONS · 6") until the user found them muted.
  The job's logo, title and company beside Back crowded the top row.
- **The toolbar holds only tools for the page**: the editor's slim row
  (`compact`), one row over the page. At the left, Undo and Redo, UI only
  for now (the editor keeps no history yet, so both stay disabled,
  2026-10-26), then the page count as an amber chip with a warning sign
  and a caret ("⚠ 2 pages ⌄", over one page only), which reads as a
  problem to open and offers Fit to One Page, and Undo Fit after a fit.
  At the right, Download, secondary: Finish is the page's one filled
  button, and a filled Download beside it competed. No "Not on This Resume" on
  this page: putting a hidden line back is the editor's own page's work,
  and a run's own removals have Reject. It sat under the page, below a
  two-page resume, then for a day was a toolbar button with a modal,
  which cluttered the review. Two
  rows were weighed and refused: the toolbar sticks over the page, so a
  second row hides more resume as it scrolls. Before this the toolbar
  held View Original, Suggestions and Download as three buttons and
  wrapped to two rows; it spanned the page and the panel for a day, which
  put the panel under it; Download was an outlined glyph, the panel
  folded to a rail of its own (»), and a "Click a line to edit it." hint
  showed while the pointer was over the page, which the line's own
  highlight already says.
  Editing a line: its kind, Move Up and Move Down first, then Hide and the
  line's own choices (a bullet's wordings, Education's GPA), and "Esc when
  done" in place of a Done button. No Ask Scout on this page: the panel
  holds the column the assistant opens in, and a second AI entry beside it
  split the page. No Download while a line is open.
- **Dots, then highlights.** Each changed line has a small dot (8px) in
  the page's left margin, brand purple whatever the change: in each
  type's colour the amber dots read as one more signal among the
  highlights, so a dot says only that a line changed and the panel says
  how. A removed line is not on the page, so it has none. Dots on one
  line (skills) stack like coins. A line is
  highlighted only while its suggestion is pointed at, focused or open,
  as Quinncia draws one: the tint carried 1px past the line, a 1px border
  in the mark's dark shade (`positive-ink`, `warning-strong`) at half
  strength, rounded; at full strength it read too thick. A line being
  typed in keeps only its tint, so the field's 1.5px ring is its one
  outline. A
  click on a dot or on a changed line opens its suggestion (and its
  section). Dots and cards were numbered until 2026-10-26: the numbers
  read as an order to follow, so each section counts its own instead.
- **Original sets the source resume beside the tailored one**, in place
  of the panel, the two at one width, so a line reads against its twin.
  Its label is a bar the toolbar's shape and height, level with it, so
  the pages start level and the two read as a pair (its outline a border,
  not the toolbar's ring: the column scrolls and clipped a ring's sides): a history glyph in
  brand, "Original Resume" in ink, and a Read Only tag. It was a grey
  line of label type, which the user found too quiet. The source (the
  record's `source`) draws read-only through step 1's preview loader
  (`OriginalResume` in `resume-preview.tsx`), kept for the page's life so
  a second look shows at once; the record keeps the source's id, not its
  name, so it is labelled for what it is. The switch shows one column
  at a time or none (`side` in the editor, null for Resume Only). View Original was a link in
  the panel's top, then a white button there, and opened the Preview
  dialog; the user wanted the two side by side.
- **The panel's top stays put and only its sections scroll** under it:
  the column beside the page caps the panel's height (the window less
  the 15rem of chrome above it, so its rounded foot shows before the page
  scrolls) and the section list scrolls inside, so the scroll bar starts
  under the top and the panel keeps its corners. The column itself
  scrolled until 2026-10-26, which carried the rounded corners off with
  the list. The top holds the title, its count and the type filter.
  Under the list, Reject All and Accept All, red and green as on each
  row, in reach rather than in a "…" menu at the top, where nobody found
  them. The top showed the run's keyword match as a thin row over a
  meter until 2026-10-26; it repeated Choose Keywords' match, and the
  meter read as a progress bar.
- **A brand-tint panel of white sections.** The panel is the brand tint
  with its pale ring, the editor's bar's colour, so the two read as one
  review and its white sections stand apart; it was grey (`app`) until
  the user found it muted. On a phone the sheet is white and the sections
  grey. Reject is the danger tint with red text (Button `decline`) and
  Accept the green fill (`positive`), so the two read apart at a glance.
- **The toolbar shows and hides the panel** (Suggestions, `panelOpen` in
  the editor, which owns the grid). Hidden, the page takes the whole
  width and no line stays highlighted. A phone opens the panel as a sheet
  from its own button.
- **Four change types, each a colour and a glyph** (`ChangeKind`):
  added (green, +), reworded (blue, pencil), removed (red, minus) and
  moved (amber, up and down arrows). A glyph as well as a colour, so the
  type reads without telling colours apart. The run's changes map onto
  them (`changesOf`): a new wording is reworded, an entry's new order is
  moved, an added skill is added. The run makes no added bullet and no
  removed line yet; the types are ready for when it does.
- **A section per resume entry, top to bottom as on the page** (the
  entry's title box's place, `pageOrder`), Skills where its lines sit: a
  heading with the entry's title, its organization, how many suggestions
  it holds and a caret. Under a hairline, each suggestion is always open:
  its type's round badge and name ("Removed bullet", "Added skill ·
  Languages"), a green check (Accept) and a red cross (Reject) at its end,
  as Google Docs answers a suggestion, and under them a white card with an
  outline holding the words, one row for each thing that changed under a
  hairline (`ChangeCard`): each moved bullet with its place before and
  after as an amber tag ("3 → 1"), a rewording's Before and After lines or
  one line with the changed words marked (the old struck, the new
  highlighted), an added or removed line in plain type (its badge and name
  say which; a highlight or a strike over a whole line only made it harder
  to read). Only sections fold: each row folded too, with a plus and a
  minus, until 2026-10-26, and a fold inside a folding section read as
  nested and odd. The card was one grey box, which read as a chat message
  and ran three moves together as one; Accept and Reject were full buttons
  under it, which read heavy. Pointing at a row highlights its lines and
  turns it faint grey, never brand (a purple row read as selected); a click
  on its name also scrolls the page to them (on a phone, closing the
  sheet). Hover never scrolls: it made the page swim as the pointer
  crossed the panel. The panel scrolls its own list to a row shown from
  the page, never the page: a `scrollIntoView` there cancelled the page's
  smooth scroll in Chrome. Sections were by type (Reworded Bullets,
  Reordered Bullets, Added Skills) until 2026-10-26: with every type in
  play, a student reads the panel against the page, and sections by type
  sent them up and down it. Each suggestion was a numbered card before
  that.
- **A type filter in the panel's heading row** (`TypeFilter`), a
  dropdown drawn as the Resumes page's Type filter is (`facetClasses`,
  brand-tinted while it holds a pick): its button names the type shown
  with that type's badge, and its menu lists All Types and each type
  present, each with its badge and count. The types were a two-by-two
  legend of coloured pills, which took four rows' height.
- **Sample changes, TEMPORARY** (`demo-suggestions.ts`, 2026-10-26): six
  sample changes of every type, built from the resume's own entries, sit
  beside a run's real ones so the panel's design can be judged; Accept or
  Reject only drops them, and the toolbar's count includes them. Remove
  the file and its two uses before this branch opens a PR.
- **Accept keeps the change** (it is saved already): the card and its
  dots go. **Reject undoes it** through the choices PATCH (`revertOf`,
  above) and drops it. Reject All is one PATCH (`revertAll`), each
  bullet's parts merged into one row. Accept All empties the list.
- **Only Tailor's page reviews.** The editor takes the panel as a prop
  (`suggestions`); without it, as on `/resumes/[id]`, it shows no dots or
  tints and keeps its full toolbar. The panel shares the Ask Scout column
  and gives way to the assistant while it is open.
- **On a phone** the panel is a sheet opened by "Suggestions (5)" in the
  bottom bar, with the same cards; an open card's Show on Resume closes
  the sheet and tints its line, and a dot opens the sheet on its card.
- **When every card is handled**, the panel says so in one line under the
  score.

## Other rules

- **One run, one `TAILOR` use**, counted after the model answers (lifted
  for now, KAN-319).
- **One tailored resume per posting, replaced by a new run** (above). The
  run finds it with `tailored_for(applicant, posting)`, refuses (422) a
  source that is that resume before any model call, and after the model
  answers clears what it alone owns (`clear_run`) and writes it again.
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
   match; a run on a posting that has a tailored resume replaces it in
   place (it refused one with a 409 until 2026-10-26), applies rewords, order and placed skills, writes the
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
