# Claude fill and form pages

Reference for Apply, reached from `apply-agent/CLAUDE.md`. Paths are relative to `apply-agent/`. A change in this area updates this file in the same PR.

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
- A form's Apply button sends, but for a posting's Apply that only opens the application (KAN-725,
  `opens`): TAL.net's posting posts a form of its anti-forgery token alone to `.../opp/<id>/apply/<lang>`.
  Only on a job system proven to open the form there and send nothing: TAL.net alone for now
  (`claude_fill.OPENS_ONLY`, and the guard's own `START_HOSTS`, kept the same; a host joins both only
  once its posting is proven so). Claude fill vouches for the page only at its first drive, on the Posting's own URL
  (`DriveGuard.let_start_click`, the flag `__applyStartClick`, in `worker-extension/ops/guard.js`'s
  `FLAGS` too), in the top frame alone. Then that button goes through once, while its words name no
  send, its form holds a hidden token and buttons and nothing else, bound for its own site and no final
  URL, no field on the page holds an answer, and the page shows no draft, review or saved-profile apply
  (`DRAFT` in its text, `HEADED` in its title or headings). A key, input or change (in a frame of the
  site too), a click on anything but that Apply or a cookie banner's button, or the page changing its
  URL by script takes the word back. Once it went through, only that form's own submission goes, once, still
  a token alone: the guard sends its own copy of it (the hidden fields and the button's name), so no
  handler of the page's can add to it, and nothing else is posted to the site (its other subdomains
  too) from that page. A reopened form's and every
  later page's Apply stay blocked: the word is gone with the Posting's document. Elsewhere a posting's Apply may apply at once
  from a profile the site holds, in any words, so it stays blocked there. Without this, Claude's first click on TAL.net's posting was a
  Handoff with no field filled.
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
  holding a whole address, or a school's start year after this one. It reads every visible box of the
  step (`_on_step`, `STEP_VALUES`), not only the ones Apply filled, so a value an earlier run saved
  is checked too; a label that shows twice (a home and a campus address) is numbered, "#7: City/Town".
  Address line 1 holding a whole address is wrong too when the step asks a part of it (City, State
  or Zip, KAN-684). A bare "Start date" beside school
  fields may be the internship's, so it stops the fill only in a section headed clearly as education
  (`_sections`, `clearly_education`) or at a year past `PLAUSIBLE_YEARS` (KAN-659).
- A question Claude finds on a step (`unlisted`, then MoreQuestions) belongs to that step
  (`_found_at`). Once the fill has gone past it, its answer is never sent to a later step: TAL.net's
  Save and Continue goes on with a required box blank, and Lisul's answer came steps later
  (KAN-687). It is `left_behind` instead. The Worker holds the form for it ("Not filled: ... its
  answer came after the form saved its step without it"). A rehearsal lists it as left blank and,
  once held, fills it on its own step through the window's in-place fill (`docs/held-forms.md`,
  KAN-686). A question the read pass listed has no step of its own and is carried on as before.
- Dropdowns that list their choices only once opened are read and picked
  by plain code (`_with_options`, `_pick_in_comboboxes`). Each one's name is
  read off the very element Playwright clicks (`_comboboxes`), never from a
  page script's own list: the two counted visibility apart on Microsoft's
  profile step, and each question opened its neighbour (KAN-646).
- A text box whose placeholder is a date format ("YYYY-MM") gets that format after its label,
  "(YYYY-MM)", as the planner reads a format (`_with_formats`, KAN-714): Amazon's graduation month box
  says its format only there, and refused "May 2028".
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

## Form pages

- A Filler with a `form_url(url)` method names the page that holds its
  form. The Worker opens that page, not the posting link. Lever's form is
  on `/apply`; a link without it opens the job description.
- A Workday step that Save and Continue refuses ("won't leave its ... step")
  is filled once more, after a second's wait, and saved again; a second
  refusal is the Handoff. ASML's Application Questions showed every pick,
  yet Workday held two of them empty (`WorkdayFiller.fill`).
