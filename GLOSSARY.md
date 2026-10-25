# WorkIt

A job platform for college students looking for internships and new-grad jobs.

## Resumes

**Experience bank**:
Everything one student has done, stored once and kept by WorkIt. The source every built resume is drawn from.
_Avoid_: profile, master resume, per-resume data

**Entry**:
One thing in the experience bank, in one section: a job, degree, project, club role, award or certification.
_Avoid_: experience (for the single item), item, record

**Section**:
One of the fixed kinds of entry in the experience bank: Education, Experience, Projects, Leadership & Activities, Awards, Certifications and Skills.
_Avoid_: category, block, custom section

**Skill**:
A named ability in the experience bank. Skills are one list per student, not tied to entries.
_Avoid_: keyword, tag

**Bullet**:
One line of achievement belonging to one entry.
_Avoid_: description, point

**Bullet variant**:
An alternative wording of a bullet, kept beside the original, made while tailoring or by typing on a built resume (which changes that resume only).
_Avoid_: rewrite, edited bullet, copy

**Built resume**:
A choice of entries and bullets, in an order and a template, that always shows the experience bank's current text.
_Avoid_: generated resume, resume copy

**Template**:
The look of a built resume: fonts, sizes, margins, headings and where dates sit. It never changes what the resume says, which entries show or their order.
_Avoid_: theme, style, format

**Base resume**:
A built resume that is not linked to a job posting. Tailoring starts from one.
_Avoid_: base built resume, master resume, general resume

**Uploaded resume**:
A file the student brought in. It is read-only, can be applied with as it is, and fills the experience bank when it is uploaded.
_Avoid_: original resume, parsed resume

**Import**:
To read an uploaded resume and write its entries and skills into the experience bank as that upload's own, replacing what it owned before; it never merges into another resume's entries (ADR 0005). Upload imports once, after a parse preview in onboarding, where it replaces the other uploads' matching entries (ADR 0006); Import Again reads a stored upload again (ADR 0003).
_Avoid_: parse, sync, auto-fill

**Sent resume**:
The exact document a student applied with, kept unchanged from that moment. A download is not one: it keeps nothing.
_Avoid_: snapshot, submitted copy

**Generate**:
To make a new built resume from the experience bank in a chosen template.
_Avoid_: create, build, make a resume

**Tailor**:
To change which bullets, bullet variants and skills a built resume shows so it fits one job posting better.
_Avoid_: change, customize, optimize a resume

**Tailored resume**:
A built resume linked to one job posting, made by tailoring. A posting has at most one tailored resume per student.
_Avoid_: job resume, targeted resume, tailored copy

**Keyword match**:
How many of a job posting's keywords a built resume shows, given as a count (12 of 18) with the matched and missing keywords listed.
_Avoid_: ATS score, match score, resume score

**Intake**:
The guided conversation in which Scout asks a student about one thing they did at a time and drafts an entry from their own words.
_Avoid_: onboarding, chat import, AI builder

**Draft entry**:
A proposed entry from intake that the student has not saved yet. It is not part of the experience bank.
_Avoid_: suggestion, pending entry

**Truth rule**:
WorkIt's model may only rephrase facts the student gave; when a fact is missing it asks the student instead of inventing one.
_Avoid_: guardrail, hallucination check

**Identity data**:
The parts of a student's data that name or reach them: name, email, phone, street address and links. WorkIt never sends it to a model; school, employers and dates are not identity data.
_Avoid_: personal info, PII, contact details (for the whole set)

## Applying

**Fill engine**:
The one copy of every job system's form filler and of the answer rules, shared with Lisul's Apply and kept in its own private repo. The extension fills only the job systems it covers, and never submits.
_Avoid_: autofiller library, field map, filler (for the whole engine)

**Question set**:
Every question one job posting's application form asks, each with its kind, whether it is required and its options.
_Avoid_: form fields, field list, questions (for the whole set)

**Plan**:
What the fill engine decides for one question set from a student's data: each question's answer, the questions that need a written answer, the missing facts and the handoffs.
_Avoid_: mapping, field matches, autofill result

**Handoff**:
A question the student must answer themselves whatever WorkIt knows, with the reason: one aimed at AI agents, one on a form that bans AI-written text, a video.
_Avoid_: skipped field, manual field, error

**Missing fact**:
A question the student's data doesn't answer, left for the student to fill in.
_Avoid_: unknown field, blank, unanswered

**Batch apply**:
The extension filling the student's queued Applications in background tabs, at most five at once, the next opening as one finishes. It never submits.
_Avoid_: runner, run tab

**Ready** / **Needs you**:
The two tab groups a batch tab sits in once filled: Ready when every field the form needs shows an answer, Needs you when anything is left for the student. A tab moves between them as that changes.
_Avoid_: done, failed, review

**Connector**:
WorkIt's MCP server, which a student adds to their own Claude so it can write their applications' essay answers. WorkIt calls no model for them.
_Avoid_: integration, plugin, MCP (alone)

**Written answer**:
A batch tab's answer to a question its form needs written, such as "Why this company?". The student's Claude saves it through the connector, and the open tab fills it.
_Avoid_: essay (for the saved answer), AI answer, generated answer

## Tracking

**Applications Tracker**:
The page that holds every job posting a student is following, from saved to offer.
_Avoid_: Applications (alone, for the page), Tracker (alone), My Applications, board

**Stage**:
Where one application stands in the Applications Tracker: Saved, Applied, Interviewing or Offer.
_Avoid_: column, step (the Applications Tracker's Status filter picks stages)

**Application**:
One job posting a student is following in the Applications Tracker, at one stage.
_Avoid_: Applications (as the page's name)

**Strong Match**:
A job posting that scores 80 or more for a student, the Strong Match band and above. The Dashboard's first number, Strong Matches, counts them.
_Avoid_: good match (for that number), new role, recommendation

**Top Match**:
One of a student's highest-scoring open jobs, whatever its band. The Dashboard lists them under its numbers.
_Avoid_: recommendation, best job

## Jobs

**Job Type**:
What kind of job a job posting is: Full-Time, Part-Time, Contract or Internship. The Jobs page and the Applications Tracker both filter on it under this name.
_Avoid_: Track, employment type, position type
