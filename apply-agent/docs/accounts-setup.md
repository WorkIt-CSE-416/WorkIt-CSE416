# Setting up sign-in: Gmail, Keychain and Google

Or run `./scripts/setup-wizard.sh` from `apply-agent/`: it walks through every one-time setup step (Gmail, Records, notifications, Worker profile sign-in, live runs, the schedule), skipping what's already done.

This is a one-time checklist that takes about 10 minutes. Workday, Oracle and similar job systems make you sign in before they show their questions. Apply signs in for you without spending any tokens:

- **Sign in with Google** wherever an employer offers it, except on Workday. Apply only picks your account in Google's chooser. It never types a Google password or code.
- On Workday it signs in with email and password even where the tenant offers Google, since Google may ask for a passkey after the account pick (ASML's and KLA's tenants). Set `workday_sign_in: google` in your `policies.yaml` to use Google there instead.
- Otherwise it creates an **Employer account** with your email and a new unique password. It saves the password to your macOS Keychain *before* it sends the sign-up form, then lists the account in Apply's Tracker (`tracker.json` in the data folder).
- Where you made an account yourself long ago, a real run **resets its password**: it saves a new password to Keychain first, asks the site for a reset, follows the reset link from Gmail and signs in. A rehearsal never does this.
- It reads **verification codes and links** (Workday's verification and reset emails, from `myworkday.com` or `otp.workday.com`; Oracle's one-time code; Greenhouse's 8-character security code) from your Gmail over IMAP with an app password. It skips a mail Gmail says failed DMARC (a forged sender), and follows a link only to the employer's own site or Workday's.

## 1. A Gmail app password, in Keychain

App passwords need 2-Step Verification on the Google account you apply with.

- [ ] Turn on 2-Step Verification for that account, if it isn't on yet: <https://myaccount.google.com/signinoptions/twosv>.
- [ ] Make an app password named `Apply` at <https://myaccount.google.com/apppasswords>. Google shows 16 letters once.
- [ ] Save it to your login Keychain. Use the address you apply with, as written in the Applicant profile (`identity.email`). The `-w` with no value makes `security` ask for the password, so it never lands in your shell history:

  ```sh
  security add-generic-password -s apply-gmail -a you@gmail.com -w
  ```

- [ ] Check it from `apply-agent/`: `APPLY_TEST_GMAIL=you@gmail.com uv run pytest tests/test_gmail.py -k real`. This signs in to Gmail and runs one search. It reads no mail and changes nothing.

`apply mail` uses the same app password to read your recent employer mail; without it, it says so and stops.

Without this step a run still goes, but every Application that needs a code, a link or a password reset is a Handoff whose reason starts `Gmail isn't set up` or says so.

Changing your Google password revokes every app password. If that happens, make a new one and run the `security` line again with `-U` added, which replaces the old one.

## 2. Employer account passwords

Nothing to set up. You can see every password Apply made in **Keychain Access** under the name `apply-ats`, one item per site (a Workday tenant's host, such as `caci.wd1.myworkdayjobs.com`). Apply's Tracker (`tracker.json`) lists the same sites with the login and the date it was made.

- To sign in yourself, copy the password from Keychain Access.
- If you change a password on the site, update the Keychain item too, or Apply's next sign-in there fails.

## 3. Each Worker profile signed in to Google, by hand

See the Worker profile step of the main setup checklist. Sign each profile in with a plain Chrome started with `--use-mock-keychain --password-store=basic`, never through Apply. If Google ever asks for more than an account pick (a password, a 2-Step code, "Verify it's you"), Apply hands the Application off and says to sign the Worker profiles in again.

## Check the setup: `apply doctor`

Run `uv run apply doctor` from `apply-agent/` before a run, and again after any change here. It checks, read-only and in a few seconds, everything a run needs: the `claude` login, Chrome's version, each Worker profile's Google sign-in (read from its files, so Chrome never opens, and a profile a run has open is skipped), the Gmail app password, the Applicant profile's required facts, Apply's Tracker, the WorkIt login and the writes that wait for WorkIt, a dry-run push of the Records repo, `live_runs` and the Calibration run's progress. Each check prints one line, ok, warn or fail, with how to fix it, and any fail makes it exit non-zero. Add `--usage` to read Claude's Max usage too, at the cost of one tiny Haiku call.

## What a sign-in Handoff means

| Handoff reason starts with | What happened | What to do |
|---|---|---|
| `Sign-in failed at <site>` | The site refused the Keychain password. Apply won't try that password there again, for any Posting, since a few failures lock a Workday account. | Sign in yourself and fix the password in Keychain. Later Postings at that site still hand off, so finish those yourself too. |
| `Type the emailed code: no verification email` / `no verification code` | The mail didn't come within about 2 minutes. Apply asks a site for a code once per sign-in and never asks again. | Look in Gmail (spam too), then sign in and finish the application yourself. |
| `Sign-in failed at <site>: the password reset didn't finish` | Apply asked for a password reset, but the reset email never came. Keychain holds the new password Apply meant to set, which the site doesn't have. | Reset the password yourself, then save it to Keychain (`security add-generic-password -U -s apply-ats -a <site> -w`). |
| `Google asked for more than an account pick` | Google wanted a password, a code or a check. | Sign the Worker profiles in to Google again by hand. |
| `<Company>'s Workday account was made with Google` | You made that tenant's account with Google before, so Keychain has no password for it. Apply never presses Forgot password, since that sends an email. | Sign in once yourself, or reset the password and save it to Keychain (`security add-generic-password -U -s apply-ats -a <site> -w`). |
| `Oracle sent its code by text message` | The site sends codes by SMS. | Finish signing in yourself. |
| `<site> already has an account for … Gmail isn't set up` | You made an account there yourself, and Apply can't reset its password without Gmail. | Sign in yourself and save the password to Keychain (`security add-generic-password -U -s apply-ats -a <site> -w`). |
