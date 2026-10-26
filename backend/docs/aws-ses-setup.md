# Setting up AWS SES for job-alert email (KAN-298)

The code side of this is done: `app/services/email.py`'s `send_email`
calls AWS SES through `boto3`, authenticating with whatever IAM role is
attached to the machine it runs on — never a stored key. Everything on
this page is the AWS/EC2 side, which is run by hand, by a person, the
same way `backend/CLAUDE.md` has you run `alembic upgrade head` yourself
instead of Claude running it: these steps touch real AWS infrastructure
and send real email.

## Checklist

- [ ] Verify a sending identity in SES
- [ ] Get out of the SES sandbox, or verify test recipients
- [ ] Create the IAM role and policy
- [ ] Point an EC2 instance at this repo
- [ ] Set the instance's environment variables
- [ ] Add the crontab entry
- [ ] (Optional) Add failure alerting

## 1. Verify a sending identity in SES

In the SES console, pick the region you'll run the EC2 instance in
(`us-east-1` unless you set `AWS_REGION` to something else — matches
Supabase's own region, so it's also the lowest-latency choice). Under
**Identities → Create identity**, verify either:

- the `workitjobs.ai` domain (adds DNS records at your registrar — the
  real, production path), or
- a single email address (faster for testing; SES emails that address a
  confirmation link).

Either way, set `SES_FROM_EMAIL` (step 5) to an address under whichever
identity you verified. The code's default is
`WorkIt <alerts@workitjobs.ai>`.

## 2. SES sandbox

Every new SES account starts in the **sandbox**: it can only send *to* an
address that has also been individually verified, and a send to anyone
else is rejected outright. Two ways forward:

- **For testing**: verify your own address (or a teammate's) the same
  way as step 1, and send test digests only to that.
- **For real applicants**: in the SES console, **Account dashboard →
  Request production access**. AWS reviews this (usually same-day to a
  few days) and asks what you're sending and how recipients opted in —
  the Settings opt-in `applicant_profiles.job_alerts_enabled` gates this,
  so you have a real answer.

Nothing in the code needs to change either way: `send_email` already
treats a sandbox rejection as a plain best-effort failure (logged,
returns `False`, the applicant's bell notification still gets written)
— exactly how a bounced send behaves everywhere else in this app.

## 3. IAM role and policy

Create an IAM role for EC2, with this policy attached (tighten
`Resource` to your verified identity's ARN once you have one —
`arn:aws:ses:<region>:<account-id>:identity/workitjobs.ai` — `*` is only for
getting started):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": "*"
    }
  ]
}
```

Attach it to the EC2 instance as its **instance profile** — not a static
access key pair. This is the whole reason the setup uses an instance
role: `boto3` on the box picks up temporary credentials from the
instance's metadata automatically, there is no key to store, email,
or rotate, and nothing written to this repo's `.env` ever needs AWS
credentials in it.

## 4. Point an EC2 instance at this repo

Launch (or reuse) an instance in the same region as step 1, with the
role from step 3 attached. On it:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh   # installs uv
git clone <this repo's URL>
cd WorkIt-CSE416/backend
uv sync --locked
```

## 5. Environment variables

Same root `.env` layout the rest of this backend uses
(`backend/CLAUDE.md`'s "The database" table) — put this at
`WorkIt-CSE416/.env` on the instance, never committed:

```
DATABASE_URL=...          # same pooler URL as everywhere else
GEMINI_API_KEY=...        # scores the digest's semantic match
EMBEDDING_PROVIDER=gemini
WEB_URL=https://workit-web-gamma.vercel.app

# Both optional; shown with their defaults.
AWS_REGION=us-east-1
SES_FROM_EMAIL=WorkIt <alerts@workitjobs.ai>
```

Nothing AWS-credential-shaped goes here — that's the instance role from
step 3.

## 6. The crontab entry

`crontab -e`, one line, matching the digest's 13:13 UTC schedule (off the
hour — same reasoning `.github/CLAUDE.md`'s scrape cron gives):

```
13 13 * * * cd /path/to/WorkIt-CSE416/backend && git pull && uv sync --locked && uv run python -m app.scripts.send_job_alerts >> /var/log/job-alerts.log 2>&1
```

This is now the **one real schedule** for the digest.
`.github/workflows/job-alerts.yml` keeps no `schedule:` trigger of its
own anymore (GitHub's runners have no AWS credentials and never will) —
it still runs on every relevant pull request, always `--dry-run`, as a
free smoke test of the digest-building and bell-notification path, and
stays available for a manual `workflow_dispatch` run, which can only
prove that same path since it has no IAM role to send real mail with.

## 7. Failure alerting (optional, still open)

GitHub Actions emailed you for free when a scheduled run failed; a
crontab entry doesn't. Lightest option: append a `curl` to a free
dead-man's-switch ping (e.g. [healthchecks.io](https://healthchecks.io)'s
free tier) to the crontab line, so a missed or failed run pages you.
CloudWatch alarms are the heavier alternative and need their own IAM
permissions. Neither is set up yet.

## Verifying it worked

```bash
# From the EC2 instance (has the IAM role): should land in the inbox
# of an address you verified in step 1/2.
uv run python -m app.scripts.send_job_alerts

# From anywhere without that role (a laptop, GitHub Actions): should
# log a warning, send nothing, and still write the bell notification.
uv run python -m app.scripts.send_job_alerts
```

`uv run pytest tests/test_email.py` covers the three outcomes
(`send_email` succeeds, SES rejects the recipient, no credentials are
available) without needing real AWS access.
