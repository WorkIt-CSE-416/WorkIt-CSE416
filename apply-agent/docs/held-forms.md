# Held forms: verifying, Resume, Regenerate, Ask Claude and Needs you

Reference for Apply, reached from `apply-agent/CLAUDE.md`. Paths are relative to `apply-agent/`. A change in this area updates this file in the same PR.

## Verifying a filled form (KAN-549)

After Apply fills a form, and before any submit, the Worker verifies it
(`worker._Planned.verify`, `verify.check`). This is the last part of the
Pre-submit check. It applies to rehearsals and to live runs. It only
reads: it does not click, type or submit.

- `apply_to(on_verify=...)` gets `None` when verifying starts, then the
  `verify.Verification`. The rehearsal and the Orchestrator send it to the
  window with `verify.verifying()`: the tile shows "Verifying…" with a
  spinner, then "Verified" with a check mark, or "Verified with N items
  that need you".
- Plain code makes the checks: a blank field that is not a Missing fact
  and not left blank on purpose (`_Planned.left`), the read-back
  (`fill_engine.readback_problems`), an empty file or a file in the wrong
  field, a value that is not one of the field's options, a graduation
  year that is not the profile's, a start date in the past, pay out of the
  posting's range (else off `compensation.fallback_hourly`), and in each
  essay a wrong pronoun or name for the applicant and another company's
  name (`verify.COMPANIES` and the policies' companies, less any that the
  sources or the posting name). Claude makes only the judgment checks, in
  the Pre-submit review call (`presubmit.SYSTEM`: contradictions, wrong
  answers); its findings join the flags.
- A review finding can name the right answer when the sources give it
  (`presubmit.Found.fixes`: an internship start in a school's From).
  Apply fills that answer in place of the wrong one (`_Planned.fix`). It
  then fills the form again, in a fresh page, and reviews it again, all
  before the window shows the form as ready. It does this once. A fix
  replaces only Claude's guesses (its drafts, and its drafts the Answer
  bank gave back). It never replaces an answer from the profile, Lisul's
  own answer, an essay, a file or a secret. A
  Claude draft that a fix replaces leaves the Answer bank. On Workday, the
  next fill goes Back to the step that holds the fixed answer
  (`WorkdayFiller._back_to_changed`). A read-back replan also refills
  this way.
- A flag that `holds` goes in the reason as `Verify: <field>: <why>` and
  holds a live run (Needs you, kind `check`). Read-back and review flags
  hold already by their own reason. A blank optional field holds as a
  blank required field does, also a voluntary self-ID field (Lisul's rule:
  a blank optional is a bug; the profile answers self-ID, a decline at
  least). Only an answer that Claude guessed (a new Answer bank draft, a
  Rescue) and a blank that the engine's plan meant are notes, which do
  not hold. The plan lists each field it leaves blank on purpose, with why
  (`Plan.blanks`: a duplicate "Other website", an "If other" follow-up to
  another pick, an optional fact the profile lacks); the note says why.
  An optional catch-all box that Apply left blank on purpose
  (`_Planned.kept_blank`, `docs/prompts-and-gates.md`) is a note too.
  An approved Hold is not held again by a flag; the read-back still holds
  it.
- In the window, each flag shows with its field and why, and has its own
  Dismiss (`POST /dismiss`). Apply keeps each dismissal for its
  Application in `APPLY_HOME/dismissed-flags.json` (`verify.dismiss`,
  `verify.dismissed`). A dismissed flag does not show after a window
  reload or in a new window (`verify.without_dismissed`), and it does not
  hold a new run of the same Application: `verify.check(dismissed=...)`
  keeps it in `verification.json` with `dismissed: true`. When every flag
  of a live run's Hold is dismissed, the Hold shows Approve.
- The Record keeps `verification.json` and a Verification section in its
  README.

**Tests.** `tests/test_verify.py`: a fake form with planted problems, a
clean form, a live run held by a flag, a dismissed flag in the window and
in a new run, a blank the engine meant, and the window's states.

## Resume a paused rehearsal (KAN-551)

A rehearsal that stops mid-form for Lisul does not end. It pauses on its
open page, and he fixes the page himself. Then he presses Resume, and Apply
goes on from the step that the page shows.

- A pause is a Handoff that `apply_to(on_pause=...)` gets in a rehearsal:
  while the Filler reads its questions (a Workday sign-in) or while it
  fills (a step that Workday will not leave, a pop-up, Claude fill's Next).
  `rehearsal._rehearse` shows it on the tile as its status (handoff, needs
  sign-in) with `resume={"ok": True}`, and the hold of the paused page
  (`_Kept.hold(resume=...)`) waits. The paused link gives back its Worker
  turn (`gate`) while it waits.
- Resume (`POST /resume`, `Board.resumed`) comes back on the same tab. The
  submit guard goes on again with `submit_guard.rearm`, with no reload, so
  his fixes stay. The fill loop then calls `filler.fill` again, with the
  same plan and Filler state. Apply never starts over, never submits, and
  never asks for a new code.
- His fixes: the Filler's `resumed(page)` reads the values of the step
  shown. The Workday Filler does not fill those fields again on that step,
  and `_Planned.keep` keeps each value that differs from Apply's answer as
  his answer (`_Planned.lisuls`). A Missing fact that he answered there
  waits on him no more. A Filler with no `resumed` keeps nothing (Claude
  fill does not type a field again that it filled already).
- A Filler's `resume_blocked(page)` says why Resume cannot go on yet. The
  Workday Filler says so until the page shows an application step (on
  Workday's or Google's sign-in page), so Resume never signs in or asks
  for a code. The why shows on the button, and the pause stays.
- **Signing in carries on by itself (KAN-670).** A form paused at a sign-in goes on with no Resume
  and no Fill again once Lisul has signed in on the page. The check is the Filler's `signed_in(page)`,
  the one its own sign-in makes, so the fill from there signs in no more: Workday's `_on_step`, and
  Oracle's `oracle.signed_in` (Claude fill's `signed_in`). `worker.ResumeCheck` carries it with
  `resume_blocked`. It goes on only when the page showed a sign-in first and `resume_blocked` is "".
  It never types into a sign-in page. A Filler with no `signed_in` waits for Resume, as before.
  A captcha on the page (`captcha.pending`) stops it for the rest of the pause: the tile says
  `rehearsal.CAPTCHA_SHOWED`, and Resume is his. The history says "Went on by itself".
- A tab that closed, or a rehearsal that ended, makes `resume={"ok": False,
  "why": ...}` (`rehearsal.TAB_CLOSED`, `ENDED`). The button stays, turned
  off, and says why. Fill again still fills the form anew.
- Each pause and Resume is a line in `Rehearsed.history`, on the tile and
  in the Record's README (Pauses), and an event in the Trace.
- The window: a paused item in Needs you and its tile in Live show a
  Resume button (`.primary`), before Fix here and Open in Chrome. Both
  send `POST /resume` (`Dashboard.resume`, with the window's token). An
  item whose form fills again waits on him no more. A Resume that cannot
  go on is a 409 with the why, and the button is turned off with the why
  beside it (`.then` on the card, `.why` on the tile).
- Live runs do not pause. A run's Handoff ends, and its Worker moves on.

**Tests.** `tests/test_resume.py`: the fake Workday stops on a required
Degree; Lisul picks it on the page, presses Resume, and the form goes to
Review with no submit. Also a closed tab, the `/resume` route, and the
window's card and tile. `-k by_itself`: Lisul signs in to Google on the paused page and the fill goes
on with no Resume; a captcha there stops that. Run it with `-k`; it opens Chromium.

## Resume while a rehearsal fills (KAN-594)

Lisul is never left on a form with no way to make Apply go on.
`src/apply/stuck.py` holds the rules.

- The tile says what Apply is doing while it fills (`stuck.doing`, the
  caption's `doing`): its banner ("Filling · Planning answers for
  'Application Questions'") and its detail line. The Worker says it at each
  step: reading the questions, planning a step, reading the company's pages,
  researching the company, writing answers, filling. A Filler that names its
  step has `step` (Workday's).
- A filling tile offers Resume (`Dashboard.state`, `stuck.why`) when:
  Apply waits on Claude (`stuck.Waits` wraps the rehearsal's Claude: each
  `ask` and `research`, not Claude fill's `drive`); the page shows a job
  system's field error (`stuck.FIELD_ERROR`, as data: Workday's
  errorHeading and errorMessage, an invalid field's message, `role=alert`,
  a class that says error; read every 2 s by the window's own CDP
  connection, `CdpFrames.field_error`, so it is seen while the Worker
  waits); or no progress for `STUCK_AFTER` (45 s: past a Filler's longest
  single wait, 30 s). A form held for Start, or verifying, offers none.
- Resume there: a wait on Claude stops at once (`claude_cli` kills its
  `claude -p`, and `stuck.Stopped` is raised); else the press is taken at
  the fill loop's next turn, or at the next pause. Then `go_on` keeps what
  Lisul put on the page (the Filler's `resumed`, `_Planned.keep`), and the
  fill goes on from the page. Questions Claude had not answered yet are
  his (`_Planned._to_lisul`): left as he filled them, or blank and listed
  as Missing facts. It never submits and never asks for a new code.
- Only a `stuck.stoppable` step stops a wait: planning a step
  (`worker._plan`), the fill, the read-back's re-plan. Outside one, a wait
  goes on to its end, and Resume is not offered for it.
- Each such Resume is a line in the history ("Resumed: you pressed Resume
  while Apply was planning answers for ..."). Live runs have no watch.

**Tests.** `tests/test_stuck.py`: the fake Workday's essay step waits on
Claude; Lisul types his answer and presses Resume, and the form goes to
Review with his answer and no submit. Also each reason a tile offers
Resume, the `/resume` route, the field-error check on each job system's
error shapes, and a killed `claude -p`. Run it with `-k`; it opens Chromium.

## Add context and regenerate (KAN-599)

`src/apply/regenerate.py`. While Lisul reviews a rehearsal's held form, each
answer that Claude wrote for that Application has a small "Add context and
regenerate" button. He types what Claude should know or change, and Claude
writes that one answer again.

- **Which answers.** `regenerate.form_of` (the Worker's `Result.regenerable`,
  rehearsals only) lists each essay, Answer bank draft and company-only
  one-off that went into a text field. A profile fact, a pick from a list, a
  file and Lisul's own Answer bank answer get no button.
- **On the form (the main place).** When the page is lifted for Lisul
  (`_Kept.hold`), `regenerate.offer` draws the button over the page, above
  the field's top right. It is on the page's body, fixed, never inside the
  form, so the page's own code never sees a new node. A scan every 500 ms
  finds the field again (the field that shows Claude's text, else its id or
  name). The Live tile streams the same page, so the button works from the
  window too. A press calls the `__applyRegenerate` binding; the hold loop
  takes it on its next turn.
- **In the window.** A Needs you card lists "What Claude wrote" with the
  same button and a context box (`POST /regenerate {id, name, context}`,
  with the window's token). `Dashboard.regenerate` refuses no context, an
  answer Claude did not write, a form that fills again, and one already
  being rewritten. `Board.regenerations(k)` hands each press to the hold
  loop once.
- **While it runs.** The field is read-only and dimmed, and the button says
  "Claude is rewriting this answer". The tile's `written` entry has `state:
  working`. Nothing is clicked or sent.
- **How it writes.** His context joins the Story bank first, under "Added
  while reviewing answers", as one line that names the question (and
  `asking.where` for a bare label) and the company: never a bare label
  alone. Then `essays.answer` runs with `redo={question: (old, context)}`:
  the plan and the draft both get a `<redo>` block (`essays.REDO`,
  `REDO_PLAN`). It is the usual path: the same sources, plan, editor, code
  gates and caps. A form that read no Company material reads it now
  (`company.gather`, `brief.brief`) for an essay or a company question.
- **What stays off the form.** An answer over the form's cap
  (`gates.over_cap`), or with a name or number no source holds
  (`regenerate.INVENTED`), is not put on the form. The old answer stays and
  the note says why. Other gate and verifier flags (`verify.essay`) go on
  the note beside the field.
- **After.** Plain code sets the field with the page's own input events and
  reads it back (`regenerate.done`). The field is editable again. The
  Record is saved again: `answers.json`, `essays.md` and a history line
  ("Regenerated '<q>' with your context"). A draft in the Answer bank is
  replaced (`AnswerBank.redraft`: still Claude's, unreviewed). Lisul's own
  answer and a bare label are never replaced.

- **On a plain Worker (KAN-615).** The button, its context box, the field's
  lock and the read-back are fixed functions (`regenerate.OFFER`, `WORKING`,
  `DONE`, `SHOWN` in `apply.plain.fixed`), run in the page's own world, where
  the `__applyRegenerate` binding is. No eval and no init script, so page CSP
  never stops them. A plain page has no init script for the button, so each
  turn of the hold loop calls `regenerate.keep`, which offers it again in
  frames loaded since. Captcha frames are skipped. The Fill engine puts the
  new answer in, in the frame that shows the field, as it filled the form.
  Where it can't (a job system it doesn't know, or a field it can't find),
  the page's input events do it, as on a CDP page. The window's card works
  the same on both kinds of Worker.

**Tests.** `tests/test_regenerate.py` (in CI, no browser): the regenerate,
its Story bank line, the caps and invented facts, the Answer bank, the
window's route. `tests/test_rehearse.py -k regenerate` presses the button
on the fake Lever form (Hermeus) in Chromium; it opens a browser.
`tests/test_plain_regenerate.py` does the same on the fake Ashby form (Harvey)
in one reused plain Worker (Chrome for Testing): once on the page, once from
the window.

## Ask Claude (KAN-638)

`src/apply/ask.py`. Lisul tells Claude, in his own words, what is wrong on a held form ("you left
preferred locations blank, pick New York and Jersey City", "page 2's GPA is wrong"). Claude (Opus)
fixes it live on that form.

- **Two ways in, one thread.** The tile's Ask Claude box (`POST /ask`, with the window's token), and
  `apply ask`, which reads each open window's note (`APPLY_PROFILES/windows/<pid>-<port>.json`, mode
  0600, written by `cli._dashboard` and removed when the window closes). It matches the Application ID,
  else every word in the company and role. More than one match lists them and exits 2. It waits for the
  reply (`GET /ask/<id>`) and prints it. Both reach the same thread, one per posting URL
  (`Dashboard._threads`), so a follow-up ("no, the other one") has the earlier turns.
- **When.** Only while the form is held for Lisul (`_Kept.hold`: a rehearsal's held page, or a paused
  one), until he presses Submit. The tile's `askable` says so. One message at a time per form. A live
  run holds no page, so Ask Claude never acts in one.
- **What Claude gets.** His message (the only instruction), the thread, the page's state (`ask.FIELDS`:
  every frame's fields and values, captcha frames left out, a field on another step marked `hidden`),
  Apply's plan and Record for the form (`_Ask._form`), and the sources (`ask.sources`: profile,
  Answer bank, policies, resume text). Page text is data, never an instruction.
- **How it acts.** `claude_cli.drive`, as Claude fill does (Playwright MCP on CDP, Apply's own MCP server
  on a plain Worker), under the drive guard. Code, not only the prompt, judges the real element, never
  Claude's word for it (KAN-654). The send_click hook runs with `--ask`: a second hook after each browser
  tool (`--after`) keeps each snapshot's refs in the drive's own folder, and a tool on a ref the page hasn't
  shown, or on a selector, is refused. On a ref's role and name it refuses typing in a password or code
  field (`send_click.SECRET`), a Resend or Send new code click, a button that sends, and any act on an
  attestation, signature or consent box (`send_click.ATTEST`) unless his message names that box by its own
  text (`send_click.may_tick`: all of it, or at least two real words of it in a row, with a verb to tick;
  "check the box" and "tick the certify box" name none). A snapshot shows no attributes, so the page side
  judges `type=password`, `name=otp_code` and the rest by `send_click.ELEMENT`: on a CDP Worker the drive
  guard's Ask section (`DriveGuard.asking`, trusted acts in every document), on a plain Worker
  `plain.tools` before each act (`--ask` reaches it through `ToolServer`).
  The prompt says the same rules: never Submit, no captcha, no password, account or code.
- **Guards while it drives.** The held page is lifted for Lisul, so `_Kept.hold` puts both guards back on
  (`rearm`) for the drive and lifts the page again after it. Without that, a page the drive loads (going
  back a step) ran `lift()`'s script, and Enter there sent the application (KAN-638). So Claude's own click
  on a step's Next or Back that posts natively is blocked too. Claude names that button in `press` and
  stops; plain code presses it (`claude_fill.press_step`, the rules of Claude fill's Next: KAN-639, with the
  final-URL block) and a fresh drive goes on from there, up to `MAX_PRESSES` for one message (KAN-655).
- **Read-back.** Plain code reads `FIELDS` again after the drive and compares (`ask.changes`), custom
  `[role=checkbox]` and `[role=switch]` boxes too (`aria-checked`, and `UNDO` clicks one back). Each change
  is marked "Apply read it back" or "Claude's read-back". An attestation box that changed without his ask
  is put back (`ask.UNDO`) and named under Couldn't. `FIELDS` and `UNDO` are fixed functions on a plain page.
- **After.** The reply goes to the thread (what changed, what Claude couldn't do, what waits on him). A
  fact he stated is an offer: "Save to my answers" (`POST /ask/remember`) saves it as his Answer bank
  answer. That route needs the window's own Origin, so `apply ask` can't save it. A fault of Apply's own
  (`apply_bug`) is a Repair request (`ask.repair_requests`). His message and the fix go in the Record
  (`asks.json`, the README's "Ask Claude" section, history lines, and the changed fields' on-page answers).

**Tests.** `tests/test_ask.py` (in CI, no browser): the hook's Ask mode, the read-back, an attestation
put back, the window's routes, `apply ask`, and the Record and Repair request.
`tests/test_dashboard.py -k ask_claude_box` types in the tile's box in Chromium.

## Page gates (KAN-637)

Lisul checks each page that holds his legal or personal answers before the
form goes on. `policies.yaml: page_gates` turns this on (default off).

- Claude fill's fill session gets `claude_fill.GATES`. It reads each field
  back against the planned answers and fixes it once. It never ticks an
  attestation, consent or agreement box, and never types a signature or a
  date of signature. It lists in `for_lisul` each field on the step that he
  must check: those boxes, consent, self-ID, work authorization and the other
  legal answers, conflicts, criminal history, and any answer Claude is not
  sure of.
- A step with such a field is a Handoff before its Next, or before the last
  step is held: "Page N: check these ... then press Resume". In a rehearsal
  it is a pause (KAN-551). His Resume approves that step (`_approved`, keyed
  by `_step_key`: the URL and the fields it shows), and the fill goes on.
  A live run hands off.
- Oracle and Workday have no gates yet.

**Tests.** `tests/test_claude_fill.py -k page_gates`.

## Asking Lisul a question (`apply.asking`, KAN-527)

Every question that reaches the Needs you tab (a Missing fact, an Essay
fact, a one-off that Claude left for Lisul, a Handoff's questions) passes
through `worker._Planned._missing` first.

- `asking.known(asked, profile, bank)` is the never-ask-twice check. It
  looks in the profile's `answered_questions`, the Answer bank, the Story
  bank (an earlier Essay fact's answer) and the applicant's links. A link
  question is known when each kind that it names (GitHub, LinkedIn, a site,
  a repo) is among the links. A known text field gets that answer
  (`_Planned.found`), and a known ask is dropped.
- `asking.links(profile)` is the profile's `links`, each Story bank line
  with a URL, and each web link on the resume PDF with the words it is on.
  Essays get them as `<links>` (`essays.sources`). An Essay plan's slot
  that asks for a known fact is backed by it instead (`essays._backed`).
- `asking.where(q, questions)` is the one context line of a form question:
  its step (a Workday name is `<step> / <label>`), the question before it
  when its label is bare (3 words or fewer), and its pair (From with To).
  `asking.for_essay` names an Essay fact's essay and what its answer does.
  The engine reads no group legend for a plain field, so the line uses only
  these. The line goes in `Result.where`, the window's card (`.where`), a
  Handoff's "Answer 'X' too (line)", the Tracker reason
  (`Missing fact: <q>; In: <line>`) and the phone push.

**Tests.** `test_claude_answers.py -k already_holds` and
`test_dashboard.py -k says_where_it_sits` (opens Chromium).

## An answer from the window, on a held form (`rehearsal._fill_answer`, KAN-686)

Lisul's answer to a held form's question is filled by a Rescue: Claude
puts that one answer in its field, under the drive guard. It tries the
step showing first. A form in steps may have saved an earlier step
without it (TAL.net goes on past a required blank), so on a miss the
Rescue tries once more with `elsewhere`, the step the form is held on
(its title). Claude then goes back with the form's own Back button or
step list, fills the field, saves that step with the form's own Save
or Next, and comes back to the held step (`SYSTEM_ELSEWHERE`). The drive
guard still blocks a button that sends the application. When the form
ends on another step, the run says which one, so Lisul goes back to it.

**Tests.** `tests/test_rescue_elsewhere.py` (in CI).

## Needs you on the page: Go to question, and answers typed there (KAN-600)

`src/apply/on_page.py`. Lisul can answer a Missing fact or an Essay fact
on the held form itself, not only in its Needs you card.

- **Go to question.** Each question of a card whose form is still held open
  in its Worker's browser (a rehearsal's, ended or paused:
  `dashboard.on_form`) has a Go to question button. A form still filling
  has none: Apply drives it. `POST /goto {id, question}` brings the
  Worker's Chrome to the front (`site.show`). The window opens the form's
  tile when the Worker has no window of its own. The request waits
  (`GO_TO_WAIT`) for the held page's hold loop (`Board.wanted`): Playwright
  answers only on the Worker's own thread. There `on_page.go_to` scrolls to
  the field, focuses it and outlines it for `OUTLINE_S`.
- The field is found in each frame of the page: by the job system's id or
  name, else by its label (Lever's labels are divs). A Workday name is
  `<step> / <panel> / <label>`: the nearest panel that names a part of it
  wins. Apply's own note on the page is never a field. An Essay fact's
  field is its essay's (`asking.for_essay` is its context line).
- A field on another Workday step is not on the page. Apply says which step
  holds it and moves nothing, so nothing filled is lost. Lisul goes there
  with the form's own Back or Save and Continue.
- **An answer typed on the page** (the bug this fixes: before, only an
  answer from the card left Needs you; the hold loop never read the page).
  `on_page.Watch` reads each waiting field on every turn of the hold loop
  (`_Kept.hold(tend=...)`). What the field showed when the watch began is
  Apply's, never his answer. A changed text field is his answer once he
  leaves it (blur) and it rests `IDLE_S`, or rests `TYPING_S` with the
  caret still in it. A pick (a list, a radio button, a box, a date) counts
  once it rests `IDLE_S`. The value is the engine's read-back where the
  engine fills that job system, else what the page shows.
- Then `rehearsal._answered_on_page` saves it as a card's answer is saved
  (`Board.typed`, then the window's `answer`: `cli._answering`), so it
  joins the profile, or the Story bank for an Essay fact. All the Essay
  facts of one essay are saved as one Story bank line. The card leaves
  Needs you, the tile's counts and the note on the form change, and the
  Record (its plan and read-back) is saved again (`_record_again`).
- A bare date (From, To, Start date: `on_page.bare`, the engine's
  `contextFree` when the pin has it) is never saved by its label, from the
  card or the page. It stays that form's answer only (KAN-595).
- Nothing is read off a page after Lisul pressed its Submit.

**Tests.** `tests/test_on_page.py`: Go to question and a typed answer on the
fake Greenhouse, Go to question on a paused fake Workday step, finding a
field by its label and panel, the rest rules, and the window's `/goto` and
`typed` (opens Chromium).

## Fill again from outside the page: `POST /fill-again` and `apply fill-again` (KAN-672)

Agents and Lisul can press Fill again without a click in the Worker's page:

```
uv run apply fill-again 54321            # the window's port, when it holds one form
uv run apply fill-again <application id>  # the form on that tile
```

- `POST /fill-again` takes `X-Apply-Token` and `{"id": "tile-0"}`. `Dashboard.fill_again` accepts it only
  while the tile's `askable` is on: a rehearsal's held or paused page, before Lisul presses Submit. Else it
  is a 409 or a 404 with the why.
- `_Kept.hold` takes it at its next turn (`Board.fill_again_asked`) and returns AGAIN, as the page's button
  does. The form fills anew under the same guards. It never submits.
- A port with several held forms is refused, and the error lists their Application IDs. `into.fill_again`
  never guesses. The command then waits for the new fill to stop and prints how it stopped.
- Tests: `tests/test_into.py` (in CI), `tests/test_rehearse.py -k fill_again` (Chromium).

## A fresh page is guarded before its first load (KAN-682)

Fill again, and each rehearsal's first page, opens the link in a fresh page.
`_Kept.open` opens it inside `submit_guard.guarding_on_open()`. The Worker
browsers (`browsers.py`) and plain Workers (`plain/site.py`) then call
`submit_guard.on_open(page)` before they navigate, so the rehearsal's guard is
on before the page's own code first runs. `guard()` then needs no reload.
Before this, the page loaded once with no guard, and a page whose own script
sent the application as it loaded sent it then. The test fakes don't call
`on_open`: they are guarded after the load and reloaded, as before. A live
run's page is not opened inside `guarding_on_open`, so nothing changes there.
`tests/test_submit_guard_hostile.py` has the case.
