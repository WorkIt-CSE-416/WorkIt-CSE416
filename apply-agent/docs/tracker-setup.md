# The Tracker and your Applications Tracker

Apply keeps two records. They have different jobs (root `docs/adr/0007`, KAN-544):

- **Your Applications Tracker on WorkIt** (`https://workitjobs.ai/applications`) is the record of each job that you applied to. Apply writes to it as you, while it works.
- **Apply's Tracker** is a file in your data folder (`tracker.json`). It is Apply's own working state: the Holds to approve, the Missing facts to answer, the Requests, the Employer accounts and the Answer bank list. You do not edit it by hand.

Apply does not write to a Google Sheet any more. The old **Tracker Sheet** is retired.

## Set up

There is nothing to set up for Apply's Tracker. For your Applications Tracker, log in to WorkIt one time:

```sh
uv run apply login
```

`uv run apply doctor` then shows "WorkIt: logged in as" your email. Without a login, Apply still runs and rehearses, but its writes wait (see below).

## What Apply writes to your Applications Tracker

| Apply's status | Stage on WorkIt |
|---|---|
| submitted (by a run, by you from a rehearsal's held page, or `apply applied`) | **Applied**, with the resume that the form was given as its Sent resume |
| handoff, missing fact | **Needs you** |
| held | **Queued** |

- Apply finds the job by its link. When WorkIt does not list the job, Apply adds it as an added job that only you see.
- A later status for the same job moves the same row. Needs you and Queued never move a job that is already Applied (or later) back.
- A rehearsal that you do not submit writes nothing.
- The Sent resume is the copy of the resume in the data folder's `sent/<date>/<application>/` folder.

## When WorkIt cannot be reached

Apply keeps each write that cannot reach WorkIt (no network, or the login expired) in the data folder (`workit-queue.json`). The next `apply run` or `apply rehearse` sends it first. `uv run apply doctor` shows the "WorkIt writes" line with each write that waits. If the WorkIt line says the login expired, run `uv run apply login` again.

## What you do in the Apply window

- **Approve** a held Application in the **Needs you** tab. The next pass (any `apply run`, including the 5-minute Requests check, or `apply approve-pass`) fills the form again, checks it and submits it. If the check fails, it goes back to Held with the reason, starting "Held again after your approval".
- **Answer** a Missing fact in the **Needs you** tab. The answer joins your Applicant profile, and the Application goes on at the next check.
- To add a Posting yourself, run `uv run apply add <link>`.
- Set what came of an application (Interviewing, Offer, Rejected) on WorkIt, in your Applications Tracker.

## If you used a Tracker Sheet before

- The first time Apply opens its Tracker, it copies the Sheet's rows and Requests into `tracker.json` one time. It only reads the Sheet. This keeps every job that you applied to, so no run applies to it again.
- To put the Sheet's submitted applications into your Applications Tracker one time, run `uv run apply import-sheet`. It lists each add and skip first, and writes only when you type yes.
- Both read the Sheet through the service account key (`~/.config/gspread/service_account.json`) and the Sheet ID in the data folder (`sheet-id`). After the import, you can delete them.
