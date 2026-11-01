# Cut to One Page

A draft design, not built. It changes what Fit to One Page (KAN-218) cuts
and how it stops. Every resume follows the same steps, floors and entry
percentages; only the order inside a step differs:

- **A resume with a job posting** (every tailored resume) is cut by rank:
  what the posting cares about least goes first.
- **A resume with no job posting** (a generated or base resume) is cut by
  position: the bottom entry and the last bullet go first, as today.

Both can now cut skills. Fit renders after every single cut and stops the
moment the resume is one page.

Read `backend/CLAUDE.md` (Fit to One Page) and `docs/tailor_resume.md`
first. This design reuses the keyword match's whole-word check; it adds no
model call.

## What stays the same

- A cut hides an item on this resume only. It never deletes it from the
  experience bank.
- Education is never cut. Its coursework line is still the first cut when
  the resume has Experience.
- No LLM and no embedding model. Fit to One Page stays free and spends no
  AI use.

## The loop: one cut, then check

`fit_to_one_page` (`services/built_resumes.py`) becomes:

1. Render the resume. If it is one page, stop: cut nothing.
2. Make the next cut on the list (below), and save it.
3. Render again. If it is one page, stop.
4. Else go back to step 2, until no cut is left.

Each cut is checked before the next one is made, so Fit never hides an
item the page did not need. This replaces today's batches: no cuts taken
by `lines_over`, no `FIT_ROUNDS` limit, and no put-back of a batch's extra
cuts (`FIT_PUT_BACK`), since a one-at-a-time loop never overshoots.

When no cut is left (every floor below is reached) and the resume is
still over one page, Fit stops and keeps the cuts it made. The editor's
page count shows the student that it is still over.

## Every score reads this resume only

Ranks, levels and positions come from this resume's view (`build_view`):
the entries, bullets, wording and skills it shows, and its own posting.
Nothing reads another resume, another resume's wording, or a bullet's
bank wording when this resume shows other words. A tailored resume is
ranked on the bullets Tailor rewrote for it, as the student sees them.

The scores are computed once, from the first view, before the first cut.
A cut never changes another item's score.

## The order inside a step

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
what it has; an entry with none scores 0. The lowest-scored entry goes
first, across all cuttable sections at once. Ties: the bottom entry of
its section first.

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

- **Bullets:** an entry's last bullet first, as today.
- **Entries:** the bottom entry of a section first. Sections take turns,
  one entry each, in today's order: Leadership, Awards, Certifications,
  Projects, Experience, then round again, skipping a section at its
  floor. Taking turns keeps today's lesson: a rule that emptied one
  section before the others gave anything left a long resume lopsided.
- **Skills:** the last skill of a wrapped line first; a whole skill line,
  the bottom line first.

## The steps

The percentages count entries in the cuttable sections (Experience,
Projects, Leadership, Awards, Certifications) at the start of the run,
never Education. "Cut" counts the entries hidden so far in this run.

1. **Coursework**, as today.
2. **Entries**, by the order above. This is the main cut and goes on
   through every step below.
3. **From 10% of entries cut: trim wrapped skill lines.** A skill line that
   runs onto two or more lines loses skills until it fits on one line. A
   skill cut from a one-line group saves no line, so it is never made
   here. Whether a line wraps is read from the last render's skill boxes.
4. **From 50% of entries cut: cut one whole skill line.**
5. **From 75% of entries cut: cut one more whole skill line.**
6. **Bullets, last.** An entry over two bullets loses bullets down to two.

Cuts of different kinds interleave by the step they are allowed in: once
10% of entries are gone, the next cut is a wrapped skill trim if one is
left, else the next entry.

## Floors

- **Each shown entry keeps at least two bullets.** An entry with fewer
  than two to start with keeps all of them.
- **The Skills section keeps at least one line.**
- **Experience and Projects each keep one entry**: the top-scored one with
  a posting, the top one without, so the page never loses a whole section
  that carries the student's work.

## What changes in code

- `fit_order` takes the scores as arguments (bullet ranks and skill levels,
  or none for the position order) and stays a pure function, so
  `tests/test_fit_order.py` can test it with no database. It gives the next
  cut from the current view, the cuts made so far and the last render's
  skill boxes.
- `fit_to_one_page` runs the one-cut loop above. `FIT_STEPS`,
  `FIT_ROUNDS`, `FIT_PUT_BACK` and the batching by `_cut_lines` and
  `lines_over` go.
- A ranking function that takes the view's bullets (id and text) and the
  posting text, and ranks the text it is given. Tailor keeps
  `rank_bullets`; it ranks before any rewrite, so the bank's wording is
  what it should read. (It differs from the source resume only where that
  resume shows its own wording; this design does not change Tailor.)
- `Cut.kind` gains `"skill"`. `fit_changes` and the choices PATCH hide a
  skill the way they hide a bullet.
- `backend/CLAUDE.md` (Fit to One Page), the comment above `FIT_STEPS`, and
  "Education and Skills are never cut" change with the code.

## Still open

- **One render per cut is slow on a long resume.** A render takes about
  0.3 to 0.5 s warm on a Mac and 0.8 s in the container image
  (`resume_render/CLAUDE.md`). A resume that needs 20 cuts waits 6 to
  16 s, and today's batches needed two to six renders. Measure on real
  resumes; if it is too slow, cut several items per render while
  `lines_over` is large and one at a time near the end, which still never
  overshoots.
- **Bullets come last on purpose.** Up to 75% of entries can go before a
  single extra bullet does. A resume a few lines over loses one entry, not
  bullets across every entry. If real resumes come back too thin, move
  bullet trims ahead of the 50% step.
- **Skill levels on a resume with no posting.** Level 1 (backed by a
  bullet) needs no posting. A later change could order its skills by
  levels 1 and 0 before position.
