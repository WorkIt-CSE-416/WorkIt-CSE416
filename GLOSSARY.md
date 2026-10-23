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
To read an uploaded resume and write its entries and skills into the experience bank, merging an entry the bank already has instead of copying it. Upload imports once; Import Again reads a stored upload again (ADR 0003).
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

## Tracking

**Tracker**:
The page that holds every job posting a student is following, from saved to offer. Its heading is Application Tracker.
_Avoid_: Applications (for the page), My Applications, board

**Stage**:
Where one application stands in the Tracker: Saved, Applied, Interviewing or Offer.
_Avoid_: column, step (the Tracker's Status filter picks stages)

**Application**:
One job posting a student is following in the Tracker, at one stage.
_Avoid_: Applications (as the page's name)

**Good Match**:
A job posting that scores 65 or more for a student, the Good Match band and above.
_Avoid_: new role, recommendation, top job
