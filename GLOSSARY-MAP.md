# Glossary map

This repo has two domain contexts. Each one has its own glossary and its own
ADR folder (`docs/agents/domain.md`). Read the glossary of the context you
work in, and use its terms.

| Context | Code | Glossary | ADRs |
|---|---|---|---|
| **WorkIt**: the web app, the API, Scout, the scraper and the extension | everything except `apply-agent/` | `GLOSSARY.md` | `docs/adr/` |
| **Apply**: the command-line agent that fills applications with Claude | `apply-agent/` | `apply-agent/GLOSSARY.md` | `apply-agent/docs/adr/` |

Decisions that apply to the whole repo go in the root `docs/adr/`.

## Terms that clash

The same word means different things in the two contexts. In a text that
touches both, say which context you mean ("an Apply Handoff").

- **Handoff.** WorkIt: one question that the student must answer
  themselves (a question aimed at AI agents, a form that bans AI-written
  text, a video). Apply: a whole application that Apply cannot finish
  alone (for example, a captcha); the person finishes it from the Tracker.
- **Application.** WorkIt: one job posting that a student follows in the
  Applications Tracker, at one stage. Apply: one attempt to apply to one
  job posting, from the first filled field to submission.
- **Missing fact.** WorkIt: a question that the student's data does not
  answer, left blank for the student. Apply: a required question that only
  the applicant can answer; the application pauses until they answer it,
  and the answer goes into their profile.
- **Tracker.** WorkIt: the Applications Tracker page, the record of each
  job the student applied to. Apply: its own working state, a file in its
  data folder with one row per application. Apply writes each new status
  to the Applications Tracker (KAN-544). Apply's Google Sheet, the Tracker
  Sheet, is retired.
- **Job system** and **Posting** (Apply) are WorkIt's **hiring system**
  and **job posting**. Write the WorkIt terms in any text for people
  outside `apply-agent/`. Apply's code and its glossary keep their own
  names.
