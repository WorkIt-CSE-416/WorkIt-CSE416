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
back to `queued` on the next claim, so a crash never strands it. A Desktop
that never beat counts as stopped, so **Desktop sends its first heartbeat
before its first claim**; otherwise its next claim takes back what the last
one gave it.

### Leases

A claim leases each application it moves to `filling` to the Desktop run
beating at that moment: `job_applications.claimed_at` and `claimed_by` (the
beat's `instance`, a new id each time Desktop starts). Each claim first sends
back to `queued` every `filling` application its Desktop no longer holds:

- its Desktop has been silent 10 minutes (or never beat), as above;
- its lease ran out: claimed 30 minutes ago, longer than any fill, so a fill
  whose review or finish never reached WorkIt comes back while Desktop runs;
- an earlier run claimed it: `claimed_by` isn't the instance now beating, so a
  Desktop restarted within the 10 minutes takes its last run's work back on
  its first claim.

A Desktop that sends no `instance` keeps the first two rules only.

Each stage move (review, approve, finish) is one conditional `UPDATE ... WHERE
stage IN (allowed) RETURNING`: two moves at once can't both pass, and the one
that matches no row answers 409.

Built (backend): the stages and tables are migration `40329c7aef62`, the
lease columns `b7c1e9d4a2f0`
(`application_reviews`, one row per application; `desktop_heartbeats`, one
per applicant); the steps are `claim_applications`, `submit_review`,
`get_review`, `approve_application`, `desktop_beat` and `desktop_status` in
`backend/app/auto_apply/pipeline.py`.

## API (all under `/applicants/{id}`, Bearer token, owner-checked)

| Route | Body | Answers | Stage move |
|---|---|---|---|
| `POST applications/claim` | `{"n": 1..10}` | `list[Application]` (oldest queued open job postings first; `[]` when none) | queued → filling, leased to the beating instance; first requeues what no Desktop holds (Leases) |
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
DesktopBeat   { workers: int, busy: int, usage: {five_hour: float, weekly: float} | null, version: str,
                instance: uuid | null }   # new each time Desktop starts (Leases)
DesktopStatus { online: bool, last_seen: datetime | null, workers: int, busy: int, usage: {...} | null }
```

- After approval, `GET review` answers the approved answers in `answers`
  (the review's own when the approval sent none); the answers Desktop wrote
  stay stored beside them. A second `PUT review` (only from `filling`)
  replaces the review and clears the approval.
- `finish`'s `note` is logged, not stored.
- `busy` above `workers` is a 422; `workers` and `busy` are 0..10.

`online` means a heartbeat in the last 45 s. Start Auto Apply only queues a
batch when Desktop is online (Desktop claims it); otherwise it also opens the
extension's runner as before.

Desktop learns of new work by polling `claim` and `GET applications?stage=approved`
every 3 s. Supabase Realtime on `job_applications` can replace the poll later.

## Hosts

`AUTO_APPLY_HOSTS` gains the hiring systems Desktop fills: Greenhouse, Lever,
Ashby, Workday (myworkdayjobs.com), Workable, Rippling, Eightfold.
