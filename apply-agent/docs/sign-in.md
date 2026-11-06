# Sign-in, Employer accounts and preflight

Reference for Apply, reached from `apply-agent/CLAUDE.md`. Paths are relative to `apply-agent/`. A change in this area updates this file in the same PR.

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
- Claude fill's account pages (`account_pages.AccountPages._click`) keep
  the account-click flag on until the page answers the click, not only for
  the click itself, so a page whose script posts the form after the click
  goes through (KAN-640). A page that carries a captcha never gets this
  click: it is a Handoff first (KAN-703). Apply never clicks a button whose
  own text or value says submit, send, apply, finish, complete or confirm,
  whatever name Claude gave it.
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

## `apply preflight`: the sign-ins and the plan for a batch (KAN-668)

`uv run apply preflight <links...> [--workers N]` (`src/apply/preflight.py`) says what a batch will
need before any form opens. **It opens no page and reads no job site.** The job system comes from the
link and the engine's `jobOf` (Node, with no fetch); `test_preflight.py` fails on any socket.

- A site is what one sign-in covers: a Workday tenant, a wall's domain (`walls.site`), or the host.
- Each site says Sign-in (`preflight.NEEDS`: yes, maybe, no, can't tell), Keychain (`Keychain.sites`:
  attributes only, never a password) and Profile (`WorkerBrowsers.signed_in`, with Worker profiles on disk).
- "Sign-ins to do first" lists only what Lisul must do. A site with a Keychain password, or an account
  Apply can make with Gmail, goes under "Apply does these itself".
- The plan puts sites that may need Lisul first, while he is there. Its pacing is turns, one site to a
  Worker, and later links `--into` the same Worker. It has no timed waits: a delay only imitates a person.
