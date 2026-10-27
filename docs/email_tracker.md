# Email tracker: Connect Gmail (KAN-413)

Status: **draft, not yet reviewed by the team.** Nothing built. Every
decision below is a proposal; the open questions are at the end.

## Goal

A student connects Gmail once. From then on, WorkIt finds the emails about
their applications (confirmations, assessments, interviews, offers,
rejections), works out which application each one is about, and proposes
the change: "Stripe invited you to an interview. Move it to Interviewing?"
The student accepts or rejects each proposal; nothing on the tracker
changes until they do.

This fills screens that already exist but have no data today:

- The Applications board's **Interviewing** and **Offer** columns.
- The **Calendar** (`(seeker)/calendar/`): interviews, deadlines, offers.
- The detail panel's timeline.

`frontend/src/app/(seeker)/tracker.ts` says it plainly: "Interviewing,
offer and dated events are not stored yet." This feature stores them.

## Non-goals (pilot)

- Sending, editing, deleting or labelling any email. Read only.
- Outlook, Yahoo or school mail on Microsoft 365. Later: a Microsoft
  connection or a forwarding address feeding the same pipeline.
- Verification codes for the autofill (Workday sign-up codes). Later.
- Tracking applications made outside WorkIt for job postings WorkIt does not
  have. Later (open question 7).
- A calendar feed to Google Calendar or Apple Calendar. Later.

## What the student sees

### 1. Connect Gmail

A **Connect Gmail** card on the Applications page (and in Settings). It
says what WorkIt reads, what it never does, and, during the pilot, that
Google will show a "Google hasn't verified this app" screen with how to get
past it. The button opens Google's consent screen for one permission:
read-only Gmail.

After consent, Google sends the student back to WorkIt, which shows
"Connected as ana@gmail.com. Checking your recent emails..."

### 2. First check (backfill)

WorkIt reads job emails from the earliest application date, at most 120
days back, at most 500 messages. Results arrive as proposals within a few
minutes.

### 3. A new email arrives

Within about 15 minutes, a proposal appears in **Updates** (a list on the
Dashboard and a badge on the Applications page):

> **Stripe · Software Engineer Intern**
> Interview invite · Tue Nov 4, 2:00 PM ET
> [Move to Interviewing] [Not right] [Wrong job?]

- **Move to Interviewing** applies it: the stage changes and the interview
  goes on the Calendar.
- **Not right** dismisses it.
- **Wrong job?** lets the student pick another of their applications.

A **Check now** button forces a check, at most once a minute.

### 4. Unmatched emails

An email that looks job-related but matches no application shows under
**Couldn't match** with the company and subject. The student links it to an
application or dismisses it. Unmatched items are deleted after 30 days.

### 5. Disconnect

Settings > Email > **Disconnect**. WorkIt revokes its access at Google,
deletes the stored key at once and deletes pending proposals. Accepted
updates stay on the tracker, because they are the student's own record,
unless the student also ticks "Delete everything WorkIt got from Gmail".
Google's policy requires that we honour that.

### 6. Without Gmail

A student can add an interview, offer or rejection by hand on any
application. This uses the same table and fills the Calendar for students
who never connect Gmail. It ships first (build order, step 2).

## How it works

```
 Gmail ──read──▶ 1. Fetch ──▶ 2. Filter ──▶ 3. Match ──▶ 4. Classify ──▶ 5. Propose ──▶ student
 (read-only)     new mail     job emails    which         what it means  application_events   accepts
                 since last   only          application   + dates         (proposed)          or not
                 check
```

### 1. Fetch

The Gmail API's `history.list` from the last stored `history_id` returns
only what is new since the last check (2 quota units a call). The first
check uses `messages.list` with a search query instead.

### 2. Filter: which emails we read

Each check runs a Gmail search, so WorkIt fetches only matching messages,
never the whole inbox:

- **Hiring-system senders:** greenhouse.io, greenhouse-mail.io, lever.co,
  hire.lever.co, ashbyhq.com, myworkday.com, workablemail.com,
  smartrecruiters.com, icims.com, jobvite.com, bamboohr.com,
  recruitee.com. One list in code, shared with matching. Check each domain
  against real emails before shipping.
- **The student's own companies:** the website domain of each company they
  applied to (open question 4), such as `from:stripe.com`.
- **Words:** `subject:(interview OR "your application" OR "thank you for
  applying" OR assessment OR "next steps" OR offer)`.
- **Excluded:** job-alert digests and newsletters (LinkedIn job alerts,
  Handshake digests), and the Promotions and Social tabs.

A long query is split into several; Gmail limits query length.

### 3. Match: which application is this about

Rules first, no model. The candidates are the student's applications in
`saved`, `queued`, `applied`, `interviewing` or `offer`.

| Signal | Weight |
|---|---|
| The sender's domain is the company's domain | Strong |
| A link in the body names the job posting's board (`boards.greenhouse.io/stripe`, the token in `apply_url`) | Strong |
| The company name appears in the sender's display name or subject ("Stripe Recruiting") | Strong |
| The company name appears in the body (trigram similarity, as the Jobs page's company search) | Medium |
| The job title appears in the subject or body | Tiebreaker |
| The email arrived after the application's `applied_at` | Required for applied jobs |

- One application wins clearly: matched.
- Several jobs at the same company and the title does not decide: the
  proposal asks the student to pick one of them.
- None: **Couldn't match** (flow 4).

### 4. Classify: what it means

Also rules first. Hiring-system emails are templates, so subject patterns
classify most of them ("Thank you for applying to", "Unfortunately",
"Invitation to interview", "HackerRank", "CodeSignal").

| Kind | Example | Proposed change |
|---|---|---|
| `confirmation` | "Thanks for applying to Stripe" | `saved` or `queued` to `applied`; otherwise none, timeline only |
| `assessment` | "Complete your CodeSignal assessment by Nov 3" | No stage change; a deadline on the Calendar |
| `interview` | "Invitation: Technical Interview, Nov 4" | to `interviewing`; the interview on the Calendar |
| `offer` | "Your offer from Stripe" | to `offer`; a "Respond by" date if stated |
| `rejection` | "We've decided to move forward with other candidates" | to `rejected` |
| `other` | A recruiter's "quick question" | No stage change; timeline only |

When the rules cannot decide, or the email has a date to read, **one model
call** through Scout's chain (`workit_scout/llm.py`) returns the kind, the
company, the title and any date and time, as a schema. Before the call:

- The identity seam removes the student's name, email, phone and links, as
  it does for every model call.
- Quoted replies and signatures are cut, and the text is cut to 2,000
  characters.
- An attached calendar invite (`text/calendar`) is read directly, with no
  model: it holds the exact time and time zone.

A cap per student per UTC day (say 50 model calls) protects the free tier,
through the same counter as the other AI features (`services/usage.py`).

### 5. Propose, then apply

Every result becomes a row in `application_events` with status `proposed`.
Nothing changes on the tracker until the student accepts.

Stages only move forward on their own: `applied` to `interviewing` to
`offer`, and any of them to `rejected`. An older email that arrives late
("thanks for applying" after an interview) adds a timeline entry and
proposes no stage change. The student can still set any stage by hand.

## Data model

All three changes are migrations (`backend/alembic/CLAUDE.md`). Claude
writes them and checks them with `--sql`; the user applies them, after the
migration merges to `main`. Both new tables enable RLS with no policies.

### `application_stage`: three new values

`interviewing`, `offer`, `rejected`. An `ALTER TYPE ... ADD VALUE` and a
coordinated deploy, as `models/dto.py` says.

### `gmail_connections` (new)

| Column | Type | Note |
|---|---|---|
| `applicant_id` | uuid, PK, FK `applicant_profiles` ON DELETE CASCADE | One connection per student |
| `google_email` | text | Shown as "Connected as..." |
| `refresh_token` | bytea | **Encrypted** (AES-GCM, key `GMAIL_TOKEN_KEY`, backend only). Never logged, never in a response |
| `scopes` | text[] | What Google granted |
| `history_id` | bigint, null | Where the next check starts |
| `status` | text: `active`, `revoked`, `error` | `revoked` when Google refuses the key (the student removed access at Google) |
| `connected_at`, `last_checked_at` | timestamptz | |
| `backfill_cursor` | text, null | The page token while the first check is still running |

### `application_events` (new)

One dated thing on one application, from Gmail or typed by the student.

| Column | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `applicant_id` | uuid, FK ON DELETE CASCADE | |
| `job_id` | uuid, null | Null while unmatched. Composite FK `(applicant_id, job_id)` to `job_applications`, ON DELETE CASCADE |
| `kind` | enum: `confirmation`, `assessment`, `interview`, `offer`, `rejection`, `other` | |
| `status` | enum: `proposed`, `accepted`, `dismissed` | Typed by hand starts `accepted` |
| `source` | enum: `gmail`, `manual` | |
| `starts_at` | timestamptz, null | Interview time |
| `due_at` | timestamptz, null | Assessment deadline, offer "respond by" |
| `title` | text | "Technical Interview", as `TrackerEvent` names it |
| `summary` | text, null | One sentence |
| `meeting_url` | text, null | Zoom or Meet link, if the email has one |
| `gmail_message_id` | text, null | Unique per applicant; stops a message being read twice |
| `received_at` | timestamptz, null | |
| `sender_domain`, `subject` | text, null | Subject cut to 200 characters; shown on unmatched items |
| `created_at`, `decided_at` | timestamptz | |

**We never store the email body.** Only the fields above. The API can fetch
a message again from Gmail if the student asks to see it.

The API's response shape follows the fixture the screens already render
(`TrackerEvent` in `tracker.ts`): `interview` maps to its `interview` kind,
`assessment` and an offer's respond-by date to `deadline`, `offer` to
`offer`.

## API routes

Layer 3 routes, each calling one layer-2 function, as auto apply's are.
Every route checks that the caller owns `{id}`.

| Method | Path | Does |
|---|---|---|
| POST | `/applicants/{id}/gmail/connect` | Returns Google's consent URL with a signed, short-lived `state` |
| POST | `/applicants/{id}/gmail/callback` | Takes `code` and `state`, swaps the code for a key, stores it, starts the first check |
| GET | `/applicants/{id}/gmail` | Connected or not, the address, last check |
| POST | `/applicants/{id}/gmail/check` | Check now; at most once a minute |
| DELETE | `/applicants/{id}/gmail` | Revoke at Google, delete the key and pending proposals; `?all=true` also deletes accepted Gmail events |
| GET | `/applicants/{id}/events?status=proposed` | Updates and Couldn't match |
| POST | `/applicants/{id}/events` | Add an event by hand |
| POST | `/applicants/{id}/events/{event_id}/accept` | Optional `job_id` (Wrong job?); applies the stage change |
| POST | `/applicants/{id}/events/{event_id}/dismiss` | |
| GET | `/applicants/{id}/applications/{job_id}/events` | The detail panel's timeline |
| POST | `/internal/gmail/check-all` | For the schedule only; a shared secret, not a student token |

**The callback lands on the Next app**, not the API: Google redirects the
browser to `workitjobs.ai/connect/gmail/callback`, and a Server Action
forwards `code` and `state` to the API with the student's Bearer token.
The browser still never calls the API directly.

**Connect Gmail is its own Google sign-in, not Supabase's.** Google sign-in
for WorkIt accounts asks only for name and email. Adding a Gmail permission
there would show every new user the warning screen.

## The schedule

Every 15 minutes, a scheduled job calls `/internal/gmail/check-all`, which
checks each active connection. At 100 students that is about 9,600 small
calls a day, far under Gmail's quota.

- **Before the Cloudflare cutover:** a GitHub Actions schedule, as the
  scrape already uses (`.github/workflows/scrape.yml`). Its timing is loose,
  which is fine here.
- **After:** a Cron Trigger on the Worker in `backend/cloudflare/`.

Push notifications (Gmail `watch` through Google Cloud Pub/Sub) would cut
the delay to seconds. Add them after the pilot if 15 minutes feels slow.

## Google's rules

### Projects

The Google Cloud projects belong to the team Gmail, never one person's
account, as the Cloudflare account does.

- **`workit-gmail-dev`**, in Testing. The team's own Google accounts are
  its test users. Keys expire every 7 days; reconnect when they do. Its
  redirect URI is `http://localhost:3000/connect/gmail/callback` (Google
  needs the exact port).
- **`workit-gmail-prod`**, published but unverified during the pilot. It
  allows **100 students over the life of the project**, and the count never
  resets. **The team never tests on it**, so the 100 slots go to students.

### Verification (start the day step 3 starts; it takes 2 to 8 weeks)

1. Verify `workitjobs.ai` in Google Search Console.
2. Consent screen: name, logo, homepage, privacy policy, terms.
3. Privacy policy gains a Gmail section and Google's Limited Use sentence:
   "WorkIt's use and transfer of information received from Google APIs will
   adhere to the Google API Services User Data Policy, including the
   Limited Use requirements."
4. A short demo video of Connect Gmail and an update being accepted, and a
   written reason for the read-only Gmail permission.
5. A CASA security assessment (Tier 2) from a lab Google approves. About
   $540 a year at the low estimate; estimates run to several thousand.
   Repeated every 12 months.

### What Limited Use means for us

- Gmail data is used only for the tracker.
- No ads, no selling, and no person on the team reads a student's email
  (except with the student's consent for support, or for security or the
  law).
- **No model training on it, or on anything derived from it.** The model
  provider must not train on what we send it either (open question 3).

## Privacy and security

- The refresh key is encrypted at rest, lives only in `backend/`, and is
  deleted on disconnect. The encryption key is a backend secret like the
  service-role key.
- `hide_parameters=True` already keeps statement values out of logs; no log
  line may print an email's subject, body or the key.
- We keep derived fields only, never bodies. Dismissed and unmatched events
  are deleted after 30 days.
- The model sees the email only after the identity seam, cut short.

## Costs

| Item | Cost |
|---|---|
| Gmail API | Free |
| CASA assessment | About $540 a year (low estimate), about $45 a month |
| Model calls | Small: rules classify most emails, and a daily cap applies |
| Storage | A few KB per student |

Under the $200 a month budget.

## Build order

1. **Migration:** the three stages, `application_events`,
   `gmail_connections`. Merged to `main`, then applied by the user.
2. **Events by hand:** add and edit interviews, offers and rejections; the
   board's Interviewing and Offer columns, the Calendar and the timeline read
   live data. Useful without Gmail.
3. **Google projects and Connect Gmail:** the consent flow, the callback,
   encrypted keys, Disconnect. **Submit for verification now.**
4. **Fetch and filter:** the first check and incremental checks, by hand
   (Check now).
5. **Match and classify by rules**, proposals, the Updates list and Couldn't
   match.
6. **Model fallback** for what the rules miss, behind the identity seam and
   the daily cap.
7. **The 15-minute schedule.**
8. **Pilot** with up to 100 students on the prod project.

Later, in rough order: verification codes for the autofill, a calendar
feed, an interview prep pack when an interview is accepted, "which resume
gets interviews" (events joined to `sent_resume_id`), ghosting detection,
an MCP tool for updates, Gmail push, Outlook and forwarding.

## Open questions

1. **Rejected applications:** a Closed column on the board, or hidden from
   the board and kept in the list view?
2. **Auto-accept:** should low-risk updates (a confirmation for a job
   already `applied`) apply without asking? Proposal: a setting, off by
   default.
3. **Model data terms:** does Scout's provider (Groq) keep or train on what
   we send? Does any configured fallback use a free tier whose terms allow
   training? Email text must never reach one that does.
4. **Company domains:** `job_postings` has no company domain column. The
   scraper's `logos.py` already finds each company's site; should the
   import store it as `company_domain`? Without it, matching relies on
   names and board links.
5. **Where Connect Gmail lives:** the Applications page, onboarding,
   Settings, or all three?
6. **The schedule's host** until the Cloudflare cutover: GitHub Actions, or
   wait for the Worker's Cron Trigger?
7. **Applications made outside WorkIt:** a confirmation for a job posting
   WorkIt has could create the application. One WorkIt does not have would
   need a new kind of application with no `job_id`. Pilot or later?

## Docs to update with the code

- `backend/CLAUDE.md`: new env vars (`GMAIL_CLIENT_ID`,
  `GMAIL_CLIENT_SECRET`, `GMAIL_TOKEN_KEY`, `INTERNAL_CRON_SECRET`), the
  routes, the schedule.
- `frontend/CLAUDE.md` and `frontend/docs/screens.md`: Connect Gmail, the
  Updates list, the callback route.
- `tracker.ts`'s header: dated events are now stored.
- `docs/architecture.md`: Gmail as a new outside service.
- The root `CLAUDE.md`'s pointer to this file: from "draft" to "built", and
  what was built.
- `GLOSSARY.md`: **Update** (a proposed change from one email) and
  **Application event** (one dated thing on an application).
- The Privacy page: the Gmail section and the Limited Use sentence.
