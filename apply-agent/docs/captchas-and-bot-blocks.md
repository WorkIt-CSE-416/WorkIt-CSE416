# Captchas and bot blocks

Reference for Apply, reached from `apply-agent/CLAUDE.md`. Paths are relative to `apply-agent/`. A change in this area updates this file in the same PR.

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
