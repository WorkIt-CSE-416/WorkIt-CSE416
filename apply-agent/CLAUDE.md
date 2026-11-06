# CLAUDE.md — Apply

Loaded on top of the root `../CLAUDE.md` when you work in `apply-agent/`.

## What Apply is

Apply is a command-line agent that applies to job postings for one person.
It reads a job posting, fills the application form in Chrome through the
Fill engine, writes the answers and essays with Claude, and shows the Apply
window (Start, Needs you, Answers, Accounts). A rehearsal fills the form and never
submits. It runs on the person's own Mac, with their own Chrome and their
own Claude Code login. It is a developer and power-user tool, not a student
feature: students apply through the extension and the connector (KAN-369).

Apply has its own domain language. Read `GLOSSARY.md` and `docs/adr/` here,
not the root ones, for its terms (root `GLOSSARY-MAP.md`). Write each
glossary entry in ASD-STE100 wording: sentences of 25 words or fewer.

## How it differs from `auto-apply/` and the extension

- `auto-apply/` is the design document for WorkIt's auto apply (KAN-223)
  and its rehearsal records. It holds no runnable code.
- `autofiller_extension/` is the Chrome extension that students install. It
  fills forms in the student's own Chrome; Scout and the connector write its
  answers, and the WorkIt backend keeps its state.
- `apply-agent/` is a Python program (uv, Playwright) that runs its own
  Chrome workers. Claude writes its answers. Its state is files in the data
  folder, not the WorkIt database. It calls the WorkIt API only through
  the WorkIt client (next sections), as the signed-in student.

Both Apply and the extension fill forms with the same Fill engine (next
section). A fix to how a field is read, planned from the profile, filled
or read back goes into the engine, not into Apply. Apply's own plan rules
(next section) are Apply-side checks, not fill fixes: they decide what
Claude may draft and what Apply's own read-back accepts, and the extension
has neither.

## Reference by area

These files hold the detail of each area. Read the one that matches your change.

- **Fill engine:** read before you change Apply's plan rules, `fill_engine.py`, or what the plan answers from the Tracker, the Answer bank or a bare date. `docs/fill-engine.md`
- **WorkIt:** read before you change a WorkIt call, `apply login`, `import-sheet`, `clean-tracker`, a Tracker write, the already-applied check or the tailored resume. `docs/workit.md`

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
  (`_Planned.kept_blank`, below) is a note too.
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
window's card and tile. Run it with `-k`; it opens Chromium.

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

**When Lisul reports a problem with an open application in a Claude Code chat, send it to the form with
`uv run apply ask "<company, role or application ID>" "<his words>"` (from `apply-agent/`).** Do not
open or drive the form yourself. `uv run apply ask --list` lists every open form. Print the reply to him.
Never press the offer's Save for him: only his click in the window saves to his sources.

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

## Claude fill

- Claude fill stops at the form's last step and names the button that
  sends; it never clicks it. A PreToolUse hook (`apply.send_click`, passed
  with `--settings` in `claude_cli.drive`) refuses a click Claude names as
  that button, with word to stop. A click the drive guard still blocked on
  the button Claude then names as the submit leaves the form filled
  (`claude_fill._only_its_submit`); any other block is a Handoff.
- Only what the drive guard blocked during that drive stops it. A block of
  an earlier drive was its Handoff already: after Lisul's Resume, the next
  read or fill goes on (LinkedIn's SmartRecruiters page posts a form of its
  own while Claude reads it).
- A careers page that embeds a Greenhouse form goes to the Greenhouse Filler
  (`greenhouse.board_behind`): by `?gh_jid=`, or by a job id in its path
  that the job API says is shown on that same host (Roblox). Failing that,
  `embedded.form_behind` opens a page of no known job system, reads its
  frames (after one click on its Apply button outside any form) and sends an
  embedded Greenhouse, Lever or Ashby form to that system's Filler. Claude
  fill is only the fallback.
- A profile pop-up before the application is never the form's last page
  (KAN-647). When the button Claude names as the one that sends sits in an
  open dialog that is a profile step and nothing more
  (`submit_guard.PROFILE_DIALOG`: titled "Create your profile" or the like,
  naming no application, job or role; no file, essay, box, choice or
  password in it; and no form field of the page's own behind it), and the
  button names no application, plain code presses it
  (Microsoft's names it Submit; `_through_profile_step`) under
  `DriveGuard.let_profile_click()`, which lets that dialog's button through
  the drive and rehearsal guards and nothing else, waits for the dialog to
  go, and the fill goes on to the real form. The flag is
  `__applyProfileClick` (in `worker-extension/ops/guard.js`'s `FLAGS` too).
- A POST to a final application URL stays blocked under plain code's Next and profile clicks (KAN-639,
  `postsFinal`). A path ending in `/apply` is final by its name alone, so there a Next goes on only when
  the page says steps remain ("Step 2 of 5", or a list past its `aria-current=step` item) and the form has
  no button that sends (KAN-656). A profile pop-up may post to its own page there. A known final URL
  (Lever's, Greenhouse's, a segment with `submit`) never goes, whatever the page says. TAL.net's
  (`/eform/<n>/page/<k>`, `save_page`), Oracle's (`/apply/section/<n>`, `/apply/email`), iCIMS's, Workday's
  (`/apply/applyManually`) and Microsoft's (`/careers/job/<id>`) URLs match no final rule at all
  (`tests/test_submit_guard.py -k every_real_step`). On a plain Worker the declarativeNetRequest rule on
  `/apply` still blocks such a step (it can't read the page), so that Next hands off and nothing is sent.
- Before each Next, plain code checks what the step shows (`cant_be_right`, KAN-652): an address part
  holding a whole address, or a school's start year after this one. A bare "Start date" beside school
  fields may be the internship's, so it stops the fill only in a section headed clearly as education
  (`_sections`, `clearly_education`) or at a year past `PLAUSIBLE_YEARS` (KAN-659).
- Dropdowns that list their choices only once opened are read and picked
  by plain code (`_with_options`, `_pick_in_comboboxes`). Each one's name is
  read off the very element Playwright clicks (`_comboboxes`), never from a
  page script's own list: the two counted visibility apart on Microsoft's
  profile step, and each question opened its neighbour (KAN-646).
- On a plain Worker (KAN-612; a PortPage, no CDP), `claude_cli.drive` gives
  `claude -p` Apply's own MCP server under the same name, `playwright`
  (`apply.plain.mcp`, a stdio relay, and `apply.plain.tools`, which runs
  each tool on the page through the Worker's port). Its tools are Playwright
  MCP's, by name and input (`apply/plain/mcp_tools.json`, from
  @playwright/mcp@0.0.83's own list), so the prompts, `BROWSER_TOOLS`,
  `NO_BROWSER_TOOLS` and the `send_click` hook don't change. Keep that file
  in step with `PLAYWRIGHT_MCP` when the pin moves. Dialogs are answered as
  they open (`browser_handle_dialog` sets the next answer), and a file is
  attached only to a chooser a click opened and only from the drive's own
  folder. The CDP-only calls and their stand-ins are listed in
  `docs/plain-workers/PROTOCOL.md` ("Ops (S6)"). Test with
  `tests/test_plain_claude.py`; its two real-Haiku tests run only with
  `APPLY_LIVE_CLAUDE=1`.

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

## Captchas and bot blocks (KAN-527)

`src/apply/captcha.py` is the one place that tells a captcha. Add a new
challenge there, as data, not in a Filler.

- `CHALLENGES` lists the selectors of each challenge that a person solves
  and that goes away when solved: reCAPTCHA's and hCaptcha's picture
  frames, DataDome's slider (SmartRecruiters' "Verification Required"),
  Arkose Labs, and Rippling's Turnstile box. `captcha.shows(page)` reads
  them. Do not list a checkbox that stays on the page after it passes.
- `SAYS_CAPTCHA` reads Claude fill's why when Claude stops at a captcha.
- `HOSTS` and `PATHS` name the hosts of the challenges' frames. The submit
  guard and the drive guard do nothing in such a frame, so Lisul can do
  the captcha: DataDome's frame posts its own form, which the guards
  blocked as "a form submission".
- A captcha's challenge in a frame that shows a Bot block (next section)
  is no captcha: `captcha.shows` is False there.
- Apply never evades bot detection and never touches a captcha. It hands
  captchas and blocks to the student.

**Bot blocks go to the student's own Chrome (KAN-590).** A Bot block
(`GLOSSARY.md`) is a page that refuses the Worker's Chrome, with nothing
to solve. The student finishes the form in their everyday Chrome.

- `captcha.BLOCKS` holds each block's words, as data: DataDome's "We
  detected unusual activity from your device or network" (in its
  captcha-delivery frame, LinkedIn's SmartRecruiters form), Lever's "There
  was an error verifying your application" (hCaptcha turning the sent
  form's token down, Simbe Robotics) and Akamai's "You don't have
  permission to access" (Tesla's Access Denied). Add a new block there.
  `captcha.blocks(page)` reads them in the page and each of its frames.
  `SAYS_BLOCKED` reads the same words, and "access denied", in Claude
  fill's why.
- A block is one Handoff kind, `model.Blocked` (Bot signal `blocked`),
  made by `captcha.blocked(company, url, said)`: "<Company> blocked Apply's
  Chrome as a bot ("<words>"). Finish <Company> in your Chrome: the
  extension fills it". Claude fill raises it, `wait_for_confirmation` raises
  it at a submit (Lever), and the Worker turns any Handoff whose page shows
  a block into one (`captcha.as_block`), before a captcha wait.
- It is a Handoff at once: never a captcha wait, never a pause for Resume
  (Resume would only try again), no second sign-in and no new code.
- Live run: `_Run._to_everyday_chrome` opens the posting once with `open
  -a "Google Chrome" <url>` (`captcha.to_everyday_chrome`, the
  `Adapters.everyday` adapter; tests pass a list's `append`) and pushes
  "Finish <Company> in your Chrome: the extension fills it" (ntfy, only
  with `phone_push` on). Never open it over DevTools (CDP), and never in a
  profile under `APPLY_PROFILES`: the student fills this form themselves.
- Rehearsal: Apply opens nothing by itself. The Needs you item (kind
  `blocked`) has Open in my Chrome (`POST /everyday`, with the window's
  token), and only that press opens it. A live run's block, read back from
  the Tracker by its Bot signal, gets the same button. After Lisul's own
  Submit on a held page, a block (`captcha.blocks`) makes the tile the same
  item.
- The row stays a Handoff, so WorkIt keeps it at Needs you. Only the
  extension's submit proof marks it applied.

**Lisul does the captcha, and Apply goes on.** A captcha that stops a fill
is a `model.Captcha` (a Handoff with its page). Claude fill raises it when
Claude stops at one (`SAYS_CAPTCHA`).

- `apply_to(on_captcha=...)` gets it first, in a run and in a rehearsal,
  while Apply reads the questions and while it fills. `captcha.Waiter` is
  that wait: the tile shows "Do the captcha" (status handoff, `captcha:
  True`, kind `captcha`) with Resume, and the phone gets one push per
  Application, "Do the captcha on <company>" (the ntfy path of `apply
  push-test`, only with `phone_push` on).
- The wait polls the page each second (`captcha.wait`). It ends when the
  challenge that showed is gone, or when Lisul presses Resume (`POST
  /resume`, `Board.resumed`). Then the Filler reads or fills again, on the
  same page, with the same plan. The page keeps the submit guard on.
- After `captcha_wait_minutes` (policies, default 15), or when the tab
  closed, it is the usual Handoff: a run's ends, a rehearsal's pauses
  (KAN-551). `0` hands off at once; the test policies set 0.
- At the submit, in a live run: a captcha after the click goes to the same
  wait (`captcha.at_submit` around `filler.submit`, read by
  `confirmation.wait_for_confirmation`). Once Lisul did it, the wait for
  the job system's confirmation starts again, and the Application is
  Submitted through the usual submit proof. If he does not, it is the
  Handoff that it was before.
- In a rehearsal Lisul presses Submit himself. A captcha after his press
  (`_Kept.hold`, `challenged`) gets the same push, once, and the tile
  shows "Do the captcha" (`captcha.AFTER_HIS_SUBMIT`). He does it himself;
  Apply never touches it. The form's confirmation then keeps the
  Application as submitted, as for any submit of his.
- An invisible captcha can also pass the browser a token that the job
  system then turns down, with no challenge to do: Lever's "There was an
  error verifying your application" (Simbe Robotics, 2026-11-03).
  Apply does not try to change that answer. It is a Bot block (above). A
  second Submit from the Worker's Chrome gets the same notice.
- A rehearsal keeps each captcha wait in its history ("Paused: do the
  captcha", "Resumed: the captcha is done"), on the tile and in the Record,
  and a `captcha` event in the Trace. A wait that timed out leaves only
  the pause's own line.

## Plain Workers: the submit and drive guards (KAN-610)

On a plain Worker's page (a PortPage, `apply-agent/docs/plain-workers/PROTOCOL.md`),
`submit_guard.guard`, `lift`, `rearm`, `renote` and `DriveGuard` hand over to
`apply.plain.guards`. The CDP path is unchanged: its scripts are byte for byte the same.

- **The same scripts, as files.** `apply plain prepare` writes `submit_guard`'s scripts into
  `worker-extension/vendor/guards/` (the rehearsal guard, the four drive guards, LIFTED,
  REARMED). The extension registers one as a MAIN-world content script at `document_start` in
  every frame, so it runs before the page's code with no eval and no user scripts. It refuses
  a file whose sha256 is not Apply's: re-run `prepare` after changing `submit_guard.py`.
- **Below them, declarativeNetRequest.** `guard` puts one session rule per final application
  URL (the guard script's FINAL_URLS, which cover ROUTED) on the tab, the tabs it opens and
  service workers. It blocks a non-GET before it leaves Chrome: page code from another realm,
  a worker, a beacon, or a form's native POST. `lift` takes the rules off and `rearm` puts them
  back.
- **Presses are untrusted.** The plain copy of the guard script (`port=True`) counts as a touch
  the `__apply_touch` the extension sends before each press: Apply's own (`page/dom.js`) and
  Lisul's from the tile (`tile.input` calls `touch()` in `ops/guard.js`, which also sends `guard.touched`
  up the port). It also reports each block as a `guard.said` event, which `PlainDriveGuard.blocked()`
  reads, since no console reaches Apply.
- **Bindings.** `expose_binding` defines `window[name]` in each document of the tab. A call
  comes up as a `binding` event, and the callback runs on its own thread.
- **Live runs.** Nothing here adds a guard to a live run. `filler.submit` clicks Submit only
  where the live-run rules already allow it. DriveGuard lifts only for Claude fill's own submit
  click, as under CDP.
- Tests: `tests/test_plain_guards.py` (Chrome for Testing). A fake job system on 127.0.0.1
  records every POST. A page that sends by script (fetch from a fresh realm, a worker, a beacon,
  requestSubmit, a native POST) sends nothing once guarded, and the rules alone stop it too.
  A tile press shows the blocked note, and a lifted page's Submit goes through and is heard.

## Form pages

- A Filler with a `form_url(url)` method names the page that holds its
  form. The Worker opens that page, not the posting link. Lever's form is
  on `/apply`; a link without it opens the job description.
- A Workday step that Save and Continue refuses ("won't leave its ... step")
  is filled once more, after a second's wait, and saved again; a second
  refusal is the Handoff. ASML's Application Questions showed every pick,
  yet Workday held two of them empty (`WorkdayFiller.fill`).

## Sign-in pages

- Chrome sets `navigator.webdriver` when it listens for DevTools, on a
  port or a pipe. Then Google's sign-in refuses Sign in with Google ("This
  browser or app may not be secure", KLA, 2026-11-03). So each Worker's
  Chrome starts with `--disable-blink-features=AutomationControlled`
  (`browsers.NOT_WEBDRIVER`). The keychain flags already
  match the Chrome that Lisul signs the profile in with.
- On Workday, Apply signs in or makes the account with email and password,
  even where the tenant offers Sign in with Google: Google asked for a
  passkey after the account pick on ASML's and KLA's tenants (2026-11-03).
  `policies.yaml: workday_sign_in` picks `email` (the default) or `google`;
  `orchestrator.by_filler` reads it into `WorkdayFiller(sign_in=...)`. The
  tests of the Google path set `google` (`GOOGLE` in the test files).
- On a tenant that offers Google, Create Account's "already exists" means
  Lisul made the account with Google, and Keychain has no password for it.
  That is Needs sign-in at once (`workday.MADE_WITH_GOOGLE`), and the unused
  new password leaves Keychain (`Accounts.not_made`). Apply never presses
  Forgot your password? there, since that mails Lisul. A tenant without
  Google still resets the password in a real run.
- A Create Account view may say "a verification email will be sent" before
  it is sent (Xcel's). `WorkdayFiller._create_account` counts only a notice
  that shows after the click.
- If Google still refuses (its `/signin/rejected` page), the Workday Filler
  stops at once as Needs sign-in (`workday.GOOGLE_REJECTED`), never a 30 s
  timeout. It never clicks Try again. The fake Workday's
  `google="rejected"` plays this page.
- A Google challenge page (`/signin/challenge/`, for example a passkey,
  which has no box to type in) is a Handoff at once too: "Google asked for
  more than an account pick (a passkey)". Apply never answers a challenge.
  The fake's `google="passkey"` plays it.
- Oracle's cookie banner covers the email step's Next button.
  `oracle.sign_in` declines the optional cookies first (`_decline_cookies`).
- Workday's Create Account is a `POST <site>/register` that answers JSON
  (Workday's cx-jobs code, 2026.44). A refusal is `{"type": "ERROR",
  "message": ...}`. A made account is a root (or redirect) widget. Then
  Workday's own code loads `<site>/login`, its bare Sign In view, when the
  tenant verifies email or the answer says `isLoginRedirect` (Visa's,
  Northrop's, ASML's, live, 2026-11-03: no reCAPTCHA or Arkose loaded, and
  no error status). Its `infoText` waits in sessionStorage for that page.
  So the bare Sign In view means the account was made, never "not made".
  `WorkdayFiller._create_account` reads the answer (`_register_answer`)
  and puts its shape in the Trace (`create_account`). A refusal that only
  the answer has is handled as a shown one.
- After that Sign In view, Apply signs in once with the new password
  (`_password(made_since=...)`). Signed in, the account is listed. A
  refusal because the account is not verified waits for the mailed link.
  Any other refusal means an account was there already: Workday answers
  that email as it answers a new account (ASML's, live). Then a run resets
  the password once (`WorkdayFiller._may_exist`): the new password goes to
  Keychain first, then one Forgot your password?, and the link from Gmail;
  a reset that does not finish forgets the password. This holds on a
  tenant that offers Google too (Lisul, 2026-11-03). A rehearsal resets
  nothing: it forgets the new password and stops with `workday.MAY_EXIST`
  (`Accounts.rehearsal`). No answer at all after the form was sent
  (`_send(unanswered=...)`) goes to `_may_exist` too.
- A tenant that mails a link goes to Sign In by way of `/login/warning`
  (Zillow's, Sonos's), so `_create_account` watches the requests for that
  page and then waits for the link. A sign-in that Workday refuses because
  the account is not verified is a Needs sign-in Handoff, not a failed
  password. First, Apply looks once in Gmail for the link Workday mailed
  (to the tenant's own host, within a day) when an earlier run made the
  account (Zillow's, live). It opens that link once and never asks for a
  new one. The fake Workday's `to_sign_in`, `exists_quietly` and
  `hides_errors` play these flows (`tests/test_employer_accounts.py`).
- In its Sign in with email view, Workday names the auth button "Submit"
  (Sonos's, live). A rehearsal's guard blocks a button that says submit,
  so `workday._send` sets `window.__applyAccountClick` for its own click.
  The guard then lets a click or submit in a form with a password box go
  through. No application's final button is in such a form.
- Apply asks a site for a verification code or link once per sign-in and
  never clicks Resend or Send New Code (`accounts.Accounts._wait`): a mail
  that hasn't come in about 2 minutes goes to Needs you ("Type the emailed
  code"), and Lisul retries himself.
- A Gmail search goes to IMAP as one quoted string (`gmail._quoted`). A
  phrase in quotes in the search stays escaped. Gmail can send a mail's
  INTERNALDATE before or after its body; `gmail._arrived` reads both.

## Employer account passwords in Chrome (KAN-592)

Lisul's Employer account passwords reach Chrome's password manager only
through the WorkIt extension in his own Chrome. Never through a Worker.

- **Why not the Worker:** Playwright starts every Worker's Chrome with
  `--use-mock-keychain --password-store=basic --disable-sync`. With the mock
  keychain, Chrome encrypts saved passwords with the public constant
  `mock_password` (Chromium's `crypto/apple/fake_keychain_v2.mm`), and
  `--disable-sync` keeps them off Google's account. Chrome also saves a new
  password only when the user presses Save in its bubble: a typed and sent
  form gives "Decision: ASK the user", and `navigator.credentials.store`
  calls `PromptUserToSaveOrUpdatePassword` (`credential_manager_impl.cc`).
  No policy saves without that press (`PasswordManagerEnabled` only allows
  the offer). So Worker profiles keep `_no_saved_passwords`, and a copy of a
  profile leaves `Login Data*` out. Do not change that. Never write a
  `Login Data` database.
- **The Apply accounts host** (`native_host.py`, `apply chrome-passwords`):
  a native messaging host (`com.workit.apply_accounts`) in everyday
  Chrome's `NativeMessagingHosts`. Its manifest names only the WorkIt
  extension's ID (`EXTENSION_ID`, pinned to manifest.json's `key` by a
  test), and the host checks the caller's origin again. One request names
  one tenant. It answers only for a tenant in the Tracker's Employer
  accounts list, with a Keychain password, whose sign-in has not failed.
  `want: "known"` gives the company and login, `want: "login"` adds the
  password. The password goes only to stdout, to Chrome. Its log
  (`apply-accounts-host.log`) names the tenant and the time.
- A rehearsal lists each account it makes in the kept Tracker (the one that
  keeps what Lisul submits), not its throwaway one. `apply
  chrome-passwords` lists the Keychain items that the Tracker lacks
  (`native_host.adopt`, from `Keychain.sites`, which reads no password).
- `apply doctor` warns when the host is missing or its wrapper is gone,
  never a fail.

## The Apply window

- The status line counts a link as "queued" only until a Worker starts it.
  A rehearsal sends `board.run(queued=...)` each time a link starts.
- When a run or rehearsal ends, its window closes (`Dashboard.__exit__`).
  A window with no server shows a run that is gone.
- A click on Apply in the Dock goes to the window's Chrome, which counts no
  app window as a browser window and opens a New Tab window, every click.
  The window's keeper (`dock_app.keep`) closes it at once and brings the
  window forward. The bundle's launcher starts the keeper beside the
  window's Chrome, so it lives as long as that Chrome. Never move it back
  into the process that opens the window: `apply watch` exits right after.
- `kill <pid>` (SIGTERM) stops Apply as Ctrl-C does: the Worker browsers
  and the window close. Ctrl-C does not reach Apply when it runs in the
  background, so use SIGTERM there.

## Plain Workers' tiles and Fix from the window (KAN-609)

Plain Workers (KAN-606, `apply/plain/`, protocol in
`docs/plain-workers/PROTOCOL.md`) have no CDP, so `CdpFrames` can't reach
them. `apply.plain.tile.PortFrames` is their frame source for the same
`Dashboard`: `Dashboard(n, PortFrames(n, workers.bridge.connection))`.

- **Frames: filmed (KAN-635).** With Screen Recording permission, Apply films
  each Worker's own window with ScreenCaptureKit (`apply.plain.window_capture`):
  `window_capture.swift`, built once by swiftc into `~/Library/Caches/apply/`,
  finds the window of the Worker Chrome's PID (the native host's parent) nearest
  the bounds the extension sends (`tile.shown`), crops it to the tab's viewport,
  and streams 30 fps JPEGs (quality 0.85) at the screen's pixel scale (2560 x
  1626 for a 1280 x 813 viewport). By window ID: nothing is focused, raised or
  moved, and a covered window still streams. Measured live: 29.6 fps through the
  window's `/frames` (`FRAME_GAP` now allows about 60).
- **Frames: without the permission.** The worker extension captures the shown
  tab with `captureVisibleTab`, at most every 500 ms (Chrome's quota is about
  two a second per browser, and only the debugger API, never used here, gets
  past it), JPEG quality 88, at the tab's CSS size, sent only when the picture
  changed: about 2 fps. The tile shows one line (`PortFrames.notice`, the
  caption's `capture`): "Live tile off: turn on <app> in System Settings >
  Privacy & Security > Screen & System Audio Recording, then quit and reopen
  <app>". macOS gives the permission to the app at the top of Apply's process
  chain (Terminal, iTerm, Paradev, Apply.app). Apply only looks
  (`CGPreflightScreenCaptureAccess`); it never asks for or changes it: Lisul
  turns it on himself. `APPLY_TILE_CAPTURE=extension` forces this path. Tile
  frames and `page.screenshot` share one gate (`ops/shared.js: capture`), so
  neither hits the quota error.
- **Never blank (KAN-643).** A filmed tile with no frame within 3 s of
  `tile.start` (`FIRST_FRAME`: an extension too old to send `tile.shown`, or a
  helper that never aimed, as when ScreenCaptureKit waits on a macOS prompt),
  or with none for 20 s after a `tile.shown` (`STALLED`), stops being filmed:
  `tile.start` again with `native: false`, and the extension's frames show.
  Apply prints one line saying why. Clicks map by the frame's own size
  (`page/tile.js` scales by `width` x `height`), so a 2x filmed frame and a 1x
  extension frame both land on the element under the pointer.
- **Out-of-date extensions (KAN-643).** The hello's `features` says what the
  loaded extension's code can do (`bridge.FEATURES`, 2). An older one with
  `extension.reload`, in a profile with Developer mode on, is reloaded in place
  before its welcome (`chrome.runtime.reload()`: tabs, pages and sign-ins stay).
  Still older, it is welcomed as `stale`: Apply prints one line and the tile says
  "Worker extension is out of date: quit Apply and start it again". The run goes
  on. Never reload from chrome://extensions or raise a Worker's window.
- **Covered windows still stream** because of
  `--disable-backgrounding-occluded-windows`. A minimized window doesn't:
  never minimize a plain Worker.
- **Input.** The window's events go to `tile.input`, which replays them as
  synthetic DOM events (`page/tile.js`). It handles press, release, move,
  wheel, keys, text, copy, and choosing from a `<select>` menu, and it
  reaches into iframes, cross-origin ones too. Keys reuse `page/dom.js`'s
  `press`, which now moves the caret for Arrow, Home and End.
- **Files.** An untrusted click opens no file picker. The extension marks
  the input a click asked for: an input or its label, or a page script's
  `input.click()` or `showPicker()`. The tile then asks Lisul for the file,
  and `chooser.set` gives it to the input through DataTransfer. The hook acts
  only without user activation, so Lisul's real mouse in the Worker's window
  still gets the real picker. `PortPage.expect_file_chooser` and
  `PortPage.mouse` use the same ops (`attach.py`'s upload behind a button
  works on a plain Worker).
- **Never take Lisul's focus.** Plain Workers start with `open -g -n`
  (`launcher.start_in_background`) with `--no-startup-window`, then the
  extension opens the window unfocused (`windows.create`), 1280 x 900 (readable at 100%),
  shrunk to the main screen's visible area, at its top-left corner. Only his Show brings one forward. Tests share one Worker and
  stop it when they end.
- **Wired into runs (S8, KAN-614).** `cli._dashboard` builds `PortFrames` when
  `worker_mode: plain`, and `EitherFrames` (each Worker's current kind) when `protected`.
- **Live check.** `uv run apply plain tile lever-immuta` fills a saved form
  in a plain Worker and prints the window's address. Click the tile and type.
  The tests are in `tests/test_plain_tile.py`: they need Chrome for Testing,
  each run takes about 30 s, and they use their own socket. The `frames`
  fixture is the extension's path; `filmed` (`-k filmed`) needs Screen
  Recording for the app pytest runs in, else it skips.

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

## The Accounts tab: Copy password and Open sign-in page (KAN-591)

`src/apply/accounts_tab.py`. The tab lists each Employer account in the
Tracker (`employer_accounts()`), newest first: company, site, login and the
date Apply made it. Lisul uses it to sign in himself later, for example to
check an application's status. It is step 1 of the plan for Apply's
passwords in Lisul's own Chrome (KAN-236).

- **A password stays in Keychain.** It is never in the page, the window's
  HTML, a JSON reply, a printed line, a Trace or a Record. Only the window's
  server reads it (`AccountsTab.copy`), and only to put it on the clipboard.
  Do not add a route, a field or a log line that carries it.
- A password never goes in argv, which `ps` shows. `MacKeychain.save` sends
  its command to `security -i` on stdin, then reads the item back, as
  `security -i` exits 0 when a command fails. `password()` gets it on
  stdout. Neither prints it or puts it in an error.
- `GET /accounts`, `POST /accounts/copy {site}` and `POST /accounts/open
  {site}` check the window's token and Origin (`_Handler._from_window`), as
  the window's other routes do. Each route reads only a site in the Employer
  accounts list, so the page cannot name any other Keychain item.
- Copy password: `MacClipboard` writes NSPasteboard through `osascript -l
  JavaScript` (JXA, no new dependency). The password goes on stdin, never
  in argv, which `ps` shows. It is written as `NSPasteboardTypeString` with
  the markers `org.nspasteboard.ConcealedType` and
  `org.nspasteboard.TransientType` (nspasteboard.org), so clipboard managers
  (Maccy, Paste, Raycast, Alfred, 1Password) skip it and keep no history of
  it. After 60 s (`CLEAR_AFTER`) the tab clears the clipboard, but only if
  its `changeCount` is still the one after its own write: anything copied
  since stays. The tab keeps that count, not the password. When the window
  closes (`Dashboard.__exit__`), a password still on the clipboard is
  cleared at once. An app that reads the clipboard itself can still read it
  in that minute.
- Open sign-in page: the newest Posting of that site in the Tracker, opened
  in Lisul's everyday Chrome with `open -a "Google Chrome"`
  (`captcha.to_everyday_chrome`), never over DevTools. Workday's job page has
  Sign In in its header. With no Posting, the site's home page.
- With no Keychain password (an account made with Google), Copy password
  says so (404) and the clipboard does not change.

**Tests.** `tests/test_accounts_tab.py` (in CI, no browser) uses
`InMemoryKeychain`, a fake clipboard and a fake runner for `MacClipboard`.
Never read a real Keychain password in a test, and never write the real
clipboard: to try the JXA, pass `MacClipboard("<a pasteboard name>")`. `tests/test_dashboard.py -k
accounts_tab` clicks the tab in Chromium and checks that the page's HTML
has no password.

## Rehearsal records

A Workday link is named from the Feed; one the Feed lacks is named by
Workday's job API, its legal entity trimmed to the company
(`workday.company_of`: "ASML US, LP. (US30)" is ASML). Unnamed, ASML's
Record was headed "# : " in a folder named `company-...`.

Every rehearsal outcome writes its Record (`rehearsals/<date>/`), a Handoff or
a failure too, not only a filled form. A step Workday won't leave keeps what
was planned and what each field showed up to there
(`WorkdayFiller.shown_so_far`); an outcome before any form opened keeps a
screenshot of the page it stopped on.

## Plain Workers: Records, Needs you, Resume and the emailed code (KAN-611)

A plain Worker is a Chrome with no CDP, driven by the worker extension
(`docs/plain-workers/PROTOCOL.md`). On its page (`apply.plain.page.PortPage`):

- **Full-page screenshot.** `page.screenshot(full_page=True)` scrolls the page
  one viewport at a time and joins the strips (`tabs.fullScreenshot`). Fixed
  and sticky elements show once, at the top. The image has 1 px for each CSS
  px, and it covers at most `FULL_PAGE_MAX` (20000) CSS px of the page.
  Each strip takes about 0.55 s (captureVisibleTab allows about 2 a second).
  The page scrolls in its window for that time, then goes back to where it was.
  `worker._screenshot` and `_Kept.screenshot` take the whole page for a plain
  page. A CDP page keeps its old screenshot.
- **Page HTML in a Record.** A plain page's Record has `page.html`
  (`Filled.html`, from `PortPage.record_html()`). It has each field's value as
  the page shows it, but no scripts, no Apply note and no password value. It
  has a `<base>`, so it opens with its styles. `records.record_files` replaces
  each secret question's answer with REDACTED. A CDP page's Record has no
  `page.html`: `worker.page_html` gives "" for it.
- **Fixed page functions.** On a plain page, `evaluate(code)` needs eval. A
  page whose CSP forbids eval refuses it in Chrome for Testing, where
  Allow User Scripts can't be turned on. So the page functions that the held
  page runs on each turn are fixed extension code: `on_page.FIELD` (Go to
  question and the Watch), `stuck.FIELD_ERROR` (Resume), and
  `email_code.WORDS`, `ARM` and `DISARM`. `apply.plain.fixed` lists them.
  `apply plain prepare` writes them into `vendor/fixed.js` from these same
  strings. `PortPage.evaluate` and `Locator.evaluate` run the fixed copy when
  they get one of these strings (the `fixed.call` op). Thus `on_page`,
  `stuck` and `email_code` don't change, and one source serves both kinds of
  Worker. To run new page code on each turn of a held plain page, add its
  string to `apply.plain.fixed`. Do not use eval for it.
- **Focus.** Go to question focuses the field. The Worker's window is behind
  Lisul's apps, so `:focus` doesn't match. `document.activeElement` is set,
  and that is what the Watch reads.
- The window's own field-error read (`CdpFrames._read_errors`) needs CDP.
  For a plain Worker, the window reads `stuck.field_error(page)` over the
  port, from its own thread (S3's frames).

`tests/test_plain_records.py` proves all of it on a page whose CSP forbids
eval. It includes a held rehearsal in a plain Worker: the fill pauses, Lisul
presses Resume, he uses Go to question, and his answer typed on the page is
taken. The Record has a full-page `form.png` and `page.html`. Until S4
(KAN-610) puts the submit guard on PortPage, that test turns the guard off.

## Plain Workers: Workday's accounts (KAN-613)

What Workday's Create Account, Sign In and steps need from a plain Worker's
page (`docs/plain-workers/PROTOCOL.md`, S7):

- **Frame locators.** `frame_locator` and `Locator.content_frame` work on a
  plain page, also for a frame on another origin.
- **Locator handlers.** `add_locator_handler` clears an overlay before each
  action and before each retry, as Playwright's does.
- **Requests and responses.** `page.on("request" | "response" | ...)` works.
  A response's body is read only for a fetch or XHR call that isn't a GET.
  That covers Workday's Create Account answer, which is how
  `exists_quietly` and `hides_errors` refusals are read.
- **Blocked pop-ups.** A synthetic click gives no user activation, so Chrome
  blocks the page's `window.open`. The extension then opens that URL in a new
  tab, with the page as its opener, and `page.on("popup")` fires.
- **Navigation mid-call.** A page call whose document goes away (Workday's
  Save and Continue inside `engine.call next`) fails as `Navigated` rather
  than hanging, and `fill_engine.call` retries it.

`tests/plain_fakes.py` runs a fake site's handler from an HTTPS server on
127.0.0.1 and points every host there with test-only Chrome for Testing
switches (`PlainWorkers(test_flags=...)`, refused for branded Chrome). Pages
keep their real URLs. One server and one Worker serve the whole test run.
Each fake opens a new tab. `FakeWorkdayServer(plain=True)`, the default when
`APPLY_TEST_PLAIN` is set, runs the Workday tests on that Worker:
`APPLY_TEST_PLAIN=1 uv run pytest tests/test_workday_filler.py -k ...`.
`tests/test_plain_accounts.py` covers the four S7 features.

## Plain Workers in runs and rehearsals: `worker_mode` (KAN-614)

`policies.yaml: worker_mode` picks the Worker each form opens in (`apply.plain.site.live_site`):

- `cdp` (the default): CDP Workers, as before.
- `plain`: every form on a plain Worker (`PlainSite`). `apply rehearse` and `apply run` use it.
- `protected`: plain only for `plain_worker_hosts` (jobs.lever.co, smartrecruiters.com,
  apply.workable.com, and their subdomains) and the hosts in `APPLY_HOME/plain-hosts.json`, which
  `captcha.blocked` writes. A block itself is always handed off to the student. The other forms use
  CDP Workers (`RoutedSite`).

What changes on a plain Worker:

- **One Chrome per Worker, reused.** It starts on its Worker's first form and stays up for the next.
  Each reuse calls `guards.reset(worker)` and closes the last form's tabs. After each form, one blank
  tab stays, so the window stays. The run or rehearsal stops each Chrome by its PID as it ends
  (`cli._close_workers`, before the rehearsal's `os._exit`).
- **The tile** uses `PortFrames`, which reads the field error for the stuck detector over the port
  (`stuck.field_error(page)`) on the window's own thread.
- **Go to question never raises a plain Worker** (`Dashboard(quiet=site.plain)`). It scrolls and
  focuses the field, and the tile shows it. Only Lisul's own Show brings the window forward.
- **Claude fill and Rescue** run on a plain Worker as on a CDP one: `claude_cli.drive` gives Claude
  Apply's own MCP server (S6, KAN-612) when the page is a PortPage, so a run or rehearsal in `plain`
  or `protected` mode needs no other wiring.
- **The production seed.** `uv run apply plain seed` opens branded Chrome on `APPLY_PROFILES/plain-seed`
  and prints Lisul's steps: Developer mode, Remove an old card, Load unpacked with the profiles
  folder's own copy of the extension (`APPLY_PROFILES/worker-extension`, next section), Details,
  Allow User Scripts, then quit (`launcher.seed_steps`). `plain_chrome: chrome` (the
  default) then copies that seed to each Worker. `plain_chrome: testing` (Chrome for Testing) needs no
  seed, but Allow User Scripts can't be turned on there.
- **Held Submit and the already-applied note** (KAN-629, KAN-621) work on plain pages:
  `submit_guard.lift(held=, dismiss=)`, `renote(held=)`, `warn_applied` and `applied_dismissed`
  hand over to `apply.plain.guards` (`guard.lift`'s `held` and `onlyLifted`, `guard.applied`). A
  `renote` of a page still guarded leaves it guarded.
- Tests: `tests/test_plain_routing.py`. Its live test rehearses the fake Greenhouse form twice in
  one reused plain Worker. `tests/test_plain_guards.py -k "held_submit or already_applied"`.

## One sign-in per job site: `apply rehearse --into` (KAN-645)

Job sites keep their sign-in only for the browser's session. A new Worker Chrome signs in again,
and a restart signs Lisul out. So **agents send each next posting into the running Worker that is
signed in to its site, never into a new rehearsal**:

```
uv run apply rehearse <first link>               # starts the window and its plain Worker
uv run apply rehearse --into 54321 <next link>   # the window's port: Browser 1
uv run apply rehearse --into 54321:2 <link>      # Browser 2 of that window
uv run apply rehearse --into <application id> <link>  # the Worker that fills that Application
```

- `apply.into` finds the window by the notes in `APPLY_PROFILES/windows/` (`ask.register`, 0600)
  and POSTs `/rehearse {url, worker?, application?}` with its `X-Apply-Token`. It then waits for
  the new tile to stop filling and prints how it stopped. Ctrl-C stops the wait, not the fill.
- The rehearsal (`rehearsal.rehearse`'s `into`, via `Dashboard.taking`) fills it in that Worker's
  running Chrome, in a tab of its own, with its own tile (`Dashboard.add_tile`: the tile shows
  that Worker's window), its own Record and the same guards. It never submits. A run's window
  takes it as a Request for that Worker, once that Worker is free.
- A form still open in the Worker (held, paused or filling) keeps its tab: no guard reset, no
  reload, no close (`PlainSite.open`). Only blank tabs go. Only a plain Worker that is running
  takes a link (409 otherwise): CDP Workers start a new browser per form.
- Before each posting, `fill_engine.fresh()` restarts the long-lived Node if the bundle on disk
  changed, and `PlainWorkers.refresh` writes a new vendor set (`vendor.use`) and reloads the
  Worker's extension when its code changed and no other form is open in it. So a merged engine
  fix needs no Chrome restart.
- Tests: `tests/test_into.py` (in CI). The live check is in the PR: one rehearsal, a second
  posting sent in, one Chrome PID, the job site's session cookie on the second form's requests.

## The worker extension's copy and vendor sets (KAN-645)

Chrome restarts an MV3 service worker from disk. A Worker that loads a shared checkout (the
old seed loaded `wt/sync`) runs whatever that folder holds after a pull, and a guard file that
differs from its Apply's crashed the page guard. So:

- **Each profiles folder has its own copy**, `APPLY_PROFILES/worker-extension/`
  (`extension.install`, with `.apply-code`, the code's hash). Chrome for Testing's
  `--load-extension` and the seed's Load unpacked name it. Apply replaces it only while none of
  that folder's Workers runs (`PlainWorkers.idle`; one Apply process drives a profiles folder,
  KAN-634), whole, by a rename. A `git pull` in any checkout never reaches a running Worker.
- **Generated files are write-once sets**: `vendor/sets/<id>/` (`extension.vendor_set`; the
  engine bundle, injected script, fixed functions and guards, `<id>` a hash of their bytes). The
  welcome names this Apply's set (`vendor`); the extension reads every generated file from it
  (`ops/shared.js: vendor`). A set is never changed, so Workers of another Apply on the same
  folder keep theirs. Sets unused for 7 days go.
- A reload keeps the guards (KAN-657). `extension.reload`, by `bridge.reload` or at hello, writes the
  registered scripts, session rules, lifts, held notes and bindings to `chrome.storage.local` first, and the
  code that starts next puts them back and a new relay in each open document. A held page's Submit stays
  blocked. A document that loads in the moment between the two has only what Chrome keeps: none of it.
- An older Worker on a shared folder: the bridge reloads it at hello when it can (KAN-643),
  before any engine check. If it still reads no sets and its guard files are another Apply's,
  `launch` stops it with `launcher.OutOfDate` (a SetupError: the rehearsal's line says how to fix
  it), never a crash. Its refusal for another engine names the folder to update.
- Rolling it out: no running Worker is touched. When no plain Worker runs, `uv run apply plain
  seed` once, and Load unpacked the copy it names. New Worker profiles copy that seed; an
  existing idle `plain-<k>` profile keeps its old registration until it is deleted.

## The data folder (`APPLY_HOME`)

**Personal data is never in the repo.** WorkIt is a public repo. All of a
person's data is in one folder, `APPLY_HOME` (default `~/.config/apply/`):

- the applicant profile, answer bank, story bank, voice and story map;
- the company briefs and stock answers;
- a `policies.yaml` that overrides `policies.default.yaml` key by key.
- the WorkIt login (`workit-login.json`), after `apply login`.
- Apply's Tracker (`tracker.json`) and the writes that wait for WorkIt
  (`workit-queue.json`).
- the tailored resumes that Apply gave to forms (`tailored/`, KAN-547).

Apply also writes its output there: rehearsal records, Repairs, Traces and
the Chrome worker profiles (`APPLY_PROFILES`, under `APPLY_HOME` by
default). `src/apply/home.py` derives every data path from `APPLY_HOME`.

The repo holds only generic inputs: the answering guides (`answering/`),
`policies.default.yaml` (with `live_runs` off) and the profile template.
When `APPLY_HOME` has no profile, Apply copies the Test Person sample data
into it and the window shows "Sample data".

- Never commit a data file. `.gitignore` here lists each data file name.
- For a test run, set `APPLY_HOME` and `APPLY_PROFILES` to a scratch folder,
  so the run does not write into your real data folder.

## Testing

- **Never run the full test suite (`uv run pytest` over all of `tests/`)
  for a small change.** It takes more than 20 minutes. Run it only for a
  major change that touches many modules, and say why.
- Run only the tests that the change touches, with `-k`. For example,
  `tests/test_workday_filler.py` alone takes about 5 minutes; do not run
  the whole file again after each small fix.
- Run `uv run ruff check .` here before you commit. It uses the backend's
  ruff config. `pyproject.toml` lists the findings that Apply keeps on
  purpose, each with its reason.
- CI (the `apply` job in `../.github/workflows/ci.yml`) runs ruff and only
  a fixed list of fast test files: the files that need no browser, no
  network and no `claude` CLI. When you add a test file that needs none of
  them, add it to that list. CI never runs the Filler tests
  (`test_*_filler.py`, `test_claude_fill.py` and the other files that open
  Chromium). Run the ones that your change touches on your Mac, with `-k`.
- **Prove a fix on the real form.** Rehearse the job posting that showed the
  bug (`uv run apply rehearse <url>`) and read its record. A rehearsal never
  submits. A unit test that passes is not the check that matters; the live
  form is.
- **Never press Submit** on a form, and never turn on `live_runs` for a
  test. A rehearsal leaves the browser open on the last page; leave it
  there.
- **Never press a button after an Emailed code.** On a page held for Lisul,
  `email_code.py` types the code that a job system emails after his own
  Submit, and nothing more (`test_email_code.py` checks that it has no click
  or key press). Test it on the fakes only: never press Submit on a real
  posting to make a code come. Two held pages whose lookups overlap on the
  same senders type neither code (`_join`, `CROSSED`): Greenhouse mails
  every company's code from one sender, and the newest mail after each press
  could be the other page's.
- Kill only the processes you started, by PID. Other people's rehearsals
  can run on the same Mac.

## Repairs

A Repair is Claude's fix to Apply's own code for a fill bug (`GLOSSARY.md`,
`docs/adr/0002`). Repairs are off: `policies.default.yaml` sets
`repair.max_per_day: 0`. When you turn them on in your data folder, a Repair
merges into the branch Apply runs from (or `repair.branch`) and pushes to
this checkout's `origin`, the WorkIt repo. It also moves the engine pointer
`autofiller_extension/fill-engine` on that branch, which is the extension's
pointer too. A Repair never runs on `main` (`repair_waiting` refuses it):
its pushes would move fill-engine's `main` and WorkIt's `main` to code
Claude wrote, and only WorkIt's `main` is protected.

## The privacy gate

`scripts/privacy_gate.py` scans the files for personal data (phone numbers,
email addresses, street addresses, student IDs, links to private repos) and
for secrets (API keys, GitHub and Slack tokens, private keys, cookies).
The identifiers it looks for come from a local file outside the repo
(`private-identifiers.txt`), never from the repo.

Run it before you push any file that you copied from a personal checkout.
If it finds something, remove it; do not push and fix later. A pushed file
stays in the public history.
