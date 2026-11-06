# Signing in to Apply's employer accounts, with the least risk

**Status (2026-11-05):** Built: option 2 and option 3 (`apply chrome-passwords`). Read this note for why the other options were not used.

Researched 2026-11-03 on a Mac with the macOS 26.5 SDK. This follows [apply-passwords-in-chrome.md](apply-passwords-in-chrome.md). The code was read at WorkIt `454d2701` plus PR 345 (`KAN-591-accounts-tab`), read-only. No `apply-ats` password was read, printed or copied. Every test used a dummy server (`apply-test.invalid`) and a dummy password, and each was deleted afterward.

**The goal.** The user opens a Workday tenant in their everyday Chrome, signs in with the account Apply made, and sees their status. It should take about one click, and the password should never sit on the clipboard.

## The short answer

- **Build the extension fill button over native messaging (option 2), then let Chrome save the password (option 3).** The password goes from Keychain through a pipe to the extension and into the tenant's page. It never touches the clipboard, disk or argv. After the first fill, Chrome fills that tenant by itself, on every device the user signs in to Chrome on.
- **An internet password in the Passwords app (option 1) can't be written by Apply.** `security add-internet-password` works, but it writes to the old file-based login keychain, which iCloud Keychain does not sync. A synchronizable item needs a signed app with a provisioning profile, and even then it lands in that app's own access group, not in the Passwords app's list. Tested below.
- **Copy password (PR 345) can then shrink to a fallback, or go.** Once the button works, the 60 s clipboard window isn't needed.

## What I tested (harmless only)

| Test | Result |
|---|---|
| `security add-internet-password -a dummy@example.com -s apply-test.invalid -r htps -w <dummy>` | Exit 0. The item went to `~/Library/Keychains/login.keychain-db`, class `inet`, `ptcl "htps"`. That is the **file-based** keychain. Deleted afterward (`find` exits 44). |
| Unsigned Swift binary: `SecItemAdd` of an internet password with `kSecUseDataProtectionKeychain: true` | `-34018` "A required entitlement isn't present." |
| The same with `kSecAttrSynchronizable: true` | `-34018`, the same error. |
| The same binary, ad-hoc signed with a `keychain-access-groups` entitlement | Killed at launch (exit 137). A restricted entitlement needs a provisioning profile. |
| `printf 'add-generic-password -U -s apply-test-dummy -a apply-test.invalid -w <dummy>\n' \| security -i` | Works. The password goes in on **stdin**, not argv. Deleted afterward. |
| Apple's iCloud Passwords native host | On disk: `/Library/Google/Chrome/NativeMessagingHosts/com.apple.passwordmanager.json` allows `pejdijmoenmkgeppbflobdenhhabjlaj`. |

I did not open the Passwords app (it needs Touch ID). The claim that a login-keychain item doesn't show there rests on Apple's docs below, not on a look. To check it yourself in 30 s: run the dummy `add-internet-password` line above, search the Passwords app for `apply-test`, then `security delete-internet-password -s apply-test.invalid -a dummy@example.com`.

**A side finding, fixed since:** `MacKeychain.save` ran `security add-generic-password ... -w <password>`, so the new password was in argv for a moment. It now uses `security -i` with the command on stdin.

## The options

### 1. An internet password, for the Passwords app and iCloud Passwords

**How it would work.** Save each account as `kSecClassInternetPassword` (server = tenant host, protocol https, account = email) beside or instead of the generic `apply-ats` item. The Passwords app would list it, iCloud Keychain would sync it, and Apple's [iCloud Passwords](https://chromewebstore.google.com/detail/icloud-passwords/pejdijmoenmkgeppbflobdenhhabjlaj) extension would fill it in Chrome ("lets you securely fill passwords from iCloud Keychain when signing in to websites using Chrome").

**Why it doesn't work from Apply:**

- **The CLI writes to the wrong keychain.** [TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains): "The keychain support in the `security` command-line tool is primarily focused on the file-based keychain." Also: "new features, like iCloud Keychain, require the data protection keychain." The test above confirms where the item lands.
- **It does need `kSecAttrSynchronizable`, and that needs entitlements.** [kSecAttrSynchronizable](https://developer.apple.com/documentation/security/ksecattrsynchronizable): an item made with it "behaves like an iOS keychain item," shared "using Access Groups instead of Access Control Lists." TN3137: macOS builds the access groups "from its code signing entitlements. … These entitlements must be authorized by a provisioning profile. Your program needs an app-like bundle structure in which to embed that profile. This is standard for app and app extensions but not for command-line tools." So Python, `security` and an unsigned helper all get `-34018`. A developer with a signing identity could build a signed wrapper app.
- **Even a signed app can't put it in the Passwords app.** A signed app's synchronizable item goes into the app's own access group, not into the Passwords app's AutoFill store. Apple lets an app touch saved web passwords only when "the app developer and website administrator have given their approval and the user has given consent": the app's associated-domains entitlement has to name the site, and the site has to serve an `apple-app-site-association` file that names the app ([App access to saved passwords](https://support.apple.com/guide/security/sec8762eb992/web)). Workday tenants won't name Apply. Apple's new API for this, `ASCredentialDataManager.save(password:for:title:anchor:)`, is marked `@available(macOS, unavailable)` in the 26.5 SDK. Its predecessor `SecAddSharedWebCredential` is deprecated, and it needs the same associated domains ([ASCredentialDataManager](https://developer.apple.com/documentation/authenticationservices/ascredentialdatamanager); `SecSharedCredential.h`).

| | |
|---|---|
| Security | iCloud Keychain is end to end encrypted: items "travel through Apple servers, but are encrypted end-to-end so that Apple and other devices can't read their contents" ([iCloud Keychain security](https://support.apple.com/guide/security/sec1c89c6f3b/web)). It would be the best store, but Apply can't write to it. |
| Effort | Not possible for Apply to automate. |
| Day to day | n/a |
| Everyday Chrome | Only through the iCloud Passwords extension. |
| Sync bonus | iPhone, iPad and any Mac, if the user goes the manual route below (option 6b). |

### 2. The extension fill button, over native messaging

Designed in [apply-passwords-in-chrome.md §2(a)](apply-passwords-in-chrome.md). On a Workday Sign In page, the WorkIt extension shows "Sign in with your Apply account". On a click, the worker calls `chrome.runtime.sendNativeMessage` to a small Apply host. The host checks the caller's origin and that the tenant is in the Employer accounts list, reads that one password from Keychain, and replies on stdout. The extension types it into the form and keeps no copy. This is exactly how Apple's own iCloud Passwords extension reaches Keychain: its host manifest above is a `stdio` native host with `allowed_origins` ([Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)).

| | |
|---|---|
| Security | Who can read it: the Apply host (the logged-in macOS user, reading with the same `security` CLI that made the item, so no new prompt), the extension's worker for one message, and the tenant's page. **Never on the clipboard, disk, a server or argv** (it travels over stdio pipes). Two risks remain. Anyone who can ship code as the WorkIt extension could ask for one listed tenant at a time. Also, like any password typed into a page, any extension with access to that site can read the field. Broad extensions are common. That second risk applies to every option here, including typing it by hand. |
| Effort | Medium: a host module plus its manifest via `apply doctor`, an optional `nativeMessaging` permission, a worker handler, and the button. The build plan is in the earlier note. About 2 to 3 days. |
| Day to day | One click on the sign-in page. No app to open. |
| Everyday Chrome | Yes, in any profile that has the WorkIt extension. The host manifest in `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` covers every profile. |
| Sync bonus | None by itself (it only works on this Mac). Option 3 adds sync. |

### 3. Chrome's password manager

Two ways in: `navigator.credentials.store(new PasswordCredential(...))` from the page after option 2's fill, or Chrome's own save prompt after a sign-in. `store()` is the reliable one. Chrome shows "Save password?" for a new credential. The plain save prompt is unreliable on Workday, because Workday signs in by XHR and Chrome ignores script-set values ([MDN store()](https://developer.mozilla.org/en-US/docs/Web/API/CredentialsContainer/store), [credential_manager_impl.cc](https://chromium.googlesource.com/chromium/src/+/main/components/password_manager/core/browser/credential_manager_impl.cc); details in the earlier note). No extension API writes Chrome passwords (`passwordsPrivate` is component-only).

| | |
|---|---|
| Security | Chrome on a Mac keeps saved passwords in the profile's `Login Data`, encrypted with a key held in the login keychain ("Chrome Safe Storage"). With Chrome sync, they go to Google Password Manager. With **on-device encryption** on, "no one besides you will be able to access your passwords". Without it, Google holds the key ([on-device encryption](https://support.google.com/accounts/answer/11350823)). Check which one the account uses. It creates a second copy, which goes stale if Apply resets a password (`Accounts.reset_password`). Never on the clipboard or in argv. |
| Effort | Small once option 2 exists: one `store()` call after the fill, and a live check of whether it works from the isolated world or needs `world: "MAIN"`. |
| Day to day | The best: Chrome fills the tenant by itself with no button, and the user clicks Save once per tenant. |
| Everyday Chrome | Yes. |
| Sync bonus | Yes: Chrome on any device and Android, signed in to the same Google account. |

### 4. "Open signed in" in an Apply Worker Chrome

Apply opens the tenant in its own Chrome profile and signs in there with its existing Workday sign-in code. Then it hands the window to the user.

| | |
|---|---|
| Security | The password stays inside Apply's process and the page it types into, over CDP. Never on the clipboard. But that profile's cookies and storage sit on disk, as they do today. |
| Effort | Small to medium: the sign-in already exists, so this adds a "show me" action and a visible window. |
| Day to day | Fair: a separate window, not their tabs, bookmarks or extensions. Workday sessions expire, so it signs in again each time. |
| Everyday Chrome | **No.** |
| Sync bonus | None. |

### 5. Typing the password with macOS Accessibility

Apply posts keystrokes (`CGEventPost`, or System Events) into whatever field has focus.

| | |
|---|---|
| Security | The weakest. The process that types needs the **Accessibility** permission, which lets it control every app. Keystrokes go to whatever has focus. If focus is on the address bar, a chat or a search box, the password is typed there and may be sent to a server (a search query, for example). Never on the clipboard. |
| Effort | Small to build, but it needs a permission grant and focus handling, and it's fragile. |
| Day to day | Click the field, press a hotkey or a button in Apply's window, then wait while it types. |
| Everyday Chrome | Yes, and any app. |
| Sync bonus | None. |

**Not recommended.** It gives Apply more power than any other option, and its failure mode leaks the secret.

### 6. Other options

**6a. Google Password Manager CSV import, by hand.** Apply writes a `0600` CSV (`url,username,password`). The user imports it at Google Password Manager settings, then Import passwords ([Import passwords](https://support.google.com/chrome/answer/13068232)), and the file is deleted. Google warns that "anyone who uses the device can open the file" until it's deleted. That plaintext file on disk is the cost. Good for a **one-time backfill** of today's accounts. After that, option 3 covers new accounts.

**6b. Passwords app CSV import, by hand.** In the Passwords app, File > Import Passwords from File, choose the CSV, then Import, and click "Delete [filename]" when it offers ([Import passwords](https://support.apple.com/guide/passwords/import-passwords-mchl2f1a184c/mac)). This is the only way to get these accounts into iCloud Keychain, and so onto their iPhone. In Chrome it then needs the iCloud Passwords extension ("Get Browser Extension" in the Passwords app). It has the same disk-file cost as 6a, and it makes a third copy. Worth it only if the user wants them on their iPhone.

**6c. A password manager's CLI** (`op item create`, `bw create`). Adding one just for this is new infrastructure, and the 1Password CLI takes secrets in argv unless you use a template file. Skip it.

**6d. Fixing Copy password itself.** The 60 s limit can't be made safe: any app can read the general pasteboard while the password is there. The Concealed and Transient markers only ask clipboard managers to skip it. The fix is to stop needing the clipboard (option 2), and keep Copy only as a fallback for a tenant whose sign-in page the button doesn't recognize, perhaps with a shorter window.

## Comparison

| Option | Clipboard / disk / server / argv | Effort | Daily ease | Everyday Chrome | Sync |
|---|---|---|---|---|---|
| 1. Internet password | none, but **can't be written** | not possible | n/a | via iCloud ext. | n/a |
| **2. Native-messaging button** | none / none / none / none | medium | one click | **yes** | no |
| **3. Chrome save via `store()`** | none / Chrome's encrypted DB / Google (E2E if on-device encryption) / none | small after 2 | **zero clicks** | **yes** | **yes** |
| 4. Worker Chrome | none / Apply profile / none / none | small to medium | separate window | no | no |
| 5. Accessibility typing | none, but can mistype into the wrong app | small, fragile | hotkey | yes | no |
| 6a/6b. CSV import | plaintext file until deleted | small | by hand, once | yes | yes |
| Today: Copy password | **clipboard 60 s** | done | paste | yes | no |

## Recommendation

Keep Keychain as the source of truth. Get the password to Chrome **only through the native-messaging button**, and let **Chrome's own Save prompt** (from `store()`) make every later sign-in a zero-click fill. That removes the clipboard, never puts the secret in argv or on disk, and works in their everyday Chrome. If Google Password Manager has on-device encryption on, the synced copy is unreadable to Google too. Don't pursue the internet-password route: Apple doesn't let a script or a non-associated app write into the Passwords app. Skip Accessibility typing.

## Build order

1. **Apply:** write Keychain passwords through `security -i` on stdin, so `MacKeychain.save` no longer puts the password in argv. One small commit.
2. **Apply:** the native host (`apply/native_host.py`, a venv-python wrapper, and the host manifest via `apply doctor`). It checks the origin, the listed tenant and the failed-site list, and logs no password.
3. **Extension:** optional `nativeMessaging`, the worker handler (tenant from `sender.tab.url`), and the "Sign in with your Apply account" button. It comes before the `workday_signup` fallback.
4. **Extension:** after the fill, call `navigator.credentials.store(new PasswordCredential(...))` once, so Chrome offers to save it.
5. **Prove it live** on one Apply-made tenant. Check that it fills, that the Save prompt appears, and that the next visit is filled by Chrome alone.
6. **Then** cut Copy password (PR 345) down to a fallback, or remove it. Optionally, run a one-time CSV export for Google Password Manager import (6a) to backfill today's accounts, and for the Passwords app (6b) if the user wants them on their iPhone.
