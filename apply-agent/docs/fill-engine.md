# The Fill engine in Apply

Reference for Apply, reached from `apply-agent/CLAUDE.md`. Paths are relative to `apply-agent/`. A change in this area updates this file in the same PR.

## The Fill engine

Apply loads the engine bundle from the extension's submodule:
`autofiller_extension/fill-engine/dist/engine.js`. Apply has no submodule
of its own, so one engine pin serves both. To use another engine checkout
(for example, a branch of the engine that you work on), set
`APPLY_FILL_ENGINE` to its folder (`~` is expanded). Apply then loads
`dist/engine.js` from that folder. The tests read the saved forms
(`test/fixtures/`) from the same folder. The repairer works on the submodule path in its Repair worktree.

Run `git submodule update --init` once per checkout. Without it, Apply
cannot fill a form, and `uv run apply doctor` says so.

Apply adds three rules to the engine's plan (`fill_engine.plan` and
`worker._Planned.add`). They stay in Apply: each one is about Claude (what
it drafts, the forms that Claude fill reads) or about Apply's own
read-back. The engine's `fillEach` already accepts the wording that a
try-list picked, so the extension needs none of them.

- A secret question (a password) is never sent to Claude to draft. It
  stays blank for the Filler. `records.SECRET` finds it. A security clearance
  question ("Top Secret clearance?") is not a secret.
- A Workday try-list answer (`a|b|c`) accepts each of its wordings in the
  read-back, because the fill takes the first one that it finds. Only the
  How did you hear question (and a "Details" list right after it) gets a
  try-list; another answer with a `|` must show whole. Which question is
  the How did you hear one is the engine's answer (`asksHowHeard`, from its
  own `HOW_HEARD`): Apply keeps no copy of the pattern.
- A form that Claude fill reads is planned with the company and role that
  its page names, when the link names none.

The engine's plan names each field it leaves blank on purpose, with why
(`fill_engine.Plan.blanks`). On Greenhouse's self-ID block, a race to
decline is one when Hispanic/Latino is answered: picking race's decline
there sets Hispanic/Latino to the decline too and hides race.

A How did you hear answer that Lisul recorded (the profile's
`answered_questions`, or his own Answer bank answer, under any how-heard
wording) wins in the engine's plan on every form that offers it. The
company's-own-site order applies only when none is recorded (Lisul,
2026-11-02).

An Answer bank entry with `answer: []` and `none: true` answers a
multi-select with none of its options (Roblox's partner organizations):
its boxes stay unticked, a blank on purpose in the plan.
`AnswerBank.answer(question, [])` saves one; an answer with options in it
drops `none`. An empty answer without `none` is still no answer.

Apply adds the Tracker to the facts that it gives the engine's plan
(`fill_engine._facts`). Each company with a submitted Application, except
the Posting being filled, joins `screeners.previously_applied_to` when the
profile keeps that list. A company where Lisul's Outcome is an interview
or an offer goes in `screeners.previously_interviewed_at`. So "Have you
previously interviewed at <company>?" is No when no record shows an
interview there. If he applied there but no interview is recorded, he
answers it himself.

A bare date (From, To, Start date, End date: a label that does not say
what the date is for) is answered for its section (KAN-595). The engine
finds the section from the field's panel, its help text, the heading or
intro just before it, or the questions before it. The section is
education, work experience or availability (`Plan.sections`). Claude
fill's questions carry no heading of their own, so plain code reads the
heading over each bare date off the page into its `section`
(`claude_fill._with_sections`, KAN-685), never the form's error notice
("There is a problem"). The questions listed before it may be an earlier
step's (TAL.net's "Role preference" read as a job's). The plan
answers a school's or the internship's dates itself. Claude drafts any
other bare date and is told its section (`"about"` in the draft call); a
date that nothing places goes to Lisul. The Answer bank files a bare
date's answer under its section and label
(`"education / From (MM/DD/YYYY)"`, `Plan.filed`). A date that no section
places is never banked. An older entry filed under a bare label alone is
never read again. Lisul's own answer to a bare date applies to that form
only; Apply does not save it to the profile by its wording.
