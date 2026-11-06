# Prompts and gates

Reference for Apply, reached from `apply-agent/CLAUDE.md`. Paths are relative to `apply-agent/`. A change in this area updates this file in the same PR.

## Prompts and gates

- Every prompt names the applicant as `@NAME@` and their school as
  `@SCHOOL@`; `applicant.as_applicant` puts in the profile's own values.
  Say "they" for the applicant, or `@NAME@` where "they" already means the
  company or the sources. Never write a person's name, pronoun or project
  into a prompt or its examples.
- `as_applicant` also adds the profile's `identity.pronouns` (default
  they/them/theirs) to each system prompt. Without them, Claude guesses
  from the name, and a plan or a reason can call a they/them applicant
  "he". Wrap each Claude call that writes about the applicant with it.
- The length gate (`gates.bounds`) reads a limit that the form states,
  also a hyphenated one ("500-word limit") and one with the unit first
  ("Word limit: 260", `gates.LIMIT`). Keep it in step with
  `essays.STATED`, which tells the writer that the form states a length.
- A word or character cap that the form states (`gates.caps`: each range's
  top, each limit in digits, the field's `maxLength`) always holds, also
  when `gates.bounds` reads another length first ("2-3 sentences" before
  "(max 260 words)"). An essay over a cap gets one shorter rewrite
  (`essays.SHORTER`). If it is still over the cap, the worker keeps it off
  the form and holds the Application (`gates.over_cap`). This applies to
  an essay that Lisul approved too. A form refuses a longer answer
  (MongoDB's 267-word letter, cap 260).
- An optional catch-all box ("Additional information", "Anything else
  you'd like us to know?", "Comments", "Other information": an
  `anything-else` question that the form does not require,
  `essays.catch_all`) is always left blank on purpose (Lisul, 2026-11-04,
  KAN-625). `_Planned.add` puts it in `_Planned.kept_blank`
  (`worker.CATCH_ALL_BLANK`) before any Claude call: Claude never drafts
  it, the Answer bank never answers it, and Needs you never asks it.
  Verifying notes it as blank on purpose and does not hold it, and it gets
  no "Claude wrote nothing" or High-stakes hold. A required catch-all box
  is still answered, briefly, as is every other optional question. Voleon's
  Ashby form showed why: KAN-601 let a new and relevant draft through to its
  "Additional information" box, and Lisul wanted nothing there.

- An essay that the editor's passes leave over the most that its length
  allows (`gates.length`: a stated sentence count, or its type's default
  when the form states none) also gets one shorter rewrite (`essays.CUT`)
  before the form is shown. If it is still over, it goes on the form, and
  its failed check holds the Application (Bedrock's 132 words of 120).
- The names gate (`gates.traced`) checks each run of capitalized words
  against the essay's sources: the drafting prompt (Story bank, Stock
  answers, Company material with the Company brief, the posting) and the
  question. A run that joins names the sources hold passes (`gates.held`):
  "MongoDB Intelligent Workload Management" is the company and a brief
  name, and "Hitachi Rail's CTO" is two Story bank names. A one-word piece
  must be in the sources with its capital.
- The not-on-resume gate (`gates.on_resume`) reads the text of the
  profile's resume PDF. With no PDF, or one with no text, the gate passes
  every answer; `apply doctor` shows this as "Not-on-resume gate: off".
