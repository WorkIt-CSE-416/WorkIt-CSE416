# Email tracker: Connect Gmail (KAN-413)

Status: **draft, not yet reviewed by the team.** Build step 1 is built
(migration `a7d3e5f1c2b4`, not yet applied to the shared database): the
three stages after applied, the stage menu, and events added by hand,
which feed the timeline, the Calendar and Home's Interviewing
number. Nothing that reads Gmail is built. Every other decision below is a
proposal; the open questions are at the end.

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

### Where it lives

**Email has its own page, the Inbox (`/inbox`).** The first plan put
emails only on existing screens; built that way, an email table stacked on
the Applications Tracker read as a second, worse copy of the applications
list, hid the list below the fold, and showed jobs instead of messages. A
design critique (2026-10-27) moved email to a page of its own, laid out as
a mailbox:

| Piece | Where |
|---|---|
| Connect, "Connected as...", last check, Check now, Disconnect, delete data | Gmail's row in Settings > **Integrations**, beside Google Calendar's (after Claude's connectors list: each app's logo, name, one line and Connect) |
| Every email | The **Inbox** (`/inbox`, a sidebar row after Applications Tracker, no count badge): filter chips (All, Needs Review with its count, Interviews, Assessments, Offers, Rejections), a list beside a reading pane |
| One email in the list | The sender's logo and name, the received time, the subject, one line of its text, its kind's pill; a dot and a bold subject while it needs review; Not Linked when it matched no job |
| One email, read | The reading pane, as Gmail lays out an open message: the subject, the pill with the date it names, Open Application and Add to Calendar as icons; one quiet card only when it needs review ("Move Research Internship to Interviewing?", Move and Not Now; or Link to Job); the sender's line ("to me", received time, Reply); the text. Reply opens Gmail on the subject; Add to Calendar opens Google Calendar's own new-event page, filled in |
| The emails waiting, on the tracker | One line above the Applications Tracker's filters, only while some wait: "3 emails need a look · Open Inbox" |
| Every email about one job | An **Emails** tab on the application's page, beside Your Application and Job Description, the Inbox's rows for that job; a row opens it in the Inbox |
| What an accepted email changes | The stage, the application's timeline and Interviews & Dates, the Calendar, and Home's Next Up, Up Next and Waiting |

**Most emails ask nothing** (open question 2, decided 2026-10-27): an
email that changes no stage (Application Received, Assessment, Update, or
a move the application is already past) is filed onto its application
when it arrives (backend `needs_review`, `file_email`). Only one that would
move the stage, or that matched no job, waits in Needs Review. Not Now
leaves it off the tracker; every email stays in the Inbox as a record.

**What the critique cut**, so it does not come back: a sidebar count badge;
a card per email with Move to Interviewing, Not Right and Wrong Job?
under two tabs; a table of emails on the tracker (first with an Email
column, a line under each pill and Accept and dismiss on every row, then
three columns opening a side panel); that panel's row of worded buttons;
loud violet pills for emails that change nothing. An email's kind is its
pill, the same name and colour everywhere (`applications/email-kinds.tsx`):
Interview amber, Offer green, Rejection red, Assessment the "advanced"
tone, Application Received and Update grey.

```
Inbox      (All) (Needs Review 3) (Interviews) (Assessments) (Offers) (Rejections)
┌────────────────────────────────┬───────────────────────────────────────────┐
│ ● Ai2                  9:42 AM │ Invitation: Technical Interview    ⧉  📅 │
│   Invitation: Technical Int... │ (Interview) Nov 4, 2:00 PM               │
│   Thanks for your interest...  │ ┌───────────────────────────────────────┐ │
│   (Interview)                  │ │ Move Research Internship to Inter...? │ │
│   SEL                  Oct 27  │ │                     [Move] [Not Now]  │ │
│   Complete your HackerRank...  │ └───────────────────────────────────────┘ │
│   (Assessment)                 │ (logo) Ai2       Tue, Oct 27, 9:42 AM ↩ │
│ ● Datadog?             Oct 24  │        to me                             │
│   (App. Received) (Not Linked) │ Hi Andrew, ...                           │
└────────────────────────────────┴───────────────────────────────────────────┘
```

The Calendar page and Home's Next Up, Up Next and Waiting were
hidden because the tracker stored no dated events (the sidebar's Calendar
line is commented out, and `src/proxy.ts` sends `/calendar` to the
Home). Events typed by hand (flow 6) bring them back before Gmail
does.

### 1. Connect Gmail

Gmail's **Connect** in Settings > **Integrations**, or the prompt card on
the Applications Tracker. The row stays one line; the step Connect opens
says what WorkIt reads, what it never does, and, during the pilot, that
Google will show a "Google hasn't verified this app" screen with how to
get past it (the first design put all of that on the settings page, and
the user found it too much). It then opens Google's consent screen for one
permission: read-only Gmail.

After consent, Google sends the student back to Settings > Integrations,
where Gmail's row shows "Connected as ana@gmail.com. Checking your recent
emails..."

### 2. First check (backfill)

WorkIt reads job emails from the earliest application date, at most 120
days back, at most 500 messages. Results arrive as proposals within a few
minutes.

### 3. A new email arrives

Within about 15 minutes, the email is in the **Inbox** and in the job's
**Emails** tab. A confirmation, an assessment or an update is filed onto
its job at once. "Invitation: Technical Interview" from Stripe would move
the application, so it waits in **Needs Review**, and the Applications
Tracker's notice counts it. Its reading pane asks "Move Software Engineer
Intern to Interviewing?":

- **Move** applies it: the stage changes and the interview goes on the
  timeline and the Calendar.
- **Not Now** leaves it off the tracker; the email stays in the Inbox.
- **The wrong job:** Not Now for now; moving an email to another job is
  not built (the API's Accept already takes a `job_id`).

A **Check now** button forces a check, at most once a minute.

### 4. Unmatched emails

An email that looks job-related but matches no application shows in the
Inbox as Not Linked, in Needs Review; its reading pane asks which job it
is about, with **Link to Job** and Not Now. The student links it to an application or dismisses it. Unmatched items are deleted after 30 days.

### 5. Disconnect

Settings > Integrations > Gmail's **Disconnect**. WorkIt revokes its access at Google,
deletes the stored key at once and deletes pending proposals. Accepted
updates stay on the tracker, because they are the student's own record,
unless the student also ticks "Delete everything WorkIt got from Gmail".
Google's policy requires that we honour that.

### 6. Without Gmail

A student can add an interview, assessment deadline, offer or rejection by
hand on any application, from **Add Event** in the detail panel, and can
set any stage from the stage menu. This uses the same table and fills the
Calendar for students who never connect Gmail. It ships first (build
order, step 1).

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

Each change is a migration (`backend/alembic/CLAUDE.md`). Claude writes
them and checks them with `--sql`; the user applies them, after the
migration merges to `main`. Every new table enables RLS with no policies.
`a7d3e5f1c2b4` (step 1) holds the stages and `application_events` with the
columns events typed by hand need; step 3's migration adds
`gmail_connections` and the Gmail columns marked below.

### `application_stage`: three new values

`interviewing`, `offer`, `rejected` (built). An `ALTER TYPE ... ADD
VALUE` and a coordinated deploy, as `models/dto.py` says. **Each still
counts as applied** (`dto.APPLIED_STAGES`): the Jobs page hides the job,
and the Applied button never moves one back to applied.

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
| `title` | text | "Technical Interview", as `TrackerEvent` names it |
| `at` | timestamptz, null | Something at a time: an interview |
| `on_day` | date, null | Something due on a day: an assessment. **Exactly one of `at` and `on_day`** (`application_events_one_when`): a date stored as midnight UTC reads as the day before in the Americas |
| `note` | text, null | The student's note, or a one-line summary of an email |
| `meeting_url` | text, null | A Zoom, Meet or Teams link; the API takes only `http(s)://` |
| `created_at`, `updated_at`, `decided_at` | timestamptz | |
| `gmail_message_id` | text, null | **Step 3.** Unique per applicant; stops a message being read twice |
| `received_at` | timestamptz, null | **Step 3** |
| `sender_domain`, `subject` | text, null | **Step 3.** Subject cut to 200 characters; shown on unmatched items |

**We never store the email body.** Only the fields above. The API can fetch
a message again from Gmail if the student asks to see it.

The screens draw an event as `tracker.ts` already drew one
(`ApplicationEvent`, mapped in `applications/tracked.ts`): `interview`,
`offer` and `rejection` keep their names, `assessment` is a `deadline`,
and `other` (Add Event's Follow-Up) and `confirmation` are a `follow-up`.

**An event moves its application forward, never back** (`advance` in
`queries/tracker.py`): an interview to Interviewing, an offer to Offer, a
rejection to Rejected, each only when the application is behind it; an
assessment or a follow-up leaves the stage alone, and nothing but the
stage menu moves a rejected application. Deleting an event leaves the
stage where it is.

## API routes

Every route checks that the caller owns `{id}`. Built in step 1
(`backend/app/routers/tracker.py`, over `queries/tracker.py`):

| Method | Path | Does |
|---|---|---|
| PUT | `/applicants/{id}/applications/{job_id}/stage` | The stage menu: applied, interviewing, offer or rejected, any direction; an undated application gets today |
| GET | `/applicants/{id}/events` | Every accepted event, soonest first; the tracker joins them by `job_id` |
| POST | `/applicants/{id}/applications/{job_id}/events` | Add Event; answers the event and the stage after it |
| DELETE | `/applicants/{id}/events/{event_id}` | The stage stays |

Built in step 2 (the Inbox's routes, which need no Google):

| Method | Path | Does |
|---|---|---|
| GET | `/applicants/{id}/events?status=proposed` | The emails that need review, newest first (the tracker's notice counts them); `job_id` null matched no application |
| GET | `/applicants/{id}/emails` | The Inbox and each job's Emails tab: every email, whatever its status, newest first by when it was read |
| POST | `/applicants/{id}/events/{event_id}/accept` | Optional `job_id` (an unmatched email's pick); puts it on the tracker and moves the application forward through `advance` |
| POST | `/applicants/{id}/events/{event_id}/dismiss` | The cross; it stays off the tracker |

Planned, for Gmail:

| Method | Path | Does |
|---|---|---|
| POST | `/applicants/{id}/gmail/connect` | Returns Google's consent URL with a signed, short-lived `state` |
| POST | `/applicants/{id}/gmail/callback` | Takes `code` and `state`, swaps the code for a key, stores it, starts the first check |
| GET | `/applicants/{id}/gmail` | Connected or not, the address, last check |
| POST | `/applicants/{id}/gmail/check` | Check now; at most once a minute |
| DELETE | `/applicants/{id}/gmail` | Revoke at Google, delete the key and pending proposals; `?all=true` also deletes accepted Gmail events |
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

1. **Built: the stages and events by hand.** Migration `a7d3e5f1c2b4`
   (the three stages, `application_events`); the stage menu and
   Interviews & Dates with Add Event and Delete on an application's page;
   the timeline, the Calendar (back in the sidebar) and Home's
   Interviewing number read them. Useful without Gmail. The migration is
   merged to `main` in its own PR and applied by the user before the
   deploy. **Not done in step 1:** editing an event (delete and add it
   again), and Home's Next Up, Up Next and Waiting, still archived
   (`frontend/docs/screens.md`, Seeker Home).
2. **Built: the email screens that need no Google.** The Inbox (`/inbox`,
   a list and a reading pane), the one-line notice on the Applications
   Tracker, the Emails tab on each application's page, `GET .../emails`,
   the filing rule (`needs_review`, `file_email`), the three routes above, and Settings > Integrations
   as a design (Gmail and Google Calendar rows, each Connect disabled and
   marked Coming Soon). They show
   nothing until something proposes an event. Still to do: the
   Applications Tracker's prompt card, which waits for Connect Gmail to
   work, and Home's Next Up, Up Next and Waiting.
3. **Google projects and Connect Gmail:** `gmail_connections` and the
   Gmail columns (a migration), the consent flow, the callback, encrypted
   keys, Disconnect. **Submit for verification now.**
4. **Fetch and filter:** the first check and incremental checks, by hand
   (Check now).
5. **Match and classify by rules**, proposals, the Updates list and Couldn't
   match.
6. **Model fallback** for what the rules miss, behind the identity seam and
   the daily cap.
7. **The 15-minute schedule.**
8. **Pilot** with up to 100 students on the prod project.

Later, in rough order: verification codes for the autofill, Google
Calendar's Connect (Settings already shows its row; open question 8), an interview prep pack when an interview is accepted, "which resume
gets interviews" (events joined to `sent_resume_id`), ghosting detection,
an MCP tool for updates, Gmail push, Outlook and forwarding.

## Open questions

1. **Rejected applications** (decided in step 1, open to change): a stage
   of its own in red (`--color-danger`), last in the Status filter and in
   the archived board's columns. The list shows it like any other stage.
2. **Auto-accept** (decided 2026-10-27): yes, with no setting. An email
   that changes no stage is filed at once; only a stage move or an
   unmatched email asks ("Where it lives").
3. **Model data terms:** does Scout's provider (Groq) keep or train on what
   we send? Does any configured fallback use a free tier whose terms allow
   training? Email text must never reach one that does.
4. **Company domains:** `job_postings` has no company domain column. The
   scraper's `logos.py` already finds each company's site; should the
   import store it as `company_domain`? Without it, matching relies on
   names and board links.
5. **Onboarding:** should it offer Connect Gmail too, beside Settings and
   the Applications Tracker's prompt ("Where it lives")?
6. **The schedule's host** until the Cloudflare cutover: GitHub Actions, or
   wait for the Worker's Cron Trigger?
7. **Applications made outside WorkIt:** a confirmation for a job posting
   WorkIt has could create the application. One WorkIt does not have would
   need a new kind of application with no `job_id`. Pilot or later?

8. **Google Calendar: write to it, or offer a feed?** Connecting it
   (`calendar.events`, a "sensitive" scope: Google's verification, but no
   yearly security review) lets WorkIt add each interview to the student's
   own calendar. A subscribe link needs no Google sign-in but updates only
   when Google refreshes it, about daily. Settings already has its row.

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
