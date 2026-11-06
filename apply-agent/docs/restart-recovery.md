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
