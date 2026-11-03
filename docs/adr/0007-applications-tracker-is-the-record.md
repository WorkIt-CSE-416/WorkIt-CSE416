# The Applications Tracker is the record of applications, and Apply's Tracker Sheet is retired

Status: proposed 2026-11-02 (KAN-541).

WorkIt's Applications Tracker is the one record of the jobs a student
applied to. Apply writes to it, through WorkIt's API as the student, while
it works: a submit sets Applied and saves the sent file as the Sent resume,
and an Apply Handoff, a missing fact or a held Application sets Needs you.
A held Application never sets Queued: on WorkIt, Queued means the batch
apply queue, and the extension fills a queued Application. The submitted rows of Apply's Tracker Sheet (a Google Sheet)
are imported one time. After the import, Apply does not write to the Sheet.

## Why

Two live records drift apart, and the Sheet's Outcome column, filled by
hand, repeats the Applications Tracker's stages. The Applications Tracker
already holds the Sent resume, the application events and the stages, and
the extension, auto apply and Track on WorkIt already write to it. Only
Apply did not.

## Considered Options

- **Apply writes to both.** Rejected: two records, two places to fix an
  outcome, and nothing tells which one is correct.
- **The Sheet stays the record and is copied into WorkIt from time to
  time.** Rejected: the Applications Tracker is always behind, and a copy
  job cannot say which side changed a row.

## Consequences

- Apply needs a WorkIt login (`apply login`) and a queue for writes made
  while WorkIt cannot be reached.
- An Apply user with no WorkIt account loses the tracker. Apply is a
  developer and power-user tool today, so this is accepted.
