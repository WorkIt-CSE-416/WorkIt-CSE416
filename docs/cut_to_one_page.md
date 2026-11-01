# Cut to One Page

A draft design, not built. It changes what Fit to One Page (KAN-218) cuts
and how it stops. Every resume follows the same section order, steps,
floors and entry percentages; only the order inside a section differs:

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

**Fit stops when no cut is left** (every floor below is reached), with
the resume still over one page. It keeps the cuts it made, and the
editor's page count shows the student that it is still over.

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
  `update_choices`, in one transaction. If a render fails (503), Fit
  writes nothing, and the resume is as it was.

### Measuring from the boxes

The render gives a box for every bullet, skill and entry field, with its
page and position (`Rendered.boxes`, PDF points, `y` growing down). From
one render:

- **An item's height** is the distance from its top to the top of the
  next item on the same page, so it includes the space after it. Today's
  `lines_over` counts only the lines inside boxes and runs short, because
  headings and the space between entries have no box; a distance has no
  such gap. The last item on a page uses its own box height plus the
  usual space between items of its kind.
- **An entry's height** runs from its first field's top to the next
  entry's top; its bullets are part of it.
- **A section heading's height** is the gap above the section's first
  entry, less the usual space between entries. When a cut empties a
  section, the heading goes too.
- **The predicted height** is the sum of every item's height, plus each
  heading's, plus the header's. It ignores the empty space at the foot of
  page 1 that a block moved whole to page 2 leaves: once the resume fits,
  nothing moves.
- **The page** fits while the predicted height is at most the text
  height. The boxes cannot give it, so the render reports it: `MARKS`
  also writes `\textheight` and the top of the text area to `resume.pos`
  at shipout, and `Rendered` carries them. Nothing is hard-coded and
  `jakes.tex` stays byte for byte. The preamble's paper size, margins and
  font size option all set the text height, so a value copied from it
  would go wrong without warning when any of them changed.
- **A skill line's width** is read from each skill's box (`x0`, `x1`). A
  wrapped line is trimmed by dropping skills from its cut order until the
  widths, with the space after each comma, fit on one line. Its saving is
  one line's height for each line it no longer wraps onto.

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

Entries, and bullets in the last step, are cut one section at a time, the
least needed section first:

**Awards → Certifications → Leadership → Projects → Experience**

A section gives way down to its floor (below) before the next section
loses anything. Inside a section, the order is by rank or by position
(next). Awards and Certifications can be deleted entirely.

Education and Skills are not in this order. Each has its own schedule,
opened by how many entries the order above has cut ("The steps"), so the
student's school and skills go only once most of the rest is gone.

This reverses a lesson in `backend/CLAUDE.md`: today every section gives a
little before any section gives a lot, because emptying one section first
left a long resume lopsided. Here that is the intent: Awards and
Certifications matter less than the student's work, so they go first.

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

**Entries.** An entry's score is the mean of its two highest-ranked
bullets. Two, because each entry keeps at least two bullets (below), so
these are the bullets that stay if the entry stays. A mean over every
bullet would punish an entry for one weak bullet that a cut can remove; a
sum would favour long entries. An entry with fewer than two bullets uses
what it has; an entry with none scores 0, which is most Education,
Awards and Certifications entries. The lowest-scored entry of the section
goes first. Ties: the bottom entry first. Education entries are ranked the
same way when their schedule opens.

**Skills.** Each skill is checked with the whole-word rule
(`keywords._shows`, with the skill catalog's other spellings,
`services/skill_catalog.py`), never `ts_rank`: Postgres text search turns
"C++" and "C#" into "c". A skill gets one of three levels:

| Level | The skill appears in |
|---|---|
| 2 | the posting's job sections (`job_part`) |
| 1 | not the posting, but a shown bullet or an entry's tools |
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

## The steps

The percentages count the entries in the section order (Awards,
Certifications, Leadership, Projects, Experience) at the start of the
run. Education is not counted: its own cuts are opened by the count, so
counting them would let Education open its own next cut. "Cut" counts the
entries hidden so far in this run.

**Entries** are the main cut: the section order, then rank or position
inside each section, from the first cut to the last. The Skills and
Education schedules open alongside them:

| Entries cut | Skills | Education |
|---|---|---|
| 10% | Trim wrapped skill lines | Delete wrapped bullets |
| 50% | Delete one skill line | |
| 75% | Delete one more skill line | |
| 80% | | Delete one Education entry |
| 85% | Delete one more skill line | |
| 90% | | Delete one more Education entry |
| 95% | Delete one more skill line | |

- **Trim wrapped skill lines.** A skill line that runs onto two or more
  lines loses skills until it fits on one line. A skill cut from a
  one-line group saves no line, so it is never made.
- **Delete wrapped bullets in Education.** An Education bullet that runs
  onto two or more lines is deleted whole. A one-line bullet stays.
- **Delete a skill line**: the line with the lowest total level, or the
  bottom line with no posting. After 75%, one more line each 10%.
- **Delete an Education entry**: the lowest-scored school, or the bottom
  one with no posting. From 80%, one more each 10%.
- Whether a line wraps, and how many skills it must lose, is read from
  the cycle's render ("Measuring from the boxes").

**Bullets go last**, in the section order, once every entry cut the
floors allow is made: an entry over two bullets loses bullets down to
two.

Cuts of different kinds interleave by the step they are allowed in: once
a percentage is reached, its Skills and Education cuts come before the
next entry. Each opened cut is made once; the next percentage opens the
next one.

## Floors

- **Each shown entry keeps at least two bullets.** An entry with fewer
  than two to start with keeps all of them. Education's wrapped bullets
  are the one exception: they can go below two, since a school is read by
  its name and degree, not its bullets.
- **Skills keeps at least one line**, whatever the schedule opens.
- **Education keeps at least one entry**, whatever the schedule opens.
- **Projects and Experience each keep one entry**: the top-scored one
  with a posting, the top one without. A resume with none of the
  student's work is not a resume.
- **Awards, Certifications and Leadership can go empty**, and their
  headings go with them.

**The floors can keep a schedule from opening.** A resume with two
Experience entries, two Projects and one Leadership entry has five
counted entries, and the floors let only three go (60%). Its 75% skill
cut and its Education entry cuts never open. Fit then moves to the
bullets, and stops with the resume over one page if they are not enough.

## What changes in code

- `fit_order` takes the scores as arguments (bullet ranks and skill levels,
  or none for the position order) and stays a pure function, so
  `tests/test_fit_order.py` can test it with no database. It gives the next
  cut from the current view and the cuts made so far.
- A pure measuring function: from a render's boxes, each item's height,
  each heading's height, each skill line's widths and the page's text
  height. A pure prediction then takes those and a list of cuts and says
  whether the page fits. Both test from saved boxes, with no Tectonic.
- `fit_to_one_page` runs the cycles above. `FIT_STEPS`, `FIT_ROUNDS`,
  `FIT_PUT_BACK` and the batching by `_cut_lines` and `lines_over` go,
  and so do the save and `load_view` inside each round.
- A pure function that applies cuts to a view and returns the smaller
  view, for the confirm render. The one save at the end goes through
  `fit_changes` as today.
- A test that renders real resumes and checks the prediction against the
  confirm render, so a template change that breaks the measuring fails
  in CI, not in front of a student.
- A ranking function that takes the view's bullets (id and text) and the
  posting text, and ranks the text it is given. Tailor keeps
  `rank_bullets`; it ranks before any rewrite, so the bank's wording is
  what it should read. (It differs from the source resume only where that
  resume shows its own wording; this design does not change Tailor.)
- `Cut.kind` gains `"skill"`. `fit_changes` and the choices PATCH hide a
  skill the way they hide a bullet.
- `backend/CLAUDE.md` (Fit to One Page: the steps, "never cut one section
  to one-line entries before the others give anything", the put-back),
  the comment above `FIT_STEPS`, and "Education and Skills are never cut"
  change with the code.

## Still open

- **Stretchy space.** TeX can stretch or shrink some vertical space a
  little, so near the page's foot a prediction can be off by about a
  line. A second cycle catches a prediction that is too hopeful. One that
  is too careful costs the student one item the page had room for; a
  put-back render (show the last cut again, keep it shown if the page
  still fits) would fix that for one more render. Measure how often it
  happens on real resumes before adding it.
- **The prediction assumes a one-column layout.** Every height, width
  and space is read from the render, never from `jakes.py`. But removing
  an item moves the rest up only when items stack in one column at a
  fixed width, with skills printed one line per group. A template with
  columns or a side bar breaks that and needs its own prediction.
- **Bullets come last on purpose.** Up to 75% of entries can go before a
  single extra bullet does. A resume a few lines over loses one entry, not
  bullets across every entry. If real resumes come back too thin, move
  bullet trims ahead of the 50% step.
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
