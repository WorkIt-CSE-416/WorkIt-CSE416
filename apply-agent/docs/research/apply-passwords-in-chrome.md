# Apply's Employer account passwords in the user's everyday Chrome

**Status (2026-11-05):** Built: the Accounts tab, `apply chrome-passwords` and the native host (`apply-agent/README.md`, step 9). Read this note for why. The code descriptions are from the research date.

Researched 2026-11-03. The code was read at WorkIt `origin/main` `a346d259`, read-only. No Keychain password was read or printed.

**The problem.** Apply makes one Workday account per tenant. The login is the user's email. The password is a random 20-character one, kept only in the macOS Keychain (service `apply-ats`, account = the tenant). Later, the user wants to sign in to that tenant in their everyday Chrome to check the application's status, and they can't easily get the password. They asked for "a button that autofills the login page with everything that has been generated", and for Apply to "personally add it to Chrome itself".

## Recommendation, in short

1. **First, Apply alone:** add an **Accounts** tab to the Apply window. Each row gets **Copy password** and **Open sign-in page** (opened in their everyday Chrome). This is small, adds no new trust, and works today.
2. **Then the button:** the extension gets a **"Sign in with your Apply account"** button on a Workday Sign In page. The password comes **from Keychain, on demand, through native messaging** to a small Apply host. The host answers only for tenants in Apply's Employer accounts list. The extension keeps no copy of the password.
3. **"Add it to Chrome":** when the button fills the form, the content script also calls `navigator.credentials.store(new PasswordCredential(...))`. Chrome then shows its own **Save password?** prompt, and the user clicks Save. From then on, Chrome's password manager (and Google Password Manager, through sync) fills that tenant by itself.
4. **Do not** send passwords to the WorkIt backend (option b). **Do not** copy them into the extension's storage (option c).

## What the code has today

- `apply-agent/src/apply/accounts.py` and `keychain.py`: `Accounts.new_password` saves the password to Keychain before the sign-up is sent. `MacKeychain.password(site)` reads it with `security find-generic-password -s apply-ats -a <site> -w`. `Accounts.created` lists the account as an `EmployerAccount(company, site, login, created)`. The password is never in the Tracker.
- The Employer accounts list is in the Tracker (`tracker.json` in `APPLY_HOME`, or the Sheet's "Employer accounts" tab). **The Apply window has no Employer accounts tab yet.** Its tabs are Needs you, Live, History and Answers (`dashboard_page.py`'s `TABS`). The window's server is on `127.0.0.1` and checks an `X-Apply-Token` header and the `Origin` on every POST (`dashboard.py`).
- **The keys already match.** Apply's site is `workday.site_of(url)` = the engine's `jobOf(url).tenant`. That is the host, or `host/<site>` on `myworkdaysite.com`. The extension keys `workday_logins` by the same `jobOf(url).tenant`.
- The extension already fills Workday's Sign In (KAN-373, KAN-479, `src/background/workday-logins.js`, `src/content/workday.js`). Its rule is **"THE PASSWORDS NEVER LEAVE THIS BROWSER"**: `chrome.storage.local` only, never an API call, a log or a report. The only message that carries a password is the worker's answer to `workday/login`. The options page already has Copy and a CSV Export in Chrome's import columns.
- The manifest has a fixed `key`, so the extension ID is stable. A native host's `allowed_origins` can name it. The manifest has no `nativeMessaging` permission.
- **A trap for step 2:** in the user's Chrome, a tenant with no `workday_logins` entry falls back to the student's one `workday_signup` password as `fresh`, and switches to Create Account. On a tenant that Apply made, the Apply lookup has to come **before** that fallback.

## 1. Saving into Chrome's password manager automatically

| Route | Works? | Prompt? | Source |
|---|---|---|---|
| `navigator.credentials.store(new PasswordCredential({id, password, name}))` on the tenant's own origin | Yes. It needs a secure, top-level context. In an iframe it "resolve[s] without effect". | **Yes, for a new credential:** "The user will be prompted to store it or not." Chromium's `OnProvisionalSaveComplete` calls `PromptUserToSaveOrUpdatePassword` for a new credential. It calls `form_manager_->Save()` with no new bubble when a matching credential is already saved. `Store()` returns early, with nothing saved, when saving is disabled for the origin (`IsSavingAndFillingEnabled`). | [MDN store()](https://developer.mozilla.org/en-US/docs/Web/API/CredentialsContainer/store), [Chrome blog](https://developer.chrome.com/blog/credential-management-api), [credential_manager_impl.cc](https://chromium.googlesource.com/chromium/src/+/main/components/password_manager/core/browser/credential_manager_impl.cc) |
| Chrome's own save prompt after the extension fills the form and it is sent | **Not reliable.** Workday signs in by XHR, not by a form post, so Chrome has to guess that a submission happened (`XHR_SUCCEEDED`, `PROBABLE_FORM_SUBMISSION`). Also, Chrome's renderer "Disregard[s] text changes that aren't caused by user gestures or pastes" (`AutofillAgent::TextFieldValueChanged`). So a value that a script sets may never reach the password manager. The extension's CLAUDE.md says only "Chrome may offer to save them too." | Sometimes | [autofill_types.mojom](https://chromium.googlesource.com/chromium/src/+/main/components/autofill/core/common/mojom/autofill_types.mojom), [autofill_agent.cc](https://chromium.googlesource.com/chromium/src/+/main/components/autofill/content/renderer/autofill_agent.cc) |
| `chrome.passwordsPrivate` | **No.** It is private. Its permission entry is `"location": "component"`, `"channel": "trunk"`, so only Chrome's own component extensions get it. Its API entry is for Chrome's settings WebUI. It is not in the public API reference. | n/a | [_permission_features.json](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/extensions/api/_permission_features.json), [passwords_private.idl](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/extensions/api/passwords_private.idl), [original review](https://codereview.chromium.org/1128203005) |
| CSV import | Yes, but only by hand. Go to Google Password Manager settings, then Import passwords, then Select file. Use the columns `url`, `username`, `password` (`name` works too). Google says to delete the file afterward, because "anyone who uses the device can open the file". No API or command starts it. | The user does each step | [Import passwords with Chrome](https://support.google.com/chrome/answer/13068232) |
| Google Password Manager API | None is public. Passwords are written by Chrome (or Android's autofill), and sync carries them to the Google account. | n/a | [Chrome password help](https://support.google.com/chrome/answer/95606) |

**What this means:** the only automatic, supported way to add a password is `store()` on the tenant's page, plus one click on Chrome's prompt. That is the same consent Chrome asks for any site. Not checked yet: calling `store()` from the extension's isolated-world content script. Content scripts share the page's DOM and web APIs, so it should run as the page's origin. Prove it on one live tenant. If it fails, run the same call in the page's main world (`chrome.scripting.executeScript({world: "MAIN", args})`). That is fine, because the page it would show the password to is the tenant, which receives the password anyway.

## 2. Where the button's password comes from

### (a) Native messaging to a small Apply host. Recommended.

From [Chrome's Native messaging docs](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging):

- **Host manifest:** `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.workit.apply_accounts.json`, with `name`, `description`, `path` (absolute), `type: "stdio"` and `allowed_origins: ["chrome-extension://<WorkIt extension ID>/"]`. Wildcards are not allowed. The ID comes from the manifest's fixed `key`. Check that it matches the ID of the extension in the user's Chrome, whether it was installed from the Web Store or unpacked.
- **Calls:** Chrome starts the host as the logged-in macOS user, with the caller's origin as its first argument. Each message is length-prefixed JSON on stdio. A reply can be at most 1 MB. `chrome.runtime.sendNativeMessage` starts one process per message, so `path` should be a small wrapper that runs the Apply venv's Python directly (`.venv/bin/python -m apply.native_host`), not `uv run`, to start fast.
- **Permission:** the extension needs `"nativeMessaging"`. Its install warning is "Communicate with cooperating native applications". It is not on the list of permissions that [can't be optional](https://developer.chrome.com/docs/extensions/reference/api/permissions), so put it in `optional_permissions`. Request it from an options-page switch ("Use my Apply accounts"). Students then never see a new warning, and a Web Store update doesn't get disabled for a new permission. Without the host, `sendNativeMessage` fails with "host not found", and the button never shows.
- **Keychain:** the items were made by `/usr/bin/security`, so they list `security` in their access list. When the host reads them with the same CLI (`MacKeychain.password`), macOS shows no new prompt.

**What the host checks (security):**

1. The caller's origin, from its first argument, is the WorkIt extension's.
2. One request names one tenant. The host answers only if that tenant is in the Tracker's Employer accounts list, Keychain has its password, and its password sign-in has not failed (`accounts.failed_sites` over the Tracker's reasons). Otherwise it answers `{none: why}`. It never lists passwords and never returns more than one.
3. The extension's worker takes the tenant from `sender.tab.url` (through `jobOf`), never from the message's text. It asks only after the user clicks the button on that tab, and it sends the answer only to that tab's content script.
4. The host never writes the password to a log, a Record or stderr. It logs one line per release (tenant and time) in `APPLY_HOME`.

**Remaining risk:** anyone who can ship code as the WorkIt extension, such as a bad Web Store update or a malicious unpacked build with the same key, could ask for any listed tenant's password, one at a time. That is the same trust the user already gives the extension that fills these sites. Keychain stays the only copy.

### (b) Push the credentials to the WorkIt backend. Don't.

It would put plaintext employer passwords on WorkIt's server: plaintext at the API, and readable by whoever holds the server's key. It breaks the extension's own rule (passwords never leave the browser) and Apply's ("Never in the Tracker, the repo or a log"). It also gains nothing here, since the extension and Keychain are on the same Mac. KAN-481 ("saved encrypted on WorkIt") would be safe only with a key held on the device, which turns it back into (c).

### (c) The extension's own storage, filled by Apply. Not needed.

- It still needs a channel from Apply to the extension. The Apply window runs in its own Chrome profile (`dashboard.py`, `--user-data-dir`), so `externally_connectable` can't reach the extension in their everyday Chrome. So the channel is native messaging anyway: (a) plus a second copy.
- `chrome.storage.local` is not encrypted at rest (it is LevelDB in the Chrome profile). An "encrypted" store would keep its key next to the data, so it is no safer.
- Two copies drift. Apply resets a password (`Accounts.reset_password`), and the copy in Chrome goes stale and gets typed, and a wrong password can lock a Workday account.
- The one good part is that it reuses `workday_logins`' typing. (a) gets that too: `workdayLogin` asks the host first, and types the answer without saving it.

## 3. The Apply window first: Copy password and Open sign-in page

This is the smallest step, and the only one that needs no extension change.

- **A new Accounts tab** lists `tracker.employer_accounts()`: company, tenant, login and date. It never shows a password.
- **Copy password:** `POST /accounts/copy {site}`, with the window's token and `Origin` check, as every other POST has. The server checks that the site is listed, reads Keychain, and puts the password on the clipboard itself. Use `NSPasteboard` with the `org.nspasteboard.ConcealedType` marker, so clipboard managers skip it. The password is never in an HTTP response, so the page never holds it. The row then says "Copied. Paste it within a minute". The server clears the clipboard after 60 s if it still holds the password. Trade-off: while it is on the clipboard, any app can read it.
- **Open sign-in page:** `open -a "Google Chrome" <url>`. That opens the user's everyday Chrome, not the window's profile. The tenant alone has no Workday site path, so use the Posting link from that company's Tracker row: Workday's job page has Sign In in its header. Check live which path goes straight to the candidate home.
- **Export for Chrome (optional):** this automates today's CSV. `apply accounts export` writes a `0600` file of `url,username,password` for every listed tenant, tells the user to import it, and deletes it once the user says it is done. Use it once, for the accounts made before step 3 exists.

## Build plan, in order

1. **Apply: the Accounts tab** in the window. Copy password through the server's clipboard, with a 60 s clear, and Open sign-in page in their everyday Chrome. Test it with `InMemoryKeychain` and the fake tracker, and check that no password is in any response or log. One commit.
2. **Apply: a one-time CSV export** (`apply accounts export`, a `0600` file deleted after use), for the tenants the user has today. Optional.
3. **Apply: the native host** (`apply/native_host.py`), its wrapper, and `apply doctor` support (installs or checks the host manifest with the extension ID; a warn, never a fail). Test the message framing, the origin check, the listed-tenant check, the failed-site check, and that logs carry no password.
4. **Extension: optional `nativeMessaging`**, with a switch on the options page. In the worker, `workday/apply-login` takes the tenant from `sender.tab.url`, asks the host, and answers only that tab. In `workdayLogin`, the Apply lookup comes before the `workday_signup` fallback.
5. **Extension: the button.** On a Workday Sign In form whose tenant the host knows, show "Sign in with your Apply account". On a click, type into the empty boxes (the existing sign-in fill), save nothing, and press Sign In only under the existing consent (`workday_accounts_for_me`). Then call `navigator.credentials.store(new PasswordCredential({id: email, password, name: company}))` once, so Chrome asks to save it.
6. **Prove it live** on one tenant that Apply made, in the user's Chrome. Check that the button fills, that Chrome's Save password? prompt appears (if `store()` in the isolated world does nothing, try the main world), and that the next visit is filled by Chrome itself.
