# Apply window: UI redesign plan

Status: plan only, nothing built. Written 2026-10-20 against `main` at 5558c4e.

Scope: the Apply window (`src/apply/dashboard.py`, `src/apply/answers_tab.py`).
The stdlib server and inline HTML/CSS/JS stay. No framework, no build step, no
new process. Every phase below is one shippable commit (or a short run of
them) that keeps `tests/test_dashboard.py`, `tests/test_answers_tab.py` and
`tests/test_apply_window_on_the_mac.py` passing, editing a test only where it
pins wording the phase deliberately changes.

## 1. What Lisul does with the window

Lisul is one student running Apply for many Postings. The window has five jobs,
in the order he cares about them:

1. **Tell him when he is needed, and for what.** A Hold to approve, a Missing
   fact to answer, a sign-in wall, a Handoff, a Pre-submit check that failed,
   a page asking for a file.
2. **Let him fix it in place.** Take over a Worker's browser, answer, approve.
3. **Show that the run is healthy** without his watching: how many are filling,
   how many queued, whether the run is paused at a usage limit or the Daily cap.
4. **Show what went out.** Submitted this run and today, with the Record and
   the files sent.
5. **Keep his answers right.** The Answer bank, Missing-fact answers, Stock
   answers, Own applications.

Today the window is built around job 3 only (a live tile per Worker). Jobs 1, 2
and 4 are scattered between the tiles, the terminal, the Tracker Sheet and the
macOS notification at run end.

## 2. Walkthrough and friction points

Method: a `Dashboard` with six Workers was served against fake frames (forms
drawn with Playwright) and each tile given one state a real run produces:
filling, held (Target company + High-stakes essay), rehearsal ready with a failed
Pre-submit check and two drafted answers, submitted with two files, needs
sign-in (Workday) with a file chooser open, failed (a Playwright timeout). The
window was screenshotted at 1440x900 and 1000x700 with headless Chromium, then
one tile was enlarged, then the Answers tab opened. The Answers tab read the
real `answer-bank.yaml` (20 entries, 9 to review) and `applicant-profile.yaml`.
Code paths were read for everything a screenshot cannot show.

### Starting a run

- F1. The window has nothing to start, stop or pause: a run starts from the
  terminal (`apply run`, `apply rehearse <links>`), and with none going the
  Workers tab says to type a command. Fine for now (launchd starts the Daily
  sweep), but the window should at least say *when the next run is* and *what
  the last run did* instead of a bare "No run or rehearsal is going".
- F2. Run-level state lives only in the terminal: the Daily cap message
  (`DAILY_CAP_REACHED`), a pause at the Max-plan usage limit
  (`clock.sleep_until(resume_at)`), "Unreviewed drafts used again", employer
  limit warnings. While the run sleeps at a usage limit every tile simply
  stops changing, with no reason given.
- F3. No sense of progress: the queue length (Requests, Matches left) and how
  many are done are never shown. The summary line counts only what the tiles
  show *right now*.

### Watching Workers

- F4. Six equal tiles, each mostly a live picture of a form, at 1440x900 are
  ~470x350 px: the form text is unreadable and the picture carries almost no
  information until he enlarges it. At 1000x700 the banners truncate after
  ~30 characters. The live picture is the dominant element when it is the
  least needed one.
- F5. Verdict banners truncate their reason with an ellipsis ("Needs you:
  approve it (Target company: Stripe; High-stakes essay: Why Strip…"). The
  full reason is only in a hover `title` or in the enlarged tile.
- F6. "Ready — stopped before Submit (not submitted)" and "Submitted" share the
  same green (`.banner.ready, .banner.submitted`). The one distinction that
  matters most (did it go out?) has no visual difference.
- F7. The tile caption shows the raw job system key (`greenhouse`, `ashby`),
  and an idle tile says "Worker 3": Worker numbers mean nothing to Lisul.
- F8. A tile is a Worker slot, not an Application. In a run, the moment a
  Worker ends one Application the Orchestrator hands it the next and the tile
  is overwritten (`board.update(worker, ..., status="filling", why="")` in
  `orchestrator._Run.go`). A Hold, Handoff or Missing fact shows for as long
  as it takes the Worker to pick up its next Match, often seconds. **The window
  cannot be relied on to show what needs him**; only the Tracker and the
  end-of-run notification can.
- F9. The summary line ("1 filling · 3 need you · 1 failed · 1 submitted")
  counts the current tiles, so "nothing submitted" is shown after a run that
  submitted twenty, as soon as the tiles turn over.

### Noticing one needs him

- F10. Nothing tells him while the window is behind other windows: no window
  title change, no Dock badge, no notification per item. `MacNotifier` and the
  phone push fire once, at the run's end (`orchestrator.run`), and list the
  run's Holds, Handoffs and Missing facts in one message.
- F11. "Needs you" covers five different asks (approve, answer a fact, sign in,
  fix a Pre-submit check, finish a Handoff), all one amber colour, ordered by
  Worker number, not by urgency or age.

### Fixing a form

- F12. Click-to-take-control works and is safe (the first click only
  enlarges). But in the enlarged view, another tile's "The page asks for a
  file" bar draws over it: `.filebar` has `z-index: 3`, the enlarged tile
  `z-index: 2`, so Worker 5's bar covers the bottom of Worker 3's page
  (screenshot `big.png`). A bug, fixed in Phase 1.
- F13. The enlarged tile's detail (the full reason and each drafted answer) is
  capped at `max-height: 20%` under the page, below the blue "You're
  controlling this browser" bar; with two drafted answers it is already
  clipped.
- F14. Nothing in the enlarged tile says *what to fix*: the Pre-submit check
  says "'Graduation date' reads 05/2028, meant 05/2027", but there is no way to
  jump to that field, and no "I fixed it, check again" action.
- F15. Worker windows are about to be hidden from the screen and the Dock
  (today `worker_headless: false` shows a visible Chrome window per Worker; the coming change keeps them headed but hidden: see 5.5 for what hides them). Then the
  tile is the only way to see or reach a Worker's browser, and some things the
  tile cannot do well (a native dialog, a captcha that wants a real pointer,
  devtools, a second tab). There is no "Open browser" affordance. An earlier
  version had one (`Browser.setWindowBounds` over CDP, commit 9775fd1, removed in
  f1b72b6 when Workers went headless).

### Answering a Missing fact

- F16. A run's Missing fact cannot be answered in the window. It is answered in
  the Tracker row's Answer cell, and the next run picks it up. The Answers tab
  shows only facts *already* answered ("Your answers to Missing facts"). In a
  rehearsal the fact appears only in the banner text ("Needs you: Missing
  facts: …").

### Approving a Hold

- F17. "Needs you: approve it" has no Approve button. Approval is the Approve
  checkbox in the Tracker Sheet, picked up by the 5-minute Requests check. The
  window offers no link to the row, the Record, or the essay to read before
  approving.

### Checking what got submitted

- F18. No list of submitted Applications anywhere in the window. Submitted
  tiles are overwritten (F8). "Applied yourself?" (adding an Own application)
  sits atop the Answers tab, unrelated to answers, and its success message is
  the only record of it in the window.
- F19. A submitted tile lists "View · Show in Finder" for the résumé and cover
  letter sent, which is good, but nothing links the Record (answers +
  screenshots) or the Tracker row.

### Answers tab

- F20. The order is wrong for the task: "Applied yourself?" first, then the
  "Add an answer" form, then the bank. The 9 drafts to review, the only part
  with work in it, start below the fold at 1440x900. "Only ones to review" is
  off by default.
- F21. Long help paragraphs above every section repeat what the GLOSSARY says;
  once learned they are noise.
- F22. Each bank entry is a full-width card with its answer clamped to two
  lines; 20 entries is ~1,700 px of scroll. No keyboard way to move through
  them, open one, mark reviewed, or go to the next.

### General

- F23. No keyboard shortcuts beyond Esc. No way to jump to "the next thing
  that needs me".
- F24. Dark-only palette at 12 px with grey-on-grey help text (#999 on #111)
  and amber banners with black text; meets contrast in places, not
  everywhere. No `prefers-color-scheme` light mode.

## 3. Principles from research

Primary sources only (official design systems and the companies' own docs or
design blogs), each checked on 2026-10-20. Each line gives the principle, the
source, and the decision it drives here. Meta's published design guidance had
nothing specific to these topics, so it is not cited.

**Inbox and triage**

- P1. Open on what needs you; everything else is a tab away. Linear selects
  Priority notifications by default. https://linear.app/docs/inbox
  → The Inbox is the default tab (F8, F11).
- P2. Each item gets a small fixed set of verbs, each on a key. Linear Triage:
  Accept `1`, Decline `2`, Duplicate, Snooze `H`. https://linear.app/docs/triage
  → One primary action per Inbox kind (answer, approve, open browser, take
  control).
- P3. Move through the list and change state from the keyboard: `J`/`K`, `U`.
  https://linear.app/docs/inbox → j/k in every list.
- P4. A snoozed item comes back on new activity, not only on a timer.
  https://linear.app/docs/triage → "Dismiss" hides an item for this run only,
  and it comes back if its Application changes again.
- P5. Bundle low-urgency updates. Figma groups comment notifications and sends
  them every 30 minutes; a dot marks something new.
  https://help.figma.com/hc/en-us/articles/360039813234-Manage-notifications-in-Figma
  → Coalesced macOS notifications (at most one a minute), title count.

**Calm signals**

- P6. Represent urgency honestly, or people turn notifications off. Apple's
  four levels: Passive, Active, Time Sensitive, Critical.
  https://developer.apple.com/design/human-interface-guidelines/managing-notifications
  → Nothing in Apply is Critical; a needs-you item is Active at most.
- P7. Don't interrupt with information people can't act on; show it in
  context (Mail's offline indicator).
  https://developer.apple.com/design/human-interface-guidelines/alerts
  → Usage pause and Daily cap go in the status bar, not a dialog (F2).
- P8. Toasts are temporary and short; banners persist until the required
  action is done. https://docs.stripe.com/stripe-apps/patterns/communicating-state
  → Inbox rows persist until resolved; "Saved" confirmations are transient.
- P9. One snackbar at a time, never stacked.
  https://m3.material.io/components/snackbar/guidelines
- P10. Use severity colours for their meaning only; use success sparingly.
  https://primer.style/product/ui-patterns/notification-messaging/
  → One meaning per colour; Ready (not sent) is neutral, not green (F6).
- P11. A dot for "something new", a count badge for "N items"; clear it once
  opened. https://m3.material.io/components/badges/guidelines
  → Tab counts and `Apply (n)` title.

**Many parallel jobs**

- P12. Animate a status dot only while work is in flight, and pair every state
  with a text label. Vercel Geist StatusDot: QUEUED, BUILDING, READY, ERROR,
  CANCELED. https://vercel.com/geist/status-dot
  → A pulsing dot only on Filling chips; every chip has a word.
- P13. Long job lists filter by status and date. Vercel Deployments.
  https://vercel.com/docs/deployments/managing-deployments
  → History filters: This run / Today / All in Tracker.
- P14. Parallel, independently started jobs may each show their own progress;
  a group shows one overall indicator.
  https://m3.material.io/components/progress-indicators/guidelines
  → Fields filled per tile, plus one run-level count in the status bar (F3).
- P15. Prefer determinate progress, keep it honest, and never let it look
  stalled.
  https://developer.apple.com/design/human-interface-guidelines/progress-indicators
  → "11/24 fields" and elapsed time per tile; a paused run says paused.

**Loading and empty states**

- P16. Match the indicator to the wait: none under ~1 s.
  https://primer.style/product/ui-patterns/loading/ ; loaders inside each
  section, with a 200-300 ms delay. https://docs.stripe.com/stripe-apps/patterns/loading
- P17. Say why a view is empty, and treat "nothing yet" differently from
  "filtered out". https://docs.stripe.com/stripe-apps/patterns/empty-state
  → Inbox empty state says what the run is doing (F1).
- P18. One primary action in an empty state, verb + noun; warnings don't belong
  there. https://vercel.com/geist/empty-state ; short title, one line, specific
  errors. https://primer.style/product/ui-patterns/empty-states/

**Hierarchy and density**

- P19. Navigation recedes so the work area leads; keep density without
  overwhelm. https://linear.app/now/behind-the-latest-design-refresh
  → Quiet tab bar and status bar; content leads.
- P20. Dashboards checked daily should be dense and glanceable and flag what is
  stale or blocked. https://linear.app/now/dashboards-best-practices
  → One-line rows; idle tiles collapse (F4).
- P21. Use progressive disclosure only where truncation is needed.
  https://primer.style/product/ui-patterns/progressive-disclosure/
  → Reasons wrap in full instead of ellipsis (F5); essays expand on demand.

**Live activity**

- P22. Colour warnings and errors in a live log and make a line linkable.
  https://vercel.com/docs/deployments/logs
  → Each History row and Inbox row has a stable anchor (`#item-<id>`) a tile
  can link to.

**Keyboard**

- P23. Shortcuts must be discoverable and must not clash with browser or OS
  keys; avoid single-key shortcuts by default, or let them be turned off.
  https://primer.style/accessibility/patterns/keyboard-shortcuts/
  Linear uses single keys in triage (https://linear.app/docs/triage); the two
  are reconciled by enabling single keys only inside lists, never while a text
  field or a controlled tile has focus, and listing them under `?`.
- P24. Custom shortcuts only for the most frequent actions; keep Esc to cancel.
  https://developer.apple.com/design/human-interface-guidelines/keyboards
- P25. Bulk selection then one command menu (`X`, then `Cmd K`).
  https://linear.app/docs/select-issues → ⌘K command menu, last phase.

**Irreversible actions**

- P26. Confirm only uncommon actions that can't be undone; offer undo for
  common ones. https://developer.apple.com/design/human-interface-guidelines/alerts
  → Approve (sends a real application) confirms, showing the essay; Mark
  reviewed and Dismiss don't.
- P27. Name the result on the confirming button and make no button the
  default. https://developer.apple.com/design/human-interface-guidelines/alerts
  → "Approve and submit" / "Cancel", neither focused.

## 4. Information architecture

Three tabs instead of two, in this order, each with a count in its label:

```
 Inbox (3)   Workers (2 filling)   History (14 today)   Answers (9 to review)
```

- **Inbox** (default tab, `#inbox`): every Application that waits on Lisul,
  one row each, newest first within a kind. It is built from **Applications**,
  not Worker slots, so an item stays until it is resolved, whatever the Worker
  does next. Kinds, in this order: Sign-in wall, Missing fact, Hold, Pre-submit
  check failed, Handoff, Failed (failures go last: they are Apply's to repair).
  Empty state says what the run is doing and when the next sweep is.
- **Workers**: the live tiles as today, but secondary: a compact strip per
  Worker (company, role, step, fields filled, elapsed) with the live picture,
  and the take-control and Open browser actions. A tile whose Application
  needs Lisul links to its Inbox row.
- **History**: this run's and today's ended Applications, newest first, one
  line each: verdict pill, company, role, job system, time, and links (Record,
  files sent, Posting). "Applied yourself?" moves here, as "Add one you
  submitted yourself" at the top.
- **Answers**: unchanged in substance; "to review" first and on by default
  when there are any.

A run status bar sits above all tabs, one line:

```
 Run · 2 of 3 Workers filling · 18 queued · 7 submitted today (cap 25) · Paused at usage limit till 14:05
```

### Where the Inbox's items come from

Smallest change that works: the `Dashboard` keeps, besides its per-Worker
captions, a list of **ended Applications** (`self._ended`), appended to in
`Dashboard.update` whenever a caption gets an ending status (anything but
`filling`), keyed by company + role + Posting. The Orchestrator and rehearsal
already call `board.update(worker, status=..., why=..., ...)` at the end of
each Application; one more keyword, `posting_url`, makes each item addressable.
`/state` returns `{"run": {...}, "tiles": [...], "items": [...]}`. Nothing
reads the Tracker at render time; the Tracker stays the record, the window
mirrors this process's run. With no run going, the Inbox reads the Tracker
once on open (`rows()` filtered to held / missing fact / handoff) so Holds
from the 07:00 sweep are there when Lisul opens `apply watch` at 9.

## 5. Screen by screen

### 5.1 Run status bar (all tabs)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ● Running · 2 filling · 18 queued · 7 of 25 today       Next sweep 07:00 │
│ [Inbox 3] [Workers] [History 14] [Answers 9]                  ⌘K  ?      │
└──────────────────────────────────────────────────────────────────────────┘
```

- One sentence, plain words, no colour unless something is wrong. Paused
  states replace the counts with the reason and the resume time: "Paused: Max
  plan at 86% of its 5-hour window, resumes 14:05". "Daily cap reached: 25
  today; 11 wait for tomorrow." These come from the Orchestrator through a new
  `board.run(**fields)` call next to its existing `print` lines; `NoBoard`
  gets a no-op.
- The window title mirrors the Inbox count, `Apply (3)`, so the Dock / Cmd-Tab
  shows it without a notification.

### 5.2 Inbox

```
┌ Inbox ──────────────────────────────────────────────────────────────────┐
│ SIGN IN                                                                  │
│ ▸ Zipline · Embedded Software Intern · Workday               2 min ago   │
│   Workday wants an account on zipline.wd1.myworkdayjobs.com              │
│   [Open browser]  [Show live]                                            │
│ MISSING FACT                                                             │
│ ▸ Cohere · ML Intern · Ashby                                 9 min ago   │
│   "Do you have a valid driver's license?"                                │
│   [ answer here ......................................... ] [Save] ⏎     │
│ HOLD                                                                     │
│ ▸ Stripe · Software Engineering Intern · Greenhouse         12 min ago   │
│   Target company · High-stakes essay "Why Stripe?"                       │
│   [Read essay]  [Open Record]  [Approve in Tracker ↗]                    │
│ PRE-SUBMIT CHECK                                                         │
│ ▸ Harvey · AI Engineer Intern · Ashby                       20 min ago   │
│   'Graduation date' reads 05/2028, meant 05/2027                         │
│   [Take control]  [Open browser]                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

- One row per Application, grouped by kind with a quiet uppercase heading,
  newest first in each group. The first line is who (company, role, job
  system with its proper name), the second is exactly what to do, in full,
  wrapped, never truncated.
- Each kind's primary action is the one that resolves it:
  - Sign-in wall: Open browser (5.5) if the Worker's page is still open, else
    the `apply sign-in <url>` command to copy.
  - Missing fact: an inline answer box. Saving it writes the answer where the
    run reads it (the Tracker row's Answer cell, the same as typing it in the
    Sheet) and, in a rehearsal, into the profile through `AnswersTab.save_answered`.
  - Hold: Read essay (expands the essay inline), Open Record, and a link to
    the Tracker row. Approve stays in the Tracker in Phase 3; an in-window
    Approve is Phase 6 and optional (it writes the same Approve cell, as
    Lisul's own action, after showing the essay).
  - Pre-submit check / Handoff with the page still open: Take control (the
    current enlarged tile) and Open browser.
  - Failed: collapsed by default under "3 failed: Apply repairs these" since a
    Repair request is already kept; expandable for the error.
- Keyboard: j/k move, Enter opens the primary action, o Open browser, e
  focuses the answer box, x dismisses (hides it from the Inbox for this run, back if its Application
  changes again; the Tracker is unchanged).
- Resolved items leave the Inbox with a one-line transient notice ("Saved
  your answer; the next run uses it"). Only Approve asks first, since it
  sends a real application (P26, P27).
- Empty state:

```
┌ Inbox ──────────────────────────────────────────┐
│                                                  │
│   Nothing needs you.                             │
│   2 Workers filling, 18 queued. Apply will list  │
│   here anything it can't finish alone.           │
│   Last run: 07:00, 12 submitted, 0 held.         │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 5.3 Workers

```
┌ Workers ──────────────────────────────────────────────────────────────────┐
│ ┌ Anduril · SWE Intern, Summer 2027 · Greenhouse ───── Filling 11/24 · 1:42 ┐│
│ │ [ live picture ...................................... ]                    ││
│ │                                   [Take control] [Open browser]          ││
│ └──────────────────────────────────────────────────────────────────────────┘│
│ ┌ Harvey · AI Engineer Intern · Ashby ──── Needs you: Pre-submit check ↗ ┐ │
│ │ [ live picture ]                                                         │ │
│ └──────────────────────────────────────────────────────────────────────────┘│
│ ┌ Idle ─ waiting for the next Application ───────────────────────────────┐ │
└───────────────────────────────────────────────────────────────────────────┘
```

- Keep the grid and the whole input path (`/frames`, `/input/k`, the select
  menu, the file chooser bar) as is; they are tested and work.
- Header per tile: company · role · job system (proper name), then a status
  chip on the right. Status colours (one meaning each):
  filling = blue, needs you = amber, ready (not sent) = neutral outline with
  "Not submitted", submitted = green with a check, failed = red, ended = grey.
  Ready and Submitted stop sharing green (F6).
- A needs-you chip links to the Inbox row (↗), so the tile and the Inbox
  agree.
- Explicit buttons replace "click anywhere": Take control (enlarges, as now)
  and Open browser (5.5). Clicking the picture still enlarges, for muscle
  memory.
- Idle tiles collapse to a single line, so the live pictures that matter get
  the room.
- Enlarged tile: the reason and drafted answers move into a right-hand side
  panel (scrollable, full height) instead of a 20% strip under the page; the
  file-chooser bar of *other* tiles never draws over it (F12).

### 5.4 History

```
┌ History ──────────────── [This run] [Today] [All in Tracker ↗] ──────────┐
│ + Add one you submitted yourself: [ https://… ]  [Add]                   │
│ ✓ 09:41 Skydio · Autonomy Intern · Ashby        Record · Résumé · Letter │
│ ✓ 09:12 Pure Storage · SWE Intern · Greenhouse  Record · Résumé          │
│ ○ 08:55 Harvey · AI Engineer Intern · Ashby     Not submitted (rehearsal)│
│ – 08:40 Acme · Data Analyst Intern              Not eligible: Master's   │
└──────────────────────────────────────────────────────────────────────────┘
```

- Built from the same `_ended` list as the Inbox. One line per Application,
  the verdict as a symbol plus word, time, company, role, then links: Record,
  each file sent (View / Show in Finder, as tiles do now), Posting.
- "Applied yourself?" moves here from the Answers tab (F18).

### 5.5 Open browser (Worker windows hidden from screen and Dock)

Once Worker windows sit off-screen and out of the Dock, the tile is the only
door to a Worker's browser. Design:

- **Where**: an "Open browser" button on every tile header, in the enlarged
  tile's control bar, and on Inbox rows whose page is still open. Shortcut `o`
  on the focused tile or Inbox row.
- **What it does**: `POST /show/k` (token- and origin-checked like `/reveal`)
  queues `{"type": "show"}` on the `CdpFrames` thread (the one that owns the
  CDP connections), which runs `Browser.getWindowForTarget` then
  `Browser.setWindowBounds` with `windowState: "normal"` and on-screen bounds
  (centred on the main screen, 1280x900), then `page.bring_to_front()` and
  activates that Chrome process (`osascript` on its pid, as `raise_window`
  already does for the Apply window). This is the approach of commit 9775fd1.
- **While it is open**: the tile shows "Open in its own window · [Put back]";
  the live picture keeps streaming (the screencast does not care where the
  window is). Put back, or the Worker starting its next Application, moves the
  window off-screen again (`setWindowBounds` to the off-screen point). Closing
  that window by hand is treated as Put back (the next `_follow` turn finds
  the new page).
- **Guard**: while the tile's Application is still filling, the button reads
  "Open browser (Worker is filling)" and asks once: "The Worker is still
  typing into this page. Open it anyway?" A stopped Worker (needs you, ready,
  held page in a rehearsal) opens without asking.
- **Never** close, resize to zero, or minimize a Worker window to hide it:
  macOS stops painting minimized and occluded windows, which freezes the
  screencast (see `browsers.launch_options`' comment and the
  `KEEP_RENDERING` flags in commit 92692bf).
- **Headless fallback**: with `worker_headless: true` there is no window to
  show; the button is replaced by Take control, with a tooltip saying why.

**Measured 2026-10-20 (Chrome 155, Playwright's launch flags, one headed
Worker, a page that changes every 50 ms, 3 s per state):**

| Window state | Screencast frames / 3 s | Hidden? |
|---|---|---|
| On screen | 61 | no |
| `setWindowBounds` to (10000, 10000) | 56 | no: macOS clamps it back on screen, to the corner |
| Minimized (`windowState: "minimized"`) | 63 | yes, from the screen |
| App hidden (Cmd-H, `visible of process` false) | 3 | yes, but the tile freezes |

So off-screen does not hide a window on macOS, and Cmd-H freezes it. Minimizing
now keeps painting, which contradicts the older note above: recheck it before
relying on it. None of these removes a Worker's Dock icon, since each
Worker is its own Chrome process. Tried and rejected for the Dock: a copy of
Chrome.app with `LSUIElement` (needs re-signing, then fails to load its ICU
data, and would break on every Chrome update); LaunchServices'
`_LSSetApplicationInformationItem` from outside the process (returns 0 and
changes nothing). What works: **one Chrome for all Workers**, a profile
directory per Worker in one user-data-dir (`--profile-directory="Worker N"`,
a second launch opens its window in the running Chrome). Checked: one
process, one Dock icon, both profiles' pages listed over one CDP endpoint.
The cost is a refactor of `WorkerBrowsers.open` (each Worker attaches to its
own page by target id, not its own context), and Claude fill's Playwright MCP
then sees every Worker's tabs.

**Rechecked the same day; both hiding routes break something:**

- One Chrome for all Workers: as fast (4 Workers × 4 forms: wall 2.7-3.9 s
  vs 3.4-4.1 s for a Chrome each; 8 Workers: 6.0-8.0 s vs 6.5-7.5 s), but
  every profile's pages land in one Playwright context. An init script one
  Worker added ran on another Worker's page (measured). `submit_guard` puts
  its scripts and routes on `page.context`, so one Worker's `lift()` would
  lift the rehearsal guard on every Worker. Rejected.
- Minimized windows: the live picture keeps painting, but `page.screenshot`
  (viewport and full page) and raw CDP `Page.captureScreenshot` hang, so every
  Record would lose its screenshots and each Application would wait out
  `_screenshot`'s two 15 s timeouts. Rejected.
- A small window parked at the screen's bottom edge works: Chrome's 500x375
  minimum, which macOS keeps about 40 px on screen, gives 61 frames in 3 s,
  screenshots in 0.03 s (full page 0.35 s), and typing works. But the page then
  reports `outerWidth` 500 under an `innerWidth` of 1280, which a normal window
  never does, so it is not used. Dock icons stay either way.

**Third pass: what does work (all measured on Chrome 155):**

- **Park at full size.** `setWindowBounds` to (10000, 10000) without
  resizing: macOS keeps a 1282x926 window at (1688, 1076), so only about
  40x40 pt of its title bar shows in the bottom-right corner, and every
  Worker stacks there. Frames 62-63 / 3 s, screenshots 0.04-0.06 s, and the
  page reports the same sizes as today (inner 1280x800, outer 1282x926).
  Real Chrome, so typing into the window still works once Open browser brings
  it back. Changes nothing else; the Dock icons stay.
- **No Dock icon: a copy of Chrome with `LSBackgroundOnly`.** An APFS clone
  (`cp -c`, no extra disk) with that one Info.plist key, re-signed ad hoc
  (`codesign --force -s -`; editing a bundle in place is blocked by App
  Management, so edit it under a name without `.app` and rename it after).
  Measured: `type="BackgroundOnly"`, no Dock icon, frames 57-62 / 3 s,
  screenshots fine, CDP typing and the file chooser fine, same user agent and
  sizes as real Chrome. The cost: macOS never lets a background-only app take
  the keyboard. A real mouse click reaches its page, typing does not, so Lisul
  types through the dashboard tile (CDP), never in the window itself. The
  copy must also be redone after each Chrome update (compare
  `CFBundleShortVersionString`), and its first launch waits on macOS's scan.
- **Dead ends:** `LSUIElement` (no Dock icon, keyboard allowed) makes Chrome
  treat itself as one of its helpers. It cannot find `icudtl.dat` (failed 3
  of 3; an unrelated key passed 3 of 3). Placed in the framework's
  `Helpers/` folder, it stops on a CHECK in `ChromeMain` (SIGTRAP). There is no
  runtime way to drop another app's Dock icon. Apps like Dock Dodger edit
  Info.plist the same way.

### 5.6 Answers

```
┌ Answers ──────────────────────────────────────────────────────────────────┐
│ [Search…………………………]   (•) To review 9   ( ) All 20   ( ) Profile           │
│ TO REVIEW · used again first                                               │
│ ▸ What are some AI specific technologies…   Claude · used 3× · Harvey      │
│ ▸ Are you able to intern full time May–Aug 2027?   Claude · Zipline        │
│   [Mark reviewed r] [Edit e] [Delete]                                      │
│ ...                                                                        │
│ [+ Add an answer]                                                          │
└────────────────────────────────────────────────────────────────────────────┘
```

- A segmented filter replaces the checkbox and defaults to "To review" when
  there are any (F20). Profile facts and Stock answers become filter
  segments, not long sections below.
- Entries as dense one-line rows (question, then source · uses · company in
  muted text); the answer shows on expand. Keyboard: j/k, Enter expands, r
  marks reviewed and moves to the next, e edits.
- "Add an answer" collapses to a button at the bottom; help paragraphs become
  one-line hints or a `?` popover (F21).
- `AnswersTab` and its HTTP edits do not change.

### 5.7 Notifications (calm)

- Window title count `Apply (n)` (Phase 2).
- A Dock badge with the Inbox count is a stretch goal: the Apply app is a
  Chrome `--app` window, and whether `navigator.setAppBadge()` reaches its Dock
  icon is untested. The title count comes first.
- One macOS notification per *new* Inbox item, coalesced (at most one a
  minute: "2 Applications need you: Stripe (Hold), Cohere (Missing fact)"),
  only while the window is not focused. Uses the existing `MacNotifier`. The
  end-of-run notification and phone push stay as they are.
- No sounds, no blinking; amber is used only for needs-you, red only for
  failed.

### 5.8 Keyboard and command menu

- Global: `1`–`4` switch tabs, `g i` Inbox, `?` lists shortcuts, `Esc` backs
  out of anything (as it already returns from control).
- Lists (Inbox, History, Answers): `j`/`k`, Enter, plus the per-tab letters
  above.
- `⌘K` opens a small command menu (an `<input>` over a filtered list of
  actions: "Go to Inbox", "Open browser: Harvey", "Answer: driver's license",
  "Add an Own application", "Search answers"). Plain JS, ~80 lines. It comes
  last (Phase 7): shortcuts first.
- While a tile is controlled, every key goes to the page as now; the window's
  own shortcuts are off until Esc.

## 6. Phased order of work

Each phase is one shippable change, small enough to review alone, and keeps the
existing tests passing. Tests ride in the same commit.

**Phase 1: Fix what is broken (small).**
- File-chooser bars of other tiles no longer draw over an enlarged tile
  (scope `.filebar` under `.tile.big` or hide non-big tiles' bars while one is
  enlarged). Test: enlarge tile 0 while tile 1 asks for a file; tile 1's bar is
  not visible.
- Ready and Submitted get different colours; job systems shown by proper name
  (`Greenhouse`, `Ashby`, `Workday`).
- Enlarged tile's detail panel gets room (side panel or `max-height: 40%`,
  scrollable).
- Tests touched: `test_the_window_shows_each_verdict...` (colour class only).

**Phase 2: Ended Applications are kept, the summary counts them.**
- `Dashboard` keeps `_ended` (every caption that reaches an ending status);
  `/state` returns `items`; the summary counts submitted from `_ended`, so
  "nothing submitted" never shows after a run that submitted (F9).
- Orchestrator and rehearsal pass `posting_url` in their ending `update`.
- Window title shows the needs-you count.
- Tests: new ones for "a Hold stays listed after its Worker takes the next
  Application"; `test_a_line_on_top_sums_up_every_tile` updated for the new
  counts.

**Phase 3: Inbox tab, read-only actions.**
- New default tab listing `items` that wait on Lisul, grouped and ordered as
  5.2, reasons in full, with Take control, View/Show in Finder, Open Record and
  Tracker links. Empty state. No new write endpoints.
- With no run going, read the Tracker's waiting rows once on open.
- Tests: Inbox lists a Hold, a Missing fact and a sign-in wall from captions;
  empty state text; `test_while_a_run_goes_the_window_opens_on_its_workers...`
  updated to open on the Inbox.

**Phase 4: Run status bar.**
- `Board.run(**fields)` (no-op in `NoBoard`, recorded in `RecordingBoard`);
  the Orchestrator calls it where it prints the Daily cap and before
  `sleep_until` with the resume time; it reports queued and done counts each
  turn of `go`. `/state` returns `run`.
- Tests: a run paused at the usage limit shows the reason and resume time; the
  Daily cap line shows.

**Phase 5: Open browser.**
- `POST /show/k` and `/hide/k`, token-checked; `Frames.show(worker, on)`
  implemented in `CdpFrames` through the request queue; `NoFrames` and
  `FakeFrames` record it. Tile and Inbox buttons; the guard while filling;
  put back when the Worker moves on.
- Depends on the Worker-window hiding change landing (headed, off-screen,
  `KEEP_RENDERING`).
- Tests: the button posts and the frames thread gets `show`; a request
  without the token is refused; over CDP against a real headed Chromium,
  `setWindowBounds` moves the window on-screen and back (mark it like the
  existing live CDP tests).

**Phase 6: Answer a Missing fact and approve a Hold from the Inbox.**
- `POST /answer` writes the Tracker row's Answer cell (rehearsal: the
  profile through `AnswersTab.save_answered`); `POST /approve` ticks Approve
  after the essay has been shown. Both token-checked and logged in the
  terminal. Approve is optional: skip it if Lisul prefers the Sheet to stay
  the only place a Hold is released.
- Tests: the answer reaches the tracker fake; a refused write keeps the draft
  and says why.

**Phase 7: History tab, Answers tab reorder, keyboard.**
- History from `_ended`; "Applied yourself?" moves to it.
- Answers: segmented filter defaulting to To review, dense rows, Add an answer
  collapsed, shorter help.
- Shortcuts (j/k, Enter, o, e, r, 1-4, ?), then the ⌘K menu.
- Coalesced macOS notification per new Inbox item while unfocused.
- Tests: `test_the_search_box_narrows_every_section` and
  `test_lisul_marks_one_reviewed...` keep passing (same ids); new tests for the
  default filter and keyboard review.

Not planned: a frontend framework, a build step, WebSockets (1 s polling of
`/state` is fine at this size), a light theme beyond honouring
`prefers-color-scheme` if it costs only CSS variables, drag-and-drop layout,
per-user settings.

## 7. Risks and checks

- The Inbox mirrors the run's own process; the Tracker remains the record.
  Say so in the empty state ("The Tracker lists every Application") so the two
  are never confused.
- In-window writes (Phase 6) add the first window-to-Tracker writes. Keep
  them to Lisul's own cells (Answer, Approve), as the Row docstring defines
  them, never the Orchestrator's.
- Splitting `dashboard.py` (1,446 lines, mostly strings) is tempting; if a
  phase needs it, move only the page strings into `dashboard_page.py` as a
  separate refactor commit with no behaviour change.

## 8. Making it intuitive (second research pass)

Added 2026-10-20 against `main` at a989e98. Sections 1-7 make the window
*useful*; this pass asks whether someone who has never read GLOSSARY.md can
open it and know what is happening and what to do. It adds findings (W1..),
plain words for the internal terms, principles P28.. and changes to the
phases. It does not touch 5.5 or anything about Worker windows, and adds no
Chrome-window work.

### 8.1 Cognitive walkthrough

Method: four `Dashboard`s were served the way `tests/test_dashboard.py` builds
one (fake frames drawn with Playwright, `AnswersTab` over copies of the real
`answer-bank.yaml` and `applicant-profile.yaml`): no run (`apply answers`, 0
Workers), a run that has just started (4 idle Workers), a run in mid-flight
(6 Workers: filling 11/24, held for Target company + High-stakes essay,
Pre-submit check failed with two drafted answers, submitted with two files,
needs sign-in on Workday with a file chooser open, Missing fact), and a
rehearsal (one ready, one failed). Each was screenshotted with headless
Chrome (`--headless --screenshot`) at 1440x900 and 1000x700, and with
Playwright driving the same Chrome for the states that need a click (Workers
tab with no run, a tile on hover, an enlarged tile, an opened answer, "Only
ones to review" ticked and scrolled). The user modelled is a student who has
installed Apply and opened the window for the first time; he knows what an
internship application is, not what a Worker, Match or Hold is.

For each screen, the four walkthrough questions: **(1) Will he try to do the
right thing** (does he know what he should do here)? **(2) Will he notice the
control** that does it? **(3) Will he connect the control with his goal?**
**(4) Will he understand the feedback** and know it worked? A "no" is a
finding. Findings already in section 2 are named by their F number and not
repeated.

**Screen A: the window with no run going (`apply answers`, or a run that
ended).** It opens on Answers; the Workers tab says "No run or rehearsal is
going. Start one with **apply run** or **apply rehearse**, and each Worker's
browser shows here."

| Q | Answer |
|---|---|
| 1 Knows what to do? | No. Nothing says what Apply is, whether it is doing anything now, or when it will next do something on its own (the Daily sweep runs from launchd without him). |
| 2 Notices the control? | The only controls are terminal commands in bold text, in a window that has no terminal. |
| 3 Connects it to the goal? | "rehearse" and "run" are not explained; nothing says which one sends real applications. |
| 4 Understands feedback? | n/a: nothing to act on. |

- W1. **No orientation on first open.** The first screen a new user sees is
  the Answers tab, topped by "Applied yourself?" and a 20-card list of
  questions he never wrote. Nothing says "Apply fills internship applications
  for you; here is what it has done and what it needs from you." (F1 covers
  the missing next-run time, not the missing explanation.)
- W2. **"Run" vs "rehearsal" is never explained where the choice is made.**
  The one sentence that matters (a rehearsal never submits; a run does) is
  only in GLOSSARY.md and `apply --help`.
- W3. **The empty Workers tab teaches a command, not a state.** It should say
  whether Apply is idle until 07:00, or paused, or has never run, and offer
  the one next step (see 8.4).

**Screen B: a run that has just started (all tiles idle).** Summary: "No
Application yet · nothing submitted"; four large empty dark tiles "Waiting for
an Application · Worker 1..4".

| Q | Answer |
|---|---|
| 1 | No. Four large empty boxes read as "broken" or "loading", not "about to start". |
| 2 | Nothing to notice: no progress, no count of what is queued. |
| 3 | n/a |
| 4 | "Waiting for an Application" sounds like the user should supply one. |

- W4. **Idle reads as stuck.** "Waiting for an Application" is the Worker's
  point of view; the user's is "Starting: finding Postings that fit you (18
  found so far)". Idle tiles need a reason and the queue count (F3 adds the
  count; this adds the wording).
- W5. **"Worker 3" is meaningless to a newcomer** (F7 says so for Lisul); for
  a first-time user it also hides that several applications go at once.
  Name the concept once: "Apply fills up to 4 applications at a time."

**Screen C: a run in mid-flight (six states).** Summary: "1 filling · 4 need
you · 1 submitted". Banners: "Filling… 11/24 fields filled", "Needs you:
approve it (Target company; High-stakes essay: Why Stripe?)", "Needs you:
Pre-submit check failed. 'Graduation date' reads 05/2028, meant 0…",
"Submitted", "Needs you: sign in: zipline.wd1.myworkdayjobs.com wants a
password", "Needs you: Missing fact: Do you have a valid driver's license?".

| Q | Answer |
|---|---|
| 1 | Partly. "Needs you" is clear; *what* is needed is in jargon (approve it / Pre-submit check / Missing fact / sign in) and truncated (F5). |
| 2 | No control is visible on any amber tile. The only affordance is a hover pill, "Click to take control", which does not say what control means. |
| 3 | No. For a Hold the fix is in the Tracker (F17); for a Missing fact it is the Tracker row (F16); for sign-in it is an `apply sign-in` command; for a Pre-submit check it is typing into the tile. Four asks, one look, one hidden gesture. |
| 4 | No. After he acts nothing changes on the tile until the Worker moves on, and then the tile is overwritten (F8). |

- W6. **Every needs-you label names a rule, not an action.** "approve it
  (Target company …)" says *why* Apply stopped; the user needs *what to do,
  where*: "Approve or skip: Stripe is on your list of companies to check
  before sending." Each ask gets a verb-first instruction line and the reason
  second (8.2, 8.5).
- W7. **"Click to take control" is ambiguous and slightly alarming.** It does
  not say that the first click only enlarges (safe), that the Worker's own
  typing may continue on a filling tile, or how to give control back. Rename
  to "Open to look or type" with a one-line note in the enlarged view (W10).
- W8. **"Submitted" is green, but so is "Ready" (F6), and "1 submitted" in
  the summary sits next to "4 need you" with equal weight.** A newcomer
  cannot tell whether anything was sent without his consent. The summary
  should lead with what went out and what waits on him, in that order, and
  say "Nothing is sent without passing your rules" once (P32, P35).
- W9. **The sign-in banner shows a hostname** ("zipline.wd1.myworkdayjobs.com
  wants a password"). The user needs "Zipline's Workday site needs you to sign
  in once; Apply remembers it after."

**Screen D: an enlarged tile (Pre-submit check failed).** Top banner in full;
the page, with its green "Submit application" button; at the bottom a blue
bar "You're controlling this browser — Esc to return [Back to all tiles]";
under it the detail, clipped after one line of "Claude drafted (in the Answer
bank to review):" (F13); another tile's file bar drawn over the corner (F12).

| Q | Answer |
|---|---|
| 1 | No. He sees the reason but not which field, and not whether he should fix it and press Submit, or fix it and let Apply submit, or leave it. |
| 2 | The page's own Submit button is the most prominent control on screen. |
| 3 | Whether he may press it differs by mode: in a rehearsal the page is his and a submit goes in the Tracker (GLOSSARY: Rehearsal); in a run Apply means to send it itself after the check. The window says none of this. |
| 4 | Nothing confirms that a fix was noticed; there is no "Check again". |

- W10. **The enlarged view never says what is safe.** Add a fixed line under
  the control bar that states, per mode: rehearsal "Nothing has been sent.
  You may press Submit yourself; it goes in your Tracker." / run "Fix the
  field, then press Done: Apply checks it again before sending." (Done is the
  "I fixed it, check again" of F14.) The terminal already prints the
  rehearsal sentence (`rehearsal.py`: "Apply submitted nothing. Each browser
  stays open on the page it reached, yours now…"); the window should show it.
- W11. **The "Calibration run" reason leaks into a needs-you detail** without
  explanation ("Calibration run: Application 4 of 10, held so you can judge
  Claude's answers"). A newcomer reads it as a second error. Explain once, in
  the status bar, while the Calibration run lasts: "First 10 applications:
  each waits for your OK so you can check Claude's answers (4 of 10)."

**Screen E: a rehearsal that ended.** "Ready — stopped before Submit (not
submitted)" in green; "Failed: TimeoutError: Page.goto: Timeout 30000ms
exceeded" in red.

| Q | Answer |
|---|---|
| 1 | No: "Ready" with no next step; the rehearsal's own instruction is in the terminal only. |
| 2 | — |
| 3 | — |
| 4 | The failure is a raw exception. |

- W12. **Errors are raw exceptions.** A failed tile shows Python/Playwright
  text. Every failure needs one plain sentence (what happened), one consequence
  (Apply keeps a Repair request and retries; nothing was sent), and the raw
  error behind a "Details" disclosure (P31).
- W13. **A rehearsal's "Ready" says nothing about what a run would do.** The
  detail "A run would hold it: Calibration run…; Target company" exists but
  only on hover. Show it as the second line: "In a real run this would wait
  for your OK (Target company)."

**Screen F: the Answers tab.** Search, "Only ones to review", Reload;
"Applied yourself?"; "One-off answers 20 · 9 to review" with a paragraph that
begins "The Answer bank: one answer per question no profile fact answers…";
"Add an answer"; cards with "Claude drafted", "Not reviewed", "first asked by
Harvey"; opening one gives Save / Mark reviewed / Delete / Close; below,
"Your answers to Missing facts 0 · None yet.", "Stock answers", "Profile
facts".

| Q | Answer |
|---|---|
| 1 | Partly. "9 to review" signals work, but it is below the fold and the filter is off (F20). |
| 2 | "Mark reviewed" appears only after opening a card; the card does not look clickable until hovered. |
| 3 | "Mark reviewed" vs "Save": a newcomer does not know that Save also marks it reviewed (the help paragraph says so, F21). |
| 4 | "Saved" / "Marked reviewed" show in a small status span next to the buttons; the card then may jump (re-sort) and lose his place. |

- W14. **Three names for one list.** The heading says "One-off answers", the
  help says "The Answer bank", the badge says "Claude drafted", the run
  prints "Unreviewed drafts used again". Use one user-facing name, "Saved
  answers", with "drafted by Claude" / "written by you" as the source (8.2).
- W15. **"Not reviewed" sounds like a defect; it is the normal state of a
  fresh draft that has already been used.** Say "Check this" with what it
  affects: "Used on 3 applications. Check it once and it's used word for
  word."
- W16. **With "Only ones to review" ticked, Stock answers and Profile facts
  show their headings over nothing**, with no "hidden by your filter" line,
  so they look empty (screenshot `answers-bottom.png`). P17 asks for
  "filtered out" to differ from "nothing yet"; it applies here too.
- W17. **Reload** is an engineer's control: the user does not know the view
  can be stale. Refresh after each edit and on tab focus; drop the button, or
  label it "Show latest".
- W18. **"Applied yourself?" leads the tab** (F18 moves it); for a newcomer it
  is also unclear why he would tell Apply this. The hint should lead with the
  benefit: "So Apply never applies there again."

**Across all screens**

- W19. **No "what did Apply do and why" anywhere.** The window shows the
  present (tiles) and, with History (5.4), outcomes. It never shows the
  *decisions*: why a Posting was skipped (Not eligible, Employer limit, Daily
  cap, Repost, Closed), why one was held, what Claude wrote. The Tracker
  holds some of it as columns. A newcomer cannot build trust in an automation
  that acts for him without seeing its reasons (P36, P37). See the activity
  log, 8.6.
- W20. **No safety statement.** Nowhere does the window say what Apply will
  never do without him (send a Target company or high-stakes essay
  application, pay, delete, withdraw, state a fact he did not give). That
  list exists (GLOSSARY: Hold, Claude fill) and is the strongest reassurance
  the product has.
- W21. **Help is either absent or a paragraph.** There is no `?` per concept;
  the GLOSSARY's definitions are good but unreachable from the window.

### 8.2 Words the window shows, and plain words for them

The GLOSSARY terms stay in code, in the Tracker's columns, in the terminal and
in GLOSSARY.md: they are precise and the Tracker is the record. The window
shows plain words first. Where the same thing also appears in the Tracker,
the window keeps the GLOSSARY term as quiet secondary text (a group heading's
small caps, or a `?` popover: "In your Tracker this is *held*"), so the two
can be matched without learning the jargon first (P38, P39). One table in
`dashboard.py` (`WORDS = {"held": ("Waiting for your OK", "…one-line help…")}`)
feeds labels and popovers, so the mapping lives in one place and a test can
check that no raw status string reaches a label.

| Term (code, Tracker) | Where the window shows it today | Plain words in the window | Note |
|---|---|---|---|
| Worker | tile caption "Worker 3", alt text, "each Worker's browser" | "browser 3" only where a number is unavoidable; else the company being filled. Status bar: "filling 2 applications at once" | Never needed as a noun by the user (F7, W5). |
| Match | none in window (terminal: "Matches") | "job that fits your filters" / "fits you" | Status bar: "18 jobs that fit you are queued". |
| Posting | "Paste the Posting's link" | "job posting" / "the job's link" | |
| Request | none (CLI `apply add`) | "job you added" | If an "Add a job" box ever lands. |
| Application | "Waiting for an Application", summary | "application" (lower case) | Already plain; just drop the capital in UI copy. |
| Hold / held | "Needs you: approve it (…)" | **"Waiting for your OK"**; action "Review and approve" | Tracker word kept as secondary: "held". |
| Target company | in Hold reasons | "a company you asked to check first" (with the name) | |
| High-stakes essay | in Hold reasons | "an essay about this company" / "a long answer worth reading before it goes" | |
| Calibration run | in a ready tile's detail | "First 10 applications: each waits for your OK so you can check Claude's answers (4 of 10)" | Status bar while it lasts (W11). |
| Missing fact | "Needs you: Missing fact: …" | **"Question only you can answer"**; action "Answer" | Answers tab heading: "Your answers to questions only you could answer". |
| Handoff | "Needs you: <why>" | **"Apply can't finish this one: please finish it yourself"**; action "Open it" / "Finish in browser" | |
| Needs sign-in | "Needs you: sign in: <host> wants a password" | "Sign in to <Company>'s <Workday> site once; Apply remembers it" | Hostname as secondary text (W9). |
| Pre-submit check (failed) | "Needs you: Pre-submit check failed. …" | **"Answer to check before sending"**: "'Graduation date' says 05/2028; your profile says 05/2027" | Action "Fix it" then "Done, check again". |
| Pre-submit check (passed) | not shown | "Checked every answer against your profile" | Activity log line (8.6). |
| Rehearsal | "No run or rehearsal is going" | **"Practice run (nothing is sent)"** | Mode badge in the status bar. |
| run | same | **"Live run (sends applications)"** | |
| Daily sweep | none | "Daily check for new jobs, at 07:00" | |
| Daily cap | terminal only | "Today's limit reached (25). The rest go tomorrow." | |
| Employer limit | terminal only | "Skipped for now: <Company> allows 5 applications in 180 days" | |
| Not eligible | "Not eligible: Master's only" | "Skipped: you don't qualify (Master's only)" | |
| Closed | ended tile | "Skipped: no longer taking applications" | |
| Repost | none | "Skipped: you already applied to this job" | |
| Failed | "Failed: TimeoutError: …" | "Couldn't finish: <plain cause>. Nothing was sent. Apply will retry." + Details | W12. Repair request stays code-only. |
| Repair request / Repair | none in window | "Apply will try to fix this itself" | Only if a Repair is actually queued. |
| Ready (rehearsal) | "Ready — stopped before Submit (not submitted)" | **"Filled, not sent"** + mode line (W10, W13) | Neutral colour (F6). |
| Submitted | "Submitted" | "Sent" with a check, and time | "Submitted" is fine too; pick one and use it in History. |
| Filling | "Filling… 11/24 fields filled" | "Filling · 11 of 24 answers" | |
| Job system key | "greenhouse", "ashby" | "Greenhouse", "Ashby", "Workday" | F7. |
| Record | none yet (planned link) | "Saved copy" ("answers and screenshots") | Link text "See what was sent". |
| Tracker | "Add to Tracker", help text | "your Tracker sheet" (link) | Kept: Lisul named it; give it a link the first time. |
| Answer bank / One-off answers / drafts | heading, help, run output | **"Saved answers"** | W14. One name everywhere in the window. |
| Claude drafted / Your answer | badge | "Written by Claude" / "Written by you" | |
| Not reviewed / Reviewed | badge | "Check this" / "Checked" | W15. |
| Used again N times | badge | "Used on N applications" | |
| Mark reviewed | button | "Looks right" (marks it checked) | Verb that says the outcome (P30). |
| Stock answers | heading | "Your core essay answers" | |
| Applicant profile / Profile facts | heading | "Your facts" ("from applicant-profile.yaml") | |
| Own application / Applied yourself? | heading, button "Add to Tracker" | "Applied somewhere yourself?" button "Add it so Apply skips that job" | Benefit first (W18). |
| Take control | hover pill | "Open to look or type" | W7. |
| Reload | button | removed, or "Show latest" | W17. |
| Bot signal, Orchestrator, Filler, Claude fill, Worker profile | not shown | not shown | Keep them out of the window. |

### 8.3 Principles from the second research pass

Primary sources only, fetched 2026-10-20. The quoted phrase is on the page.
Shopify Polaris's content pages now redirect to `shopify.dev/docs/api/polaris`
and Material's writing pages render only by script, so neither is cited.
Microsoft's HAX Toolkit pages returned only guideline titles, so only titles
are quoted.

**First run and empty states that teach**

- P28. When a screen has nothing yet, use that space to teach: say what will
  appear there and link to the task that fills it. NN/g: "use the empty state
  to provide help cues"; "Provide direct pathways (i.e., links) to getting
  started with key tasks".
  https://www.nngroup.com/articles/empty-state-interface-design/
  → Every empty view says what lands there and how (8.4).
- P29. Prefer help pulled up in context over an up-front tour; "Push
  revelations reveal new information out of context."
  https://www.nngroup.com/articles/onboarding-tutorials/ ; and "Instead of
  showing general tutorials, use contextual tips tailored to the page that the
  user is visiting." https://www.nngroup.com/articles/recognition-and-recall/
  → No carousel or welcome wizard. A one-time tip the first time each kind of
  ask appears, and a `?` on each term.
- P30. An empty state also marks finished work; explain why it is empty and
  offer a short verb action. Atlassian: "An empty state appears when someone
  clears a screen or finishes a piece of work."
  https://atlassian.design/foundations/content/designing-messages/empty-state
  → Inbox empty after he clears it: "All done. Nothing needs you." plus what
  the run is doing.
- P31. Empty screens are daunting without a next step; Apple: "guide people
  on actions they can take". https://developer.apple.com/design/human-interface-guidelines/writing
  (checked via its JSON at
  https://developer.apple.com/tutorials/data/design/human-interface-guidelines/writing.json)
  → The no-run Workers tab offers the next step, not a CLI command alone.

**Plain words and microcopy**

- P32. Speak the user's language, not the system's: "The system should speak
  the users' language, with words, phrases, and concepts familiar to the
  user". https://www.nngroup.com/articles/match-system-real-world/
  → The terminology table (8.2).
- P33. Status updates in plain language: "Backend codes and internal jargon …
  mean nothing to the user"; "Present the latest update prominently".
  https://www.nngroup.com/articles/status-tracker-progress-update/
  → Tile and Inbox labels say what happened in words; the newest event leads.
- P34. Buttons are verbs: "When labeling buttons and links, it's almost
  always best to use a verb." Apple HIG Writing (URL in P31).
  → "Answer", "Review and approve", "Open it", "Looks right", never "OK".
- P35. Error messages say what happened and how to fix it; different errors
  get different messages; never clear what was typed. GOV.UK: "Describe what
  has happened and tell them how to fix it." "Do not clear any form fields".
  https://design-system.service.gov.uk/components/error-message/
  → Each failure kind gets its own sentence; a refused answer keeps its draft
  (Phase 6 already says so).
- P36. Put the error near its source, with constructive advice. NN/g:
  "Display the error message close to the error's source." "Offer
  constructive advice." https://www.nngroup.com/articles/error-message-guidelines/
  → A failed Pre-submit check is shown on that application's row, next to its
  fix action, not only in a banner.
- P37. Don't invent a cause; keep technical detail out of the message.
  Atlassian: "If you don't know the reason for an error, don't make one up."
  https://atlassian.design/foundations/content/designing-messages/error-messages
  → For an unknown exception: "Couldn't finish this form. Nothing was sent."
  and the raw error behind Details (W12).
- P38. Labels must predict where they lead; "Jargon, branded terms, or simply
  too sophisticated words may end up ignored."
  https://www.nngroup.com/articles/information-scent/
  → Inbox group headings name the action ("Answer 2 questions"), not the
  category ("Missing facts").
- P39. Recognition over recall: show options and context so people recognise
  rather than remember. NN/g defines recall as "the retrieval of related
  details from memory". https://www.nngroup.com/articles/recognition-and-recall/
  → Each ask shows the question, the company, the field and what Apply would
  have answered; Inbox rows never say "see Tracker" without a link.
- P40. Design so no extra explanation is needed: "It's best if the system
  doesn't need any additional explanation."
  https://www.nngroup.com/articles/ten-usability-heuristics/
  → The acceptance test for this section: a first-time user resolves one of
  each Inbox kind without opening GLOSSARY.md.

**Status of supervised background work**

- P41. Missing status reads as missing control: "A lack of information often
  equates to a lack of control". https://www.nngroup.com/articles/visibility-system-status/
  → The status bar always says what Apply is doing now, including "idle until
  07:00" and "paused".
- P42. Use percent-done or "X of N" for anything over about ten seconds.
  "percent-done progress indicators should be used for longer processes that
  take 10 or more seconds." https://www.nngroup.com/articles/progress-indicators/
  → "11 of 24 answers" per tile, "7 of 25 today" for the run (already P15).
- P43. A small, defined status set that separates "needs a person" from
  "waiting for a fix" and "stopped on purpose". Zapier: On hold "is waiting
  for an issue to be fixed before it can continue"; Needs review "requires
  human review before the Zap can proceed"; Safely halted "the run purposely
  stopped". https://help.zapier.com/hc/en-us/articles/20505304170637-Review-run-statuses-in-Zaps
  → Exactly six user-facing states, each with one colour and a `?`: Filling,
  Needs you, Filled not sent, Sent, Skipped (on purpose: not eligible, closed,
  limit), Couldn't finish (failed).
- P44. Name the states that wait on a person explicitly. UiPath Orchestrator:
  Suspended is "An intermediary state allowing user intervention".
  https://docs.uipath.com/orchestrator/automation-cloud/latest/user-guide/job-states
  → "Needs you" never covers failures; a failure is Apply's to repair (as
  section 4 already orders it).
- P45. Expand the failing step automatically. GitHub Actions: "Any failed
  steps are automatically expanded to display the results."
  https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/using-workflow-run-logs
  → An application's timeline (8.6) opens with its failing or stopping event
  expanded.

**Review and approval queues**

- P46. A review queue is a prioritized list with a list view to scan and a
  detail view with context, Previous/Next and J/K. Stripe Radar: "a
  prioritized list of completed or to-be-captured payments"; "use the J and K
  keys to move between payments". https://docs.stripe.com/radar/reviews
  → Matches the Inbox design (5.2); add Previous/Next in the expanded row.
- P47. Each review action says exactly what it does: "Approve: Closes the
  review with no changes made to the payment."
  https://docs.stripe.com/radar/reviews ; GitHub: "If a job is rejected, the
  workflow will fail."
  https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/reviewing-deployments
  → Under each Inbox button, a muted line of consequence: "Approve: Apply
  sends it on the next check (within 5 min)". "Skip: Apply won't apply to
  this job."
- P48. Spend the person's time only where judgment adds value: "Focus time on
  payments where human judgment can add valuable insight to the decision".
  https://docs.stripe.com/radar/reviews
  → Show the Inbox count per kind in the status bar so Lisul can see if a
  Hold rule floods him, and tune policies (not the window) if it does.
- P49. Approval requests carry the exact content and may allow editing before
  approving. Zapier Human in the Loop: "Select Yes to let a reviewer edit the
  content in an approval request."
  https://help.zapier.com/hc/en-us/articles/38731463206029-Request-approval-to-keep-your-workflow-running-with-Human-in-the-Loop
  → "Read essay" shows the essay inline; an Edit link opens it in the Tracker
  (the Essay cell is already Lisul's to edit, per `HELD_AGAIN`).

**Trust in automation acting for him**

- P50. Confirm only serious, irreversible actions, with buttons that say what
  will happen. NN/g: "provide response options that summarize what will
  happen for each possible response."
  https://www.nngroup.com/articles/confirmation-dialog/ (agrees with P26-P27)
- P51. Give a visible way out at any point: "The Cancel option should be easy
  to find and quick to execute."
  https://www.nngroup.com/articles/user-control-and-freedom/
  → Dismiss and Looks right show a 5-second Undo in the transient notice;
  approving from the window (Phase 6) waits for the 5-minute check anyway, so
  "Undo approve" stays available until that check picks it up.
- P52. A short delay makes a send undoable. Gmail: "select a Send
  cancellation period of 5, 10, 20, or 30 seconds."
  https://support.google.com/mail/answer/2819488
  → Only for sends Lisul starts from the window. Apply's own unattended
  submits are not delayed: no one is watching to press Undo.
- P53. Make clear what the system can do and why it did what it did; support
  efficient correction (HAX guideline titles: "Make clear why the system did
  what it did.", "Support efficient correction.").
  https://www.microsoft.com/en-us/haxtoolkit/library/
  → The activity log's "why" column (8.6) and a "what Apply never does
  without you" line (W20).
- P54. In high-stakes decisions say why, not only what: "Don't say "what"
  without saying "why" in a high stakes scenario."
  https://pair.withgoogle.com/chapter/explainability-trust/
  → Every Skip and every Hold carries its reason in the log, in plain words.
- P55. When automation fails, let the person take over with context: "When an
  AI system fails, often the easiest path forward is to let the user take
  over." https://pair.withgoogle.com/chapter/errors-failing/
  → A Handoff row says what was filled and what is left before "Open it".

### 8.4 First run and empty states

There is no wizard. The window teaches by what each empty place says (P28,
P29), and it knows which case it is in from data it already has: no Tracker
rows yet (never ran), a run going, no run going (last run and next sweep from
`apply schedule status`'s data), or a rehearsal.

**Never ran (no Tracker rows, no run).** The Inbox (the default tab) shows:

```
┌ Inbox ─────────────────────────────────────────────────────────────────┐
│  Apply fills internship applications for you.                           │
│                                                                         │
│  1. Check your facts and saved answers     [Open Answers]               │
│  2. Try a practice run: nothing is sent    $ apply rehearse <job link>  │
│  3. Start for real                         $ apply run                  │
│     or let the daily check run at 07:00    (apply schedule install)     │
│                                                                         │
│  Apply never sends without your OK to: companies on your check-first    │
│  list, applications with an essay about the company, its first 10       │
│  applications, or any it can't check against your facts.               │
│  Things that need you will appear here.                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

Three numbered steps (done steps get a check: "facts" is done once the
profile has no blanks in required sections; "practice run" once any rehearsal
row exists; "start" once a run row exists), and the safety line (W20). The
commands are shown with a Copy button since the window cannot run them
(starting runs from the window stays out of scope, as F1 says). It
disappears for good once a run has submitted anything.

**A run going, nothing needs him** (replaces the 5.2 empty state's first
line): "Nothing needs you right now. Filling 2 applications; 18 more jobs fit
you. Anything Apply can't finish alone lands here." Then the last-run line.

**No run going, nothing needs him:** "All done. Next daily check at 07:00.
Last run 07:00-07:42: 12 sent, 2 skipped, 0 waiting for you. [See what
happened]" (links to History, 8.6).

**A practice run (rehearsal):** the status bar carries a neutral badge
"Practice run: nothing will be sent" for its whole length, and each ready tile
says "Filled, not sent. This page is yours now: check it, press Submit
yourself if you want to send it (it goes in your Tracker)" (W10).

**Workers tab with no run:** "No applications are being filled. [Go to
Inbox]" plus the same next-sweep line. The tab may hide entirely when there
are no Workers, since the Inbox now carries the empty-state teaching.

**First time each ask kind appears** (Hold, question, sign-in, check, can't
finish): a one-line tip above that group, dismissed with "Got it" and
remembered in `localStorage` (a per-viewer convenience): "Apply stopped
before sending because Stripe is on your check-first list. Read what it wrote,
then approve it or skip it."

**Filtered-empty vs nothing-yet** (W16, P17): a section emptied by a filter
says "3 hidden by 'Check this' filter · [Show all]".

### 8.5 Needs-you rows: instruction, reason, consequence

Each Inbox row and each needs-you tile chip uses the same three-line shape,
built by one function from the caption (it replaces the `Needs you: …`
strings in `verdict`):

```
 Stripe · Software Engineering Intern · Greenhouse                 12 min ago
 Review and approve before it's sent                       ← what to do (verb)
 Stripe is on your check-first list · it has an essay about Stripe ← why
 [Read essay] [Approve…] [Skip]     Approve: sent on the next check (≤5 min) ← consequence
```

| Kind (code) | Instruction (line 2) | Primary action | Consequence line |
|---|---|---|---|
| held | Review and approve before it's sent | Read essay → Approve… | Sent on the next check, within 5 min |
| missing fact | Answer a question only you know | [answer box] Save answer | Saved to your facts; this application continues on the next check |
| needs sign-in | Sign in to <Company>'s <Workday> site once | Copy `apply sign-in <url>` | Apply remembers the sign-in for every <Workday> job |
| pre-submit check failed | Fix an answer before it's sent | Open it → Done, check again | Apply re-checks every answer before sending |
| handoff | Finish this one yourself | Open it | Apply filled 18 of 24; left: captcha |
| failed (collapsed) | Couldn't finish: <plain cause> | Details | Nothing was sent. Apply keeps a note to fix this and retries |

The detail text the plan already keeps (drafted answers, the full reason)
moves to the expanded row. The Tracker's word for the state sits in the
group heading's muted second half: "WAITING FOR YOUR OK · held".

### 8.6 Activity log: what Apply did and why

The History tab (5.4) becomes the activity log. It is not a fifth tab and not
a new store: it is the same in-memory `_ended` list, widened from "ended
Applications" to **"decisions"**, plus a per-application timeline.

```
┌ History ─────────────── [This run] [Today] [Skipped too]  [Tracker ↗] ───┐
│ 09:41 ✓ Sent      Skydio · Autonomy Intern · Ashby                       │
│                   All 22 answers checked against your facts. ▸ Timeline  │
│                   See what was sent · Résumé · Cover letter              │
│ 09:30 ◐ Waiting   Stripe · SWE Intern · Greenhouse                       │
│                   Check-first company · essay about Stripe → Inbox ↗     │
│ 09:12 – Skipped   Acme · Data Analyst Intern                             │
│                   You don't qualify: Master's only                       │
│ 09:05 – Skipped   OpenAI · Research Intern                               │
│                   OpenAI allows 5 applications in 180 days; retry 12 Nov │
│ 08:55 ✕ Couldn't  Harvey · AI Engineer Intern · Ashby                    │
│                   The page didn't load in 30 s. Nothing was sent.        │
│                   ▾ Details  TimeoutError: Page.goto: Timeout 30000ms…   │
└──────────────────────────────────────────────────────────────────────────┘
```

- **One row per decision**, newest first (P33): sent, waiting for you,
  filled not sent (rehearsal), skipped (with the rule in plain words:
  not eligible, closed, already applied, employer limit, today's limit), and
  couldn't finish. "Skipped" rows are behind the "Skipped too" toggle so the
  default view stays short, but they are one click away: skips are where an
  automation's judgment is least visible (P53, P54).
- **Every row has a why line**, never empty: for a send it is the reassurance
  ("All 22 answers checked against your facts"; "3 answers written by Claude,
  1 new: check it ↗" linking to the Saved answers entry).
- **Timeline on expand** (P45: the stopping event opens expanded):

```
 ▾ Timeline · Skydio · Autonomy Intern
   09:38  Started · Ashby form, 22 questions
   09:39  19 answered from your facts · 2 from saved answers · 1 written by Claude
   09:40  Cover letter written (Skydio's autonomy stack: from skydio.com/…)
   09:41  Checked every answer against your facts: all match
   09:41  Sent · confirmation page saved   [See what was sent]
```

- **Where the data comes from, smallest change:** the Orchestrator and
  rehearsal already call `board.update(worker, …)` at each step and print the
  skip reasons. One new call, `board.note(kind, company, role, why,
  posting_url=…)` (no-op in `NoBoard`, recorded in `RecordingBoard`), is
  placed next to the existing `print` lines for skips, the Daily cap, the
  employer limit and Repost, and next to the ending `update` (which Phase 2
  already widens). The timeline lines come from the captions' fields the
  Workers already set (`asked`, `filled`, `drafted`, `files`, status
  changes), timestamped as `Dashboard.update` receives them. Kept in memory,
  capped (last 500 decisions); with no run going the log shows the Tracker's
  rows for today, read once on open as the Inbox already does (section 4). The
  Tracker remains the record; the log says so in its header link.
- **No new storage, no streaming**: `/state` returns `items` (already
  planned) with a `why` and an optional `steps` list.

### 8.7 Changes to the phases

Each lands inside the phase named, keeping that phase one shippable change;
two small phases are added. Tests that pin wording change with the wording,
in the same commit.

- **Phase 1 (fix what is broken)**, add: failures shown as a plain sentence
  with the raw error behind a Details disclosure (W12); job systems by proper
  name is already there.
- **New Phase 1b: Words.** One commit that changes strings only: the `WORDS`
  table (8.2) feeding `verdict()` and the page; "Filled, not sent" for Ready;
  "Open to look or type" for the hover; the safety line in the enlarged tile
  per mode (W10); "Saved answers", "Written by Claude/you", "Check this",
  "Looks right", "Used on N applications" in the Answers tab (W14, W15);
  benefit-first "Applied somewhere yourself?" (W18). Tests: the parametrized
  `test_each_tile_says_at_a_glance…` table gets the new labels; a new test
  asserts no tile label contains a raw status key (`held`, `missing fact`,
  `handoff`) or a Python exception class name.
- **Phase 2**, add: `Dashboard.update` timestamps each status change in the
  caption (for 8.6's timeline) and the ended entry keeps them.
- **Phase 3 (Inbox)**, add: the three-line row shape and the per-kind table
  (8.5), action-named group headings with the Tracker word muted (P38),
  first-time tips per kind (8.4), and the three empty states (never ran, run
  going, no run). The "never ran" check reads the Tracker's row count once,
  which Phase 3 already reads.
- **Phase 4 (status bar)**, add: the mode badge ("Practice run: nothing will
  be sent" / "Live run"), the Calibration line while it lasts (W11), the
  one-line "Apply never sends without your OK to …" behind a `?` on the
  badge (W20), and "idle until 07:00" when no run goes (P41).
- **Phase 6 (answer and approve)**, add: consequence lines under each button
  (P47); a 5-second Undo on Dismiss and Looks right; Approve reversible until
  the 5-minute check takes it ("Undo approve"), which only unticks the same
  cell (P51, P52).
- **Phase 7 (History, Answers reorder, keyboard)** becomes **History as the
  activity log** (8.6): `board.note` beside the Orchestrator's skip prints,
  the Skipped toggle, the why line and the timeline. Answers: the
  filtered-empty line (W16); refresh on tab focus instead of Reload (W17).
- **New Phase 8: `?` help.** A `?` beside each user-facing term opens a
  two-line popover from `WORDS` (plain meaning, then "In your Tracker:
  *held*"); `?` key lists them with the shortcuts. Plain HTML `<details>`
  or `popover` attribute, no library.

**Acceptance check for the whole section** (P40): give the window, mid-run
with one item of each Inbox kind, to someone who has not read GLOSSARY.md, and
ask them to (a) say whether anything was sent, (b) resolve each item, and (c)
say why one job was skipped. Each should be done without asking. Re-run the
headless screenshots used in 8.1 after each phase and compare.

Still not planned, as before: a wizard or product tour, a framework, a new
process or database, persistent log storage beyond the Tracker, starting or
stopping runs from the window.
