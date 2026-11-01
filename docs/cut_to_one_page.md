# Cut to One Page

Built (KAN-320): `backend/app/services/fit_page.py`, run by
`built_resumes.fit_to_one_page`. It changed what Fit to One Page (KAN-218)
cuts and how it stops. Every resume follows the same section order, stages,
floors and entry percentages, and is cut until it is one page; only the
order inside a section differs:

- **A resume with a job posting** (every tailored resume) is cut by rank:
  what the posting cares about least goes first.
- **A resume with no job posting** (a generated or base resume) is cut by
  position: the bottom entry and the last bullet go first, as today.

Sections give way in a fixed order, the least needed first: Awards,
Certifications, Leadership, Projects, Experience. Skills and Education
can now be cut too, each on its own schedule, opened as more of those
entries go. It checks the page after every single cut by
prediction, not by rendering: it renders once at the start, predicts each
cut's effect from that render's boxes, and renders once at the end to
confirm. It reads the database once at the start and writes once, after
the resume is one page.

Read `backend/CLAUDE.md` (Fit to One Page) and `docs/tailor_resume.md`
first. This design reuses the keyword match's whole-word check; it adds no
model call.

## What stays the same

- A cut hides an item on this resume only. It never deletes it from the
  experience bank.
- No LLM and no embedding model. Fit to One Page stays free and spends no
  AI use.

## The loop: predict each cut, render to confirm

A render takes 0.3 to 0.8 s (`resume_render/CLAUDE.md`), so Fit does not
render after each cut. It renders at the start of a cycle and at its end,
and checks every cut in between by subtraction.

`fit_to_one_page` (`services/built_resumes.py`) runs cycles:

1. **Render.** If the resume is one page, stop. On the first cycle that
   means Fit cuts nothing.
2. **Measure** every item from this render's boxes (below).
3. **Cut by prediction.** Take the next cut on the list (below), subtract
   its height from the predicted height, and check the prediction against
   the page. Repeat until the prediction fits on one page or no cut is
   left. Nothing renders and nothing saves during this step.
4. **Render to confirm**, from the view with every cut so far applied in
   memory. If the resume is one page, stop. If it is still over, this
   render starts the next cycle: go to step 2.
5. **Save** every cut of every cycle together, once, after the loop ends.

Each cycle measures from its own first render, so a prediction's error
never carries into the next cycle. Most runs take one cycle, two renders.

**Every cycle cuts at least one item.** If the prediction already fits
but the render says the page is over, step 3 still takes the next cut.
Without this rule, a prediction that is wrong by a line would render the
same resume forever.

**Fit always ends at one page**: the stages ("The stages") go on, past
the floors if they must (stage 4, under "Floors"), until the page fits.
At the very worst only the header is left, and it fits.

This replaces today's batches: no cuts taken by `lines_over`, no
`FIT_ROUNDS` limit, and no put-back renders (`FIT_PUT_BACK`). The
prediction stops at the first cut that fits, so it overshoots by at most
its own error, about one line.

### One read, one write

Today each round saves its cuts and reads the resume back
(`update_choices`, then `load_view`) before it renders: two database round
trips per round, and a failed render can leave half a fit saved. The new
loop touches the database twice in all:

- **One read, at the start:** the resume's view (`load_view`: its choices
  and the bank they point at), its posting when `job_posting_id` is set,
  and the header identity the render prints. The bullet ranking is one
  more query, but it sends the view's texts as parameters and reads no
  table ("By rank", below).
- **Everything between is in memory.** A cut is applied to the view by a
  pure function that returns the view without the cut items; `render`
  already takes a view (`fit_to_one_page`'s `render` argument), so the
  confirm render needs no save first.
- **One write, at the end:** every cut together through `fit_changes` and
  `update_choices`, in one transaction. A render that fails is tried once
  more; if it fails again (503), Fit writes nothing, and the resume is as
  it was.

### Measuring from the boxes

The render gives a box for every bullet, skill and entry field, with its
page and position (`Rendered.boxes`, PDF points, `y` growing down). From
one render:

- **An item's height** is the distance from its top to the top of the
  next item on the same page, so it includes the space after it. The old
  `lines_over` counted only the lines inside boxes and ran short, because
  headings and the space between entries have no box; a distance has no
  such gap. It is measured, never guessed from the box: two bullets'
  tops sat 12.2 pt apart or 13.9 pt apart in one render, as a tall
  character pushes a line down. The last item in its entry or section, or
  one at a page break, uses its boxes' extent plus the usual space
  between items of its kind.
- **An entry's height** runs from its first field's top to the next
  entry's top; its bullets are part of it.
- **A section heading's height** is the gap above the section's first
  entry, less the usual space between entries. When a cut empties a
  section, the heading goes too.
- **The predicted height** is the sum of every item's height, plus each
  heading's, plus the header's (`Page.used`). It is a sum, not a reading
  of where the last line landed: it ignores the empty space at the foot of
  page 1 that a block moved whole to page 2 leaves, since once the resume
  fits, nothing moves.
- **What the glue can give.** TeX squeezes the space between list items
  (about 2 pt a bullet in Jake's) rather than break the document's last
  page, so a page holds more than its height. Each start marker records
  `\pagetotal` and `\pageshrink` as it is set (`Rendered.shrinks`); an
  item's shrink is the page's shrink from its marker to the next. The
  page fits while the predicted height, less what the remaining items'
  glue can give, is at most the text height. Without this, Fit cut 2 to 4
  bullets the page had room for.
- **The page** fits while the predicted height is at most the text
  height. The boxes cannot give it, so the render reports it: `MARKS`
  also writes `\textheight` and the top of the text area to `resume.pos`
  at shipout, and `Rendered` carries them. Nothing is hard-coded and
  `jakes.tex` stays byte for byte. The preamble's paper size, margins and
  font size option all set the text height, so a value copied from it
  would go wrong without warning when any of them changed.
- **A skill line's width** is read from each skill's box (`x0`, `x1`),
  its left edge from a `\wipoint` at the line's start (`Rendered.points`),
  which also gives the label's width. A wrapped line is trimmed by
  dropping skills from its cut order until the label, the widths and the
  spaces between them fit on one line. Its saving is one line's height
  for each line it no longer wraps onto.

A cut never changes how another line wraps, because the text width stays
fixed. That is what makes the subtraction safe.

## Every score reads this resume only

Ranks, levels and positions come from this resume's view (`build_view`):
the entries, bullets, wording and skills it shows, and its own posting.
Nothing reads another resume, another resume's wording, or a bullet's
bank wording when this resume shows other words. A tailored resume is
ranked on the bullets Tailor rewrote for it, as the student sees them.

The scores are computed once, from the first view, before the first cut.
A cut never changes another item's score.

## The section order

Bullets are cut one section at a time, the least needed section first:

**Awards → Certifications → Leadership → Projects → Experience**

Whole entries (stage 3) go in the same order without Awards and
Certifications:

**Leadership → Projects → Experience**

In each stage ("The stages"), a section gives way down to that stage's
limit before the next section loses anything. Inside a section, the
order is by rank or by position (next).

Awards, Certifications, Education and Skills each go by a schedule
instead, opened by how many Leadership, Projects and Experience entries
stage 3 has cut ("The schedules"). Awards and Certifications are deleted
entirely early, at 10%; the student's school and skills go only once
most of the rest is gone.

This reverses a lesson in `backend/CLAUDE.md`: today every section gives a
little before any section gives a lot, because emptying one section first
left a long resume lopsided. Here that is the intent: Leadership matters
less than Projects, and Projects less than Experience.

Coursework has no rule of its own any more. Today it was the first cut
whenever the resume had Experience; now it stays with its Education entry
and goes only when that entry goes.

In this note, a **skill line** is one group as it prints ("Languages:
Python, Java"), and an **Education entry** is one school.

## The order inside a section

### With a job posting: by rank

**Bullets.** Each shown bullet is scored on its view text
(`ViewBullet.text`: this resume's wording, else the bank's) with Postgres
`ts_rank` against `tailor.posting_text` (the posting's title, its
keywords, and the job sections of its description, `job_part`). The texts
go to Postgres as query parameters; the ranking reads no table. A higher
score means the bullet shares more words with the posting; the lowest
goes first.

`tailor.rank_bullets` is not reused as it stands: it ranks
`Bank_Bullet.text`, the bank's wording. That is right for Tailor, which
ranks before it rewrites anything. Fit runs after: on a tailored resume
the bank's wording is the text from before Tailor rewrote it, not what
the page shows.

**Entries.** Whole entries go only in stage 3, when each entry is down
to one bullet: its highest-ranked, since the lowest go first. So an
entry's score is the rank of its best bullet, the one that is still
there. An entry with no bullets scores 0, which is most Education, Awards
and Certifications entries. The lowest-scored entry of the section goes
first. Ties: the bottom entry first. Education entries are ranked the
same way when their schedule opens.

**Skills.** Each skill is checked with the whole-word rule
(`keywords._shows`, with the skill catalog's other spellings,
`services/skill_catalog.py`), never `ts_rank`: Postgres text search turns
"C++" and "C#" into "c". A skill gets one of three levels:

| Level | The skill appears in |
|---|---|
| 2 | the posting's job sections (`job_part`) |
| 1 | not the posting, but one of the resume's shown bullets |
| 0 | neither |

Lower levels go first. Inside a level, the skill at the end of its group
goes first. A whole skill line goes by the lowest total level (ties: the
bottom line).

A posting with an empty description (`tailor.weak_match`) scores every
bullet 0 and gives no level 2, so it uses the position order instead.

### With no job posting: by position

- **Bullets:** an entry's last bullet first, as today; the bottom entry's
  bullets before the top entry's.
- **Entries:** the bottom entry of the section first.
- **Skills:** the last skill of a wrapped line first; a whole skill line,
  the bottom line first.

## The stages

Fit cuts until the resume is one page. Each stage starts only when the
one before it has nothing left to cut and the page is still over:

1. **Bullets down to two.** Each entry over two bullets loses bullets,
   section by section in the section order, the lowest-ranked (or last)
   bullet first, until every entry has two.
2. **Bullets down to one**, the hard stage. The two-bullet rule is
   dropped: each entry goes down to one bullet, in the same order.
3. **Whole entries.** With each entry at one bullet, whole entries go:
   Leadership, Projects, Experience, then rank or position inside each
   section, down to Experience's one entry (Floors). The schedules
   (below) open as entries go.

A resume a few lines over loses a few bullets and keeps every entry.
Whole entries go only once no entry has a bullet to spare.

### The schedules

The percentages count the Leadership, Projects and Experience entries at
the start of the run. "Cut" counts those hidden so far, which happens
only in stage 3. Awards, Certifications and Education are not counted:
their own cuts are opened by the count, so counting them would let a
schedule open its own next cut.

Once a percentage is reached, its cuts come before the next entry, in the
table's order, left to right:

| Entries cut | Skills | Awards and Certifications | Education |
|---|---|---|---|
| 10% | Trim wrapped skill lines | Delete both sections entirely | Delete wrapped bullets |
| 50% | Delete one skill line | | |
| 75% | Delete one more skill line | | |
| 80% | | | Delete one Education entry |
| 85% | Delete one more skill line | | |
| 90% | | | Delete one more Education entry |
| 95% | Delete one more skill line | | |

So at 10%, the wrapped skill lines are trimmed first, then every Awards
and Certifications entry goes, headings with them, then Education's
wrapped bullets.

- **Trim wrapped skill lines.** A skill line that runs onto two or more
  lines loses skills until it fits on one line. A skill cut from a
  one-line group saves no line, so it is never made.
- **Delete Awards and Certifications**: every entry in both sections,
  whatever its rank. Their bullets may already be trimmed by stages 1
  and 2.
- **Delete wrapped bullets in Education.** An Education bullet that runs
  onto two or more lines is deleted whole. A one-line bullet stays.
- **Delete a skill line**: the line with the lowest total level, or the
  bottom line with no posting. After 75%, one more line each 10%.
- **Delete an Education entry**: the lowest-scored school, or the bottom
  one with no posting. From 80%, one more each 10%.
- Whether a line wraps, and how many skills it must lose, is read from
  the cycle's render ("Measuring from the boxes").

Each opened cut is made once; the next percentage opens the next one.

**When stage 3 runs out first.** A small resume can reach Experience's
last entry before a percentage opens: one Experience entry and nothing
else in Leadership or Projects is 0% forever. Then the schedules' next
cut opens anyway, in the table's order, one at a time, until the page
fits. A schedule never waits on an entry that cannot go.

Education's bullets are not cut in stages 1 and 2; Education is not in
the section order. They go only by its schedule: wrapped ones at 10%,
the rest with their school.

## Floors

Three limits hold through stages 1 to 3 (stage 4, below, is the one
exception):

- **Experience keeps at least one entry**: the top-scored one with a
  posting, the top one without. A resume needs one job.
- **Skills keeps at least one line.**
- **Education keeps at least one entry.**

Every other limit is a stage's limit, not a floor: two bullets per entry
holds until stage 2, one bullet per entry until stage 3. Leadership and
Projects can go empty in stage 3, and Awards and Certifications at 10%,
their headings with them.

**Stage 4, the last resort: the floors go too.** There is always room to
cut to one page. When stage 3 and every schedule cut are done (or cannot
open) and the page is still over, the floors give way one at a time, in
this order:

1. **Skills**: the last skill line, so the whole Skills section goes.
2. **Projects**: any entry still left, lowest-ranked (or bottom) first.
3. **Experience**: its last entry.
4. **Education**: its last school.

Before stage 4, a small resume first runs its schedules to their floors
("When stage 3 runs out first"): skill lines go until one is left, then
schools until one is left. Only then does stage 4 start.

**Fit always ends at one page.** After stage 4, only the header is left,
and it fits. On a real resume Fit stops long before that.

**Example.** Two Experience entries, two Projects, one Leadership entry
and two Awards, each job, project and role with six long bullets, at a
page and a half. The percentages count five entries (two Experience,
two Projects, one Leadership):

1. Stage 1 cuts the bullets down to two per entry: 20 bullets go,
   Leadership's first. Most resumes stop here.
2. If still over, stage 2 cuts each entry to one bullet.
3. If still over, stage 3 cuts the Leadership entry. That is 20% of
   five, past 10%: the wrapped skill lines are trimmed, both Awards go,
   and Education's wrapped bullets go, each checked against the page.
   Then Projects go from the lowest-ranked, and so on until the page
   fits.

## The code

- `services/fit_page.py`, pure (no database, no render): `plan` (every
  cut, in order, as steps; a step is one bullet or entry, or the skills a
  line loses together), `Page` (one render measured: `used`, `saved`,
  `shrink`, `fits`), `apply_cuts` (the view with cuts made, for the
  confirm render), `skill_levels`, and `fit`, the loop.
- `built_resumes.fit_to_one_page` reads the view, gets the scores
  (`fit_scores`), runs `fit_page.fit` and saves the cuts through
  `fit_changes` and `update_choices`. `fit_scores` returns None (position
  order) with no posting, one no longer listed, or one with no
  description; it reads the posting's cached keywords only and spends no
  AI use.
- `tailor.rank_shown` ranks the view's wording, sent as parameters;
  Tailor keeps `rank_bullets`, which ranks before any rewrite.
- The renderer reports the text area, each skill line's start and each
  marker's shrink (`resume_render/CLAUDE.md`); the page stays the same
  with and without markers.
- `Cut.kind` is `bullet`, `entry` or `skill`; the response's `undo` holds
  skills too, and the editor's Cut From Resume lists them in a Skills
  group beside the entries and bullets, so everything Fit cut can be put
  back there.
- Tests: `tests/test_fit_page.py` (the plan, the check, and real renders:
  one page in at most three renders, at most one cut too many) and
  `tests/test_resume_editor.py`.

## Still open

- **A prediction can still be off by a line.** On real renders it hit
  the exact cut, or was one too careful (one item the page had room
  for), or two too hopeful (caught by a second cycle, one cut too many).
  A put-back render (show the last cut again, keep it shown if the page
  still fits) would win back the one item for one more render. Measure
  how often it happens on students' resumes before adding it.
- **The prediction assumes a one-column layout.** Every height, width
  and space is read from the render, never from `jakes.py`. But removing
  an item moves the rest up only when items stack in one column at a
  fixed width, with skills printed one line per group. A template with
  columns or a side bar breaks that and needs its own prediction.
- **Coursework as a cut of its own.** A long coursework line could be
  hidden before its Education entry goes. This design drops that rule;
  bring it back as a step if Education entries go too often.
- **Edits during a fit.** The write at the end hides items by id. If the
  student edits the resume in another tab while Fit runs, Fit's cuts land
  on the newer resume, which it did not measure. The editor waits for
  Fit's answer, so this needs a second tab.
- **Skill levels on a resume with no posting.** Level 1 (backed by a
  bullet) needs no posting. A later change could order its skills by
  levels 1 and 0 before position.
