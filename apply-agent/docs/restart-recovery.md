# Restart recovery

Reference for Apply, reached from `apply-agent/CLAUDE.md`. Paths are relative to `apply-agent/`. A change in this area updates this file in the same PR.

The Mac restarted twice in two days (2026-11-04 and 05), and each time every held form, every Apply
window and every job site's sign-in was lost. This file says what now survives a restart, and how
the forms come back.

## Sign-ins across a quit: `--restore-last-session` (KAN-718)

A job site keeps its sign-in in a session cookie: one with no expiry date. Chrome keeps session
cookies on disk, but on its next start it loads them only when it restores the last session or the
last exit was a crash (Chromium's `ProfileImpl::ShouldRestoreOldSessionCookies`). A clean quit is
not a crash. So before this, Apply's own stop (SIGTERM, at the end of every rehearsal), Cmd-Q and a
macOS restart each signed every Worker out.

Each plain Worker now starts with `--restore-last-session` (`launcher.FLAGS`). With it, Chrome
restores the last session's cookies. With `--no-startup-window`, which the Workers have too, it
opens no tab of the last session: only the cookies come back. So no job page loads before Apply
guards it. The profile's own "Continue where you left off" setting (`session.restore_on_startup`)
would do the same, but it is a protected preference (Secure Preferences, with a MAC), so Apply
never writes it. Apply never edits the cookie store either.

Measured on Chrome for Testing 1248, with a scratch profile and a fake site on 127.0.0.1 that sets a
session cookie and a 24-hour one (2026-11-06):

| How the Worker ended | Without the flag | With it |
|---|---|---|
| Clean quit (SIGTERM), 35 s after sign-in | session cookie gone | kept |
| Crash (SIGKILL), 35 s after sign-in | kept | kept |
| Crash (SIGKILL), 2 s after sign-in | gone | gone |

What it covers, and what it doesn't:

- **Covers:** a clean quit of the Worker's Chrome: Apply's SIGTERM, Cmd-Q, a macOS restart or
  shutdown that quits apps, a logout.
- **A crash or a power loss:** Chrome writes cookies to disk about every 30 s. One set in the last
  seconds before a crash or a power loss is lost; older ones come back (Chrome restores a crashed
  session's cookies with or without the flag).
- **Not covered:** a site that ends its session on its own server side (an idle timeout, Workday's
  among them), or one that ties the session to something that changed. Those sign in again: the
  form's tile says so, and `apply reopen` waits for Lisul.
- **CDP Workers** (`worker_mode: cdp`, Playwright's `launch_persistent_context`) don't get the flag.
- An existing Worker profile gets it at its next start. Its cookies from before the first start
  with the flag were dropped already.

**Tests.** `tests/test_restart.py` (in CI): the flag is on every plain Worker's command line.

## The open-forms list: `APPLY_HOME/open-forms.json` (KAN-719)

`src/apply/batch.py`. Each form a rehearsal opens is kept on this list as it goes, so a restart loses
none. One entry per link the rehearsal was given (its key, `link`), with:

- `application_id`, `posting_url`, `job_system`, `company`, `role`;
- `profiles` (the profiles folder, resolved) and `worker` (0-based), so the Worker profile that
  holds its sign-in; `plain`, whether that Worker is a plain one;
- `status`: the tile's (`filling`, `needs sign-in`, `handoff`, `ready to submit`, `failed`, ...),
  or `sent` once Lisul pressed the held form's Submit;
- `left`: the Missing facts by question, and how many problems to check; `record`: its Record's folder;
- `opened` and `updated`.

It holds links and Apply's statuses, never an answer. `rehearsal._noted` writes it as the tile
changes: as the form starts filling, at each pause, as it goes on, and as each fill ends.

- **A form leaves it** when the job system confirms that Lisul's own Submit went in
  (`rehearsal`'s `submitted`), and when the already-applied check finds he applied before (KAN-621).
  A Submit press with no confirmation yet is `sent`: it stays, his.
- **A form stays** when Lisul closes its tab, when Apply stops (Ctrl-C, SIGTERM, a crash) and when
  the Mac restarts. `apply reopen` brings it back (KAN-720).
- **One lock** (`open-forms.lock`, `fcntl`) for every process on the data folder, and each write
  replaces the file whole (`os.replace`, mode 0600). A broken file reads as an empty list.

**Tests.** `tests/test_restart.py` (in CI): an entry kept and removed, 20 writers at once, a broken
file. `tests/test_rehearse.py -k open_forms_list` (Chromium): a held fake Greenhouse form is on the
list with its Record, and leaves it once Lisul's Submit went in.

## `apply reopen`: every open form back after a restart (KAN-720)

```
uv run apply reopen --list   # what it would reopen; opens nothing
uv run apply reopen          # reopens them; the window shows a tile each
```

It reads the open-forms list (`batch.plan`) for this profiles folder (`APPLY_PROFILES`, else the
default) and rehearses each form again (`rehearsal.rehearse(reopening=...)`, `rehearsal.Reopening`),
with the guards of any rehearsal. It never submits.

- **Its own Worker.** Each plain Worker's forms go back to that Worker (`plain-<k>`), whose profile
  holds their sign-ins: its first form at once, each later one sent into it as `apply rehearse
  --into` sends one (the same `into`), once the form before it there has stopped past any sign-in
  (`settles`; a form that still waits at a sign-in, with its tab open, holds the next back).
  Turns, never a timed wait. The window aims tile n at that Worker (`Dashboard.aim`), and its frame
  source follows every Worker up to the highest one reopened.
  A CDP Worker's form (one browser per form) gets a Worker number of its own, after the plain ones.
- **What it held.** `batch.draft` reads the form's Record (`answers.json`, which now names each
  row's `kind`): each answer the page showed, with its question. Never one only planned, a file, a
  secret, or an attestation, consent or signature (`send_click.ATTEST`: those stay his to tick or
  sign). `apply_to(draft=...)` keeps one only where the field asks the same question now
  (`worker._held`: Claude fill numbers its fields, and a number may name another field), before each fill, with what the job system's own saved draft shows on the step
  (`worker._saved_draft`, the Filler's `resumed`: Workday's steps), as a Resume keeps Lisul's
  (`_Planned.keep`). So nothing on the form is written over. Claude may still plan the form again;
  what the form held wins. A job system that keeps no draft (Greenhouse, Lever, Ashby) is filled
  anew with what its Record held.
- **Sign-ins are Lisul's** (`Accounts.hands_off`, `accounts.HANDS_OFF`). A reopened form stops at a
  sign-in before Apply types or clicks anything there: Workday's (`WorkdayFiller._start`, before
  Google or a password), Oracle's (`oracle.sign_in`, before its Apply button and email), and Claude
  fill's account pages (`account_pages`: a page with a password box is a Handoff before Claude
  drives it; Claude is told to type nothing on an account page; any account page it names is a
  Handoff before plain code types or clicks). The tile says "needs sign-in". Once Lisul has signed
  in on the page, it goes on by itself (KAN-670: Workday and Oracle); else his Resume does. A
  captcha stops that, as in KAN-670. Residual: an email-only sign-in step that shows no password
  box, met in the middle of a Claude fill drive, is kept by Claude's prompt alone.
- **History.** Each reopened tile's first line is "Reopened after Apply stopped (open since ...)",
  and it is in the new Record.
- Forms Lisul pressed Submit on (`sent`) are listed, never reopened. Forms of another profiles folder
  are listed with the command that reopens them.

**Tests.** `tests/test_restart.py` (in CI): the plan, the draft, an account page's Handoff,
`--list`, the window's aim. `tests/test_reopen.py`: `-k killed` (Chrome for Testing, about 3
minutes) runs Apply in a process of its own on two fake Greenhouse forms in one plain Worker, kills
it, quits the Worker, and runs `apply reopen`: both forms come back held, in one Chrome, the second
sent into the first's Worker, each guarded, with what Lisul typed before kept, and nothing sent.
`-k workday` (Chromium): a reopened Workday form at its sign-in types nothing, says "needs
sign-in", and goes on by itself once Lisul signs in with Google.

## `apply preflight --open`: which reopened sites wait on a sign-in (KAN-721)

```
uv run apply preflight --open
```

`preflight.open_report` reads the open-forms list and each running Apply window's tiles (`/state`,
through `into.windows`). It opens no page and reads no job site.

- **Sign in now:** each form whose tile says "needs sign-in", by site, with its Browser. Sign in on
  that form's own page; Apply goes on by itself once you are in.
- **No window shows these yet:** each open form on a site whose job system will probably ask for
  a sign-in (`preflight.NEEDS`: yes or maybe), for before `apply reopen`.
- A form on a site that asks no sign-in (Greenhouse, Lever, Ashby) is not listed.

**Tests.** `tests/test_restart.py -k preflight_open` (in CI).
