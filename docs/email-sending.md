# Sending email to every user (KAN-483)

WorkIt sends email through AWS SES from `alerts@workitjobs.ai`
(`backend/app/services/email.py`), authenticated by the EC2 instance's IAM
role. Three kinds go out: the opt-in daily job alert, the fix-report alert
to admins, and the notices built here, which are a one-off notice to every
account and the account-closure email. Every link in them points at
`https://workitjobs.ai` (the `WEB_URL` default).

Until the human steps below are done, SES is in its sandbox and delivers
only to addresses verified in the SES console.

## What the code does

- `backend/app/scripts/send_notice.py` sends one notice to every active
  account (each applicant, plus each company member whose status is
  active). Each address gets its own message, at most `--rate` a second.
  `--campaign` names the notice in the send log (`email_sends`), so running
  it again with the same name only reaches addresses it missed. A real run
  has to name its recipients: either `--to` (a test list) or
  `--all-accounts`.
- `backend/app/scripts/send_closure_notice.py` sends the one closure email,
  "your account will be closed on <date> because <reason>", once per
  address and date.
- Before sending, both copy SES's account suppression list into
  `email_suppressions`. No notice and no job-alert email goes to an
  address on it (the job alert still writes its bell notification). An
  address SES refuses is not logged, so the next run tries it again.
  If a run is killed between logging an address and sending to it, that
  address is skipped next time: one missed email instead of two.
- What is kept, for privacy (`backend/app/services/retention.py`):
  `email_sends` rows (campaign and address, no account link) are deleted
  1 year after the send by the daily purge. `email_suppressions` is kept
  on purpose, with no period: SES compliance means a bounced or
  complaining address is never mailed again, even if SES drops it from
  its own list.
- The code is in `backend/app/services/notices.py` and the tests in
  `backend/tests/test_notices.py`, which use a fake SES and never reach
  AWS.

Running one, on the EC2 instance:

```sh
cd backend
uv run python -m app.scripts.send_notice --campaign privacy-2026-11 \
  --subject "We updated our privacy policy" --body-file notice.txt \
  --link https://workitjobs.ai/privacy --link-text "Read the policy" --dry-run
# then a verified test address, then everyone:
uv run python -m app.scripts.send_notice ... --to you@example.com
uv run python -m app.scripts.send_notice ... --all-accounts --rate 10
```

Set `--rate` to at most the account's MaxSendRate (SES console, Account
dashboard). It is 1 in the sandbox.

## Human TODO: DNS for workitjobs.ai (Cloudflare)

Checked read-only with `dig` on 2026-10-31. The campus resolver gave
unreliable answers for names it had not cached, so recheck everything
except the apex TXT before trusting it.

| Name | Type | Found |
| --- | --- | --- |
| `workitjobs.ai` | TXT | `v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com ~all` and a Google site verification |
| `_dmarc.workitjobs.ai` | TXT | none (NXDOMAIN) |
| `mail.workitjobs.ai` | MX, TXT | none |
| `<token>._domainkey.workitjobs.ai` | CNAME | could not be checked: the three tokens are only shown in the SES console |

SES sends from its own MAIL FROM domain (`amazonses.com`) by default, so the
SPF result does not match `workitjobs.ai` and DMARC can only pass through
DKIM. Leave the apex SPF alone, since it covers Cloudflare Email Routing and
Google. Add these records:

1. **DKIM.** In SES, Identities > `workitjobs.ai` > Authentication, use
   Easy DKIM (RSA 2048) and add the three CNAMEs it lists, proxy off:
   `<token>._domainkey.workitjobs.ai CNAME <token>.dkim.amazonses.com`.
2. **Custom MAIL FROM**, so SPF passes for our own domain. In the same
   identity, set the MAIL FROM domain to `mail.workitjobs.ai` and choose
   "Use default MAIL FROM domain" for the MX failure behaviour. Then add:
   - `mail.workitjobs.ai MX 10 feedback-smtp.us-east-1.amazonses.com`
   - `mail.workitjobs.ai TXT "v=spf1 include:amazonses.com ~all"`
3. **DMARC.** Start by monitoring, then tighten it after a couple of
   weeks of clean reports:
   - `_dmarc.workitjobs.ai TXT "v=DMARC1; p=none; rua=mailto:dmarc@workitjobs.ai; adkim=r; aspf=r"`
   - after that: `"v=DMARC1; p=quarantine; rua=mailto:dmarc@workitjobs.ai"`

   `rua` only works if `dmarc@workitjobs.ai` reaches someone (a Cloudflare
   Email Routing rule). Otherwise use Cloudflare's DMARC Management, which
   supplies its own `rua` address, or leave `rua` out.

To check it: send one notice with `--to` to a verified Gmail address, open
"Show original", and look for `SPF: PASS`, `DKIM: PASS` and `DMARC: PASS`
with `workitjobs.ai` in each.

## Human TODO: SES console (us-east-1)

1. **Suppression.** Account dashboard > Suppression list: turn on
   account-level suppression for **Bounces and Complaints**. The scripts
   read this list (`ListSuppressedDestinations`).
2. **IAM.** The EC2 instance role needs `ses:SendEmail` (already used) plus
   `ses:ListSuppressedDestinations`.
3. **Production access.** Account dashboard > Request production access.
   Paste the text below and fill in the numbers.

   - Mail type: **Transactional**
   - Website URL: `https://workitjobs.ai`
   - Use case description:

> WorkIt (https://workitjobs.ai) is a job-search app for students. We send
> email only to people who created a WorkIt account, from
> alerts@workitjobs.ai, and never send marketing. There are three kinds:
>
> 1. Account notices: an email before an important change to our privacy
>    policy or terms, and an email before we close someone's account. These
>    are rare, a few times a year at most, and go to every account holder.
> 2. Daily job alerts: a short digest of new matching job postings, sent at
>    most once a day, and only to users who turned them on in Settings.
>    They are off by default, and every alert has a link to turn them off.
> 3. Internal alerts to our own team about user-reported problems.
>
> Volume: about <N> accounts today, so a notice is <N> emails. Job alerts
> go to <M> opted-in users a day. We expect under <X> emails a day in total.
>
> Recipients: only the sign-in address of a WorkIt account. We never buy,
> rent or import lists.
>
> Bounces and complaints: account-level suppression is on for bounces and
> complaints. Before every send, our sending code copies the suppression
> list into our database and skips every address on it, so an address that
> hard-bounced or complained is never emailed again. Each notice is
> recorded per address, so re-running a send never emails anyone twice.
> Each address gets its own message, sent within our SES rate limit.

Once access is granted, check the DNS results above in a received message,
then run a dry run, a `--to` test, and finally `--all-accounts`.
