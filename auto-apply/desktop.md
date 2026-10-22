# WorkIt Desktop (KAN-323)

WorkIt Desktop is auto apply running on the student's own computer: up to 10
Workers, each filling one application's form in its own browser, with every
AI call made through the student's own Claude login (`claude -p`). The
website queues and reviews; Desktop claims, fills and submits. The student
reviews every application before it is submitted. The extension's runner
(architecture.md, "The run") stays as the fallback when Desktop isn't running.

## Stages

`job_applications.stage` gains three values:

```
queued ──claim──▶ filling ──review──▶ review ──approve──▶ approved ──finish(submitted)──▶ applied
                     │                   │                    │
                     └─finish(failed)─▶ needs_you   finish(skipped)─▶ skipped
```

- `filling`: a Desktop Worker claimed it. Two Workers never claim the same one.
- `review`: filled to the last page and stopped before Submit; its review
  (the answers, essays and resume it used) waits for the student.
- `approved`: the student approved it, maybe after editing answers; Desktop
  fills it again with the approved answers and submits.

A `filling` application whose Desktop stopped heartbeating for 10 minutes goes
back to `queued` on the next claim, so a crash never strands it.

## API (all under `/applicants/{id}`, Bearer token, owner-checked)

| Route | Body | Answers | Stage move |
|---|---|---|---|
| `POST applications/claim` | `{"n": 1..10}` | `list[Application]` (oldest queued open job postings first; `[]` when none) | queued → filling |
| `PUT applications/{job_id}/review` | `Review` | `ApplicationStage` | filling → review (409 otherwise) |
| `GET applications/{job_id}/review` | | `Review` (404 when none) | |
| `POST applications/{job_id}/approve` | `{"answers": [ReviewAnswer]}` (the edited list; may be empty to keep the review's) | `ApplicationStage` | review → approved |
| `POST applications/{job_id}/finish` | `{"outcome": "submitted" \| "skipped" \| "failed", "note": str?}` | `ApplicationStage` | now also from filling, review, approved |
| `POST applications/{job_id}/resume` | | as before | now also from filling and approved |
| `PUT desktop` | `DesktopBeat` | `DesktopStatus` | heartbeat, every 15 s |
| `GET desktop` | | `DesktopStatus` | |

```
Review {
  answers: [ReviewAnswer],          # every question on the form, in form order
  resume: {name: str, sent_resume_id: uuid | null} | null,
  cover_letter: str | null,
  flags: [str],                     # why it needs a look: unsupported claim, missing fact, read-back mismatch
  note: str | null,                 # Desktop's one-line summary
  filled_at: datetime
}
ReviewAnswer {
  question: str, answer: str,
  source: "profile" | "answer_bank" | "written" | "missing",
  essay: bool,                      # free text written for this job
  facts: [str]                      # bank facts an essay's claims came from
}
DesktopBeat   { workers: int, busy: int, usage: {five_hour: float, weekly: float} | null, version: str }
DesktopStatus { online: bool, last_seen: datetime | null, workers: int, busy: int, usage: {...} | null }
```

`online` means a heartbeat in the last 45 s. Start Auto Apply only queues a
batch when Desktop is online (Desktop claims it); otherwise it also opens the
extension's runner as before.

Desktop learns of new work by polling `claim` and `GET applications?stage=approved`
every 3 s. Supabase Realtime on `job_applications` can replace the poll later.

## Hosts

`AUTO_APPLY_HOSTS` gains the hiring systems Desktop fills: Greenhouse, Lever,
Ashby, Workday (myworkdayjobs.com), Workable, Rippling, Eightfold.
