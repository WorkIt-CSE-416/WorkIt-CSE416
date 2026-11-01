# Cut to One Page, ranked by the job posting

A draft design, not built. It changes what Fit to One Page (KAN-218) cuts
on a resume that has a job posting: it cuts by what the posting cares
about, not by position, and it can cut skills. A resume with no posting
keeps today's order (`resume_view.fit_order`, `FIT_STEPS`).

Read `backend/CLAUDE.md` (Fit to One Page) and `docs/tailor_resume.md`
first. This design reuses Tailor's bullet rank and the keyword match's
whole-word check; it adds no model call.

## What stays the same

- `fit_to_one_page` (`services/built_resumes.py`) still runs the loop:
  render, take cuts from the front of an ordered list until the lines that
  run over are gone, render again, at most `FIT_ROUNDS` rounds, then show
  again up to `FIT_PUT_BACK` of the last round's cuts while the page still
  fits. Only the ordered list changes.
- A cut hides an item on this resume only. It never deletes it from the
  experience bank.
- Education is never cut. Its coursework line is still the first cut when
  the resume has Experience.
- No LLM and no embedding model. Fit to One Page stays free and spends no
  AI use.

## When the ranked order applies

A built resume with `job_posting_id` set: every tailored resume has one
(`built_resumes.job_posting_id`, one tailored resume per posting). A base
resume (`job_posting_id` null) has nothing to rank against and keeps
today's position order, with Skills never cut.

## Ranking

### Bullets

Each shown bullet is scored with `tailor.rank_bullets`: Postgres
`ts_rank` against `tailor.posting_text` (the posting's title, its
keywords, and the job sections of its description, `job_part`). A higher
score means the bullet shares more words with the posting.

### Entries

An entry's score is the mean of its two highest-ranked bullets. Two,
because each entry keeps at least two bullets (below), so these are the
bullets that stay if the entry stays. A mean over every bullet would
punish an entry for one weak bullet that a cut can remove; a sum would
favour long entries. An entry with fewer than two bullets uses what it
has; an entry with none scores 0.

Ties (scores equal, often 0 when a posting is short): the bottom entry of
its section goes first, as today.

### Skills

Each skill is checked with the whole-word rule (`keywords._shows`, with
the skill catalog's other spellings, `services/skill_catalog.py`), never
`ts_rank`: Postgres text search turns "C++" and "C#" into "c". A skill
gets one of three levels:

| Level | The skill appears in |
|---|---|
| 2 | the posting's job sections (`job_part`) |
| 1 | not the posting, but a shown bullet or an entry's tools |
| 0 | neither |

Lower levels go first. Inside a level, the skill at the end of its group
goes first.

## The order of cuts

The percentages count entries in the cuttable sections (Experience,
Projects, Leadership, Awards, Certifications) at the start of the run,
never Education. "Cut" counts the entries hidden so far in this run.

1. **Coursework**, as today.
2. **Entries, lowest score first**, across all cuttable sections at once.
   This is the main cut and goes on through every step below.
3. **From 10% of entries cut: trim wrapped skill lines.** A skill group
   that runs onto two or more lines loses its lowest-level skills until it
   fits on one line. A skill cut from a one-line group saves no line, so it
   is never made here.
4. **From 50% of entries cut: cut a whole skill line**, the group with the
   lowest total level (ties: the bottom group).
5. **From 75% of entries cut: cut one more whole skill line**, by the same
   rule.
6. **Bullets, last.** An entry over two bullets loses its lowest-ranked
   bullets down to two.

Cuts of different kinds interleave by the step they are allowed in: once
10% of entries are gone, the next cut is a wrapped skill trim if one is
left, else the next entry.

## Floors

- **Each shown entry keeps at least two bullets.** An entry with fewer
  than two to start with keeps all of them.
- **The Skills section keeps at least one line.**
- **Experience and Projects each keep their top-scored entry**, as today
  they keep their top entry, so the page never loses a whole section that
  carries the student's work.

## What changes in code

- `fit_order` takes the scores as arguments (`ranks` for bullets, levels
  for skills) and stays a pure function, so `tests/test_fit_order.py` can
  test it with no database. `fit_to_one_page` reads the posting and calls
  `rank_bullets` once per run, before the first round; a cut never changes
  another item's score.
- `Cut.kind` gains `"skill"`. `fit_changes` and the choices PATCH hide a
  skill the way they hide a bullet.
- The skill trim needs each group's line count, from the render's skill
  boxes (`Rendered.boxes`, `kind` `skill`), as `_cut_lines` reads boxes
  today.
- `backend/CLAUDE.md` (Fit to One Page), the comment above `FIT_STEPS`, and
  "Education and Skills are never cut" change with the code.

## Still open

- **Bullets come last on purpose.** Up to 75% of entries can go before a
  single extra bullet does. Fit takes only the cuts it needs, so a resume a
  few lines over loses one low entry, not bullets across every entry. If
  real resumes come back too thin, move bullet trims ahead of the 50%
  step.
- **`rank_bullets` scores the bank's wording**, not a tailored resume's
  rewritten wording (`Bank_Bullet.text`, not the shown variant). Tailor
  rewrites bullets toward the posting, so the shown text would rank higher.
  Decide whether to rank the shown text instead.
- **A 0-score posting.** A posting whose description is empty
  (`tailor.weak_match`) scores every bullet 0, so the order falls back to
  position. Decide whether that resume should use today's order outright.
- **Skill levels on a base resume.** Level 1 (backed by a bullet) needs no
  posting. A later change could let a base resume cut skills by levels 1
  and 0 only.
