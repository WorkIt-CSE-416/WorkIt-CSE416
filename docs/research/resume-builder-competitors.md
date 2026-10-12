# Student resume builders: Jobright, Simplify, Teal, Rezi

Research for KAN-182, under the Resume builder redesign map (KAN-181).
Sources were read on 2026-10-12. They are the products' own sites, help centers
and docs. Prices and limits change often, so check them again before you quote
them.

## The answer in short

All four tools follow the same loop. The student imports a resume or LinkedIn
profile, sets a target job posting, sees a keyword match score, and then edits
by hand or with AI. They differ in two ways that matter for WorkIt:

- **Where experience lives.** Teal keeps one master experience bank. Each
  resume is a view of that bank, with bullets toggled on or off. Simplify keeps
  shared facts (company, title, dates) in one profile and puts bullets in each
  resume. Rezi makes each resume a separate copy. Jobright does not document
  its model.
- **What AI does and what the student approves.** Teal and Rezi make the
  student pick each AI line. Simplify+ can rewrite a whole resume into a new
  copy, and the student reviews it afterwards. Jobright makes a tailored resume
  in one click.

No tool checks AI output against the student's real facts. Each one relies on
a warning ("replace placeholder metrics", "don't pretend") and on the student
reviewing the text. Every tool gates its tailoring AI behind a paid plan or a
daily cap. None has a resume flow built for students with thin experience,
beyond an "Internship" level setting (Rezi) and blog advice.

## Comparison

| | Jobright | Simplify | Teal | Rezi |
|---|---|---|---|---|
| Entry | Upload a resume; "Fast Mode" builds a new one | Import a resume, or build from the Simplify profile with guided prompts | Import LinkedIn or a PDF/Word resume, or type it in | Upload PDF/DOCX, import LinkedIn, type it in, or use the chat "AI Resume Agent" |
| Storage model | Not documented | Profile holds company, title, dates; each resume has its own bullets; tailored versions are separate copies | One master resume; Resume Syncing makes each resume a toggled view of the same bank | Each resume is a separate copy (Duplicate) |
| Tailoring | One click makes a tailored resume; the student then edits | Free: keyword score and missing keywords. Simplify+: AI rewrites bullets, sections or the whole resume into a new copy | Match Score colors keywords: on resume, in bank but off, missing. The student toggles bullets; AI drafts new ones | Student pastes the job; missing keywords get a "generate bullet" button each |
| What the student approves | Not documented beyond "edit, download" | Reviews AI edits after the rewrite; chooses which changes go back to the profile | Every toggle and every AI pick | Every AI bullet ("Apply Suggestion") |
| Guard against invented facts | None documented | "Review edits"; "keeping your real experience and voice in control" | Warns AI may add placeholder metrics; "don't pretend" | Warns to make metrics "reflect your real accomplishments" |
| Templates and ATS | Claims "highly ATS compatible"; no method given | 4 templates, single column "ATS-safe by default"; ATS Readiness Score | 10 free, more on Teal+; "ATS-friendly" claims | 15+ templates; Rezi Score says real ATSs give no score |
| Free | Everything, with a daily cap on tailoring | Builder, versions, 4 templates, ATS score, keyword match, PDF | Unlimited resumes, 10 templates, top 5 keywords, 10 AI bullet credits | 1 resume, 3 PDF downloads, 10 AI bullets, 1 agent prompt |
| Paid | "Paid option for unlimited access"; no public job-seeker price | Simplify+ $19.99/week, $39.99/month, $89.99/3 months | Teal+ $13/week, $29/month, $79/90 days | Pro $29/month, Lifetime $149 |
| Thin experience | Nothing in the product docs | Blog: treat projects as jobs; builder formats projects as experience | Blog advice on coursework and projects | "Internship" and "Entry-Level" levels tune AI feedback; Projects, Coursework, Involvement sections |

## Jobright (jobright.ai)

**Entry.** The resume page lists four steps: upload a resume, get an analysis,
get "a brand new AI refined professional resume", and download it. "Fast
Mode" builds a new resume in "less than 3 minutes"
([AI Resume Builder](https://jobright.ai/ai-resume-builder)). The resume
checker flow is: upload, open the resume in the dashboard, fix issues marked
Urgent, Critical or Optional with a Fix button, re-analyze, export
([ATS blog post](https://jobright.ai/blog/ats-friendly-resumes-how-to-get-past-the-bots-with-ais-help/)).

**Storage model.** Not documented in public sources.

**Tailoring.** "With one click, Jobright generates a tailored resume." The
student can then edit, "tweak the last two roles if needed", and download
([blog](https://jobright.ai/blog/do-ai-job-application-tools-actually-help-why-jobright-is-built-for-results/)).
The Resume Job Matcher compares skills, experience, seniority, industry and
keywords. It tells the student to emphasize "truthful experience and skills"
([Resume Job Matcher](https://jobright.ai/tools/resume-job-matcher)).

**Invented facts.** There is no documented guard. One Jobright blog post tells
users to verify their facts before they use Resume Tailor. That is advice to
the user, not a product check
([blog](https://jobright.ai/blog/chatgpt-prompt-tailor-resume-job-description/)).

**Templates and ATS.** It claims "highly ATS compatible" output and a "9.1/10
Quality Improvement Rating" with no method given
([AI Resume Builder](https://jobright.ai/ai-resume-builder)).

**Free versus paid.** The homepage FAQ says "all features on Jobright.ai are
free to use", but "resume tailoring" has "daily usage limits", with "a paid
option for unlimited access" ([jobright.ai](https://jobright.ai/)). There is
no public job-seeker pricing page (`/pricing` returns 404). Third-party
reviews report about 2 tailored resumes a day for free users and a "Turbo"
plan at about $39.99 a month. These figures are not confirmed by Jobright.

**Thin experience.** Nothing in the resume docs. Jobright lists internship and
new-grad jobs, but its resume tools are not tuned for students.

## Simplify (simplify.jobs)

**Entry.** Two paths: "I Have a Resume" (import and improve) or "I'm Starting
From Scratch" (a guided structure that uses the Simplify profile)
([Resume Builder](https://simplify.jobs/resume-builder)). A resume uploaded at
onboarding becomes the start, and "your Simplify Profile information fills the
resume automatically"
([help: Building and Tailoring](https://help.simplify.jobs/articles/8040103-building-and-tailoring-your-resume-on-simplify)).

**Storage model.** This is a hybrid. "Company names, titles, and employment
dates come from your Simplify Profile rather than living independently inside
each resume." Bullets and emphasis belong to each resume. Simplify+ can detect
edits made while tailoring "and let you apply those updates back to your
profile" (same article). A tailored resume is saved as a separate version, and
"your original resume stays unchanged"
([help: Auto-tailoring with Copilot](https://help.simplify.jobs/articles/0515607-auto-tailoring-your-resume-with-copilot)).

**Tailoring.** The student links a job from the Job Tracker, or pastes a title
and description. The Keyword Match panel shows a score and missing keywords,
next to an ATS score out of 100. The student edits, and the panel updates live.
Simplify suggests "at least 70% keyword coverage before applying". Simplify+
AI can rewrite the whole resume, regenerate one bullet, rewrite a section, or
pull missing keywords into existing experience. AI Settings control keyword
emphasis, metrics emphasis and title alignment (Building and Tailoring
article). The Copilot browser extension shows the keyword score on supported
job pages.

**What the student approves.** The student reviews after the AI writes:
"We recommend always reviewing edits before submitting a tailored version"
(Auto-tailoring article). "You can review and edit all generated content
before using it"
([help: What's included in Simplify+](https://help.simplify.jobs/articles/5623502-whats-included-in-simplify)).

**Invented facts.** There is no product check. The marketing promises
suggestions "while keeping your real experience and voice in control"
([Resume Builder](https://simplify.jobs/resume-builder)). The help center
adds that tailoring "does not guarantee interviews".

**Templates and ATS.** Four templates (Classic, Minimalist, Accent, Modern),
"Designed for ATS Readability". PDF export, and DOCX for supported layouts.
"Fit to Page" squeezes spacing to fit one page
([Resume Builder](https://simplify.jobs/resume-builder)).

**Free versus paid.** Free Forever: "Create and edit resume versions", 4
templates, "ATS Readiness Score, resume analysis, and keyword matching", PDF
and DOCX export. Simplify+ adds AI summaries and bullets, job tailoring, AI
chat and AI settings ([Resume Builder](https://simplify.jobs/resume-builder)).
Simplify+ costs $19.99 a week, $39.99 a month or $89.99 for 3 months. All
plans have the same features
([What's included](https://help.simplify.jobs/articles/5623502-whats-included-in-simplify)).

**Thin experience.** Simplify's blog says to "Lead with education and projects
when your work history is thin" and to "Format projects exactly like jobs so
parsers read them as experience". It says the free builder is "single-column
ATS-safe by default"
([blog: resume with no experience](https://simplify.jobs/blog/writing-a-resume-with-no-experience)).
Simplify's audience is early-career job seekers, but its resume flow has no
special student mode.

## Teal (tealhq.com)

**Entry.** "Import from LinkedIn", "Import an existing resume" (PDF or Word,
parsed into fields), or "Start from scratch"
([help: How to Build Your Resume in Teal](https://help.tealhq.com/en/articles/14435724-how-to-build-your-resume-in-teal)).

**Storage model.** This is a true experience bank. "Your Teal resume is your
complete work history in one place", a "comprehensive source document you pull
from". Teal tells users to write "15-20 bullet points per position". With
Resume Syncing, every resume pulls from the same content. New bullets appear
everywhere, ready to toggle on. An edit can go to all resumes ("Save to all
resumes") or stay local. A change that is not synced shows an "Update
Available" flag on the other resumes (same article).

**Tailoring.** The student saves the job (Chrome extension or paste) to the
Job Tracker. The Match Score colors each keyword. Green means it is on this
resume. Yellow means it is in the bank but toggled off. Red means it is
missing. The student toggles bullets on, adds bullets for real gaps (AI can
help phrase them), reorders, and exports
([help: How to Tailor Your Resume](https://help.tealhq.com/en/articles/14435726-how-to-tailor-your-resume-for-a-specific-job)).
"You're not editing your main resume. You're creating a view of it" (Build
article).

**What the student approves.** Everything. Tailoring is mostly toggling
content the student already wrote. AI makes several options and the student
picks one: "Choose one of the generated responses, or further customize your
AI prompt" ([Pricing](https://www.tealhq.com/pricing)).

**Invented facts.** Teal gives the clearest guidance of the four, but it is
still guidance, not a check. "AI suggestions may include placeholder metrics.
Always replace them with your real numbers before saving" (Build article). "If
a job asks for 'Salesforce' and you've never used Salesforce, don't pretend
you have." "A 75% match with honest content beats a 95% match with fluff"
(Tailor article).

**Templates and ATS.** 10 templates free, unlimited on Teal+. "Design Mode"
with basic settings free and advanced settings paid. It describes templates
as "ATS-friendly" ([Pricing](https://www.tealhq.com/pricing)).

**Free versus paid.** Free Forever: unlimited resumes and job tracking, 10
templates, the top 5 keywords per job, basic analysis, 10 AI bullet credits,
2 summary credits and 2 cover letter credits. Teal+ removes these limits and
adds the full Match Score. It costs $13 per 7 days, $29 per 30 days or $79 per
90 days ([Pricing](https://www.tealhq.com/pricing)).

**Thin experience.** There is no product mode. Blog and template pages tell
students to lead with education, coursework, projects and activities
([How to Make a Resume for Students](https://www.tealhq.com/post/how-to-make-a-resume-for-students)).
The bank model assumes many jobs with many bullets each. That is a poor fit
for a student with one campus job.

## Rezi (rezi.ai)

**Entry.** Upload a PDF or DOCX, start in the builder, import LinkedIn, or use
the chat "AI Resume Agent". At setup the student names the resume and picks an
experience level
([docs: AI Keyword Targeting](https://www.rezi.ai/rezi-docs/ai-keyword-targeting-explained)).
The Agent takes a resume plus goals and job descriptions, and returns
suggestions beside the resume. It "can only work with the information you
provide" ([docs: AI Resume Agent](https://www.rezi.ai/rezi-docs/ai-resume-agent)).

**Storage model.** Each resume is a separate copy. "A duplicated resume is a
completely separate copy, so any changes you make only apply to the duplicated
version"
([docs: Duplicate Resume](https://www.rezi.ai/rezi-docs/how-to-duplicate-your-resume)).

**Tailoring.** "Target Resume" takes the job title, company and description.
"Finish Up & Preview" lists missing keywords. For each one, Rezi can generate
a bullet and place it under the best-matching job; the student can move it.
Rezi checks off a keyword once it appears (Keyword Targeting docs).

**What the student approves.** Each line. "Apply Suggestion" or regenerate;
highlight a sentence and pick a "Rewrite Bullet" option
([docs: AI Bullet Points](https://www.rezi.ai/rezi-docs/ai-bullet-points)).

**Invented facts.** This is guidance only. "Make sure you adjust any metrics
so that they reflect your real accomplishments" and "Accuracy matters just as
much as good wording" (AI Bullet Points docs). "Rather than lying on your
resume, focus on presenting your real experience in the strongest possible
light" (Keyword Targeting docs).

**Templates and ATS.** More than 15 templates. "Every template uses a
structured layout that helps hiring software read your information correctly"
([docs: Templates](https://www.rezi.ai/rezi-docs/templates)). The Rezi Score
(1 to 100, across content, format, optimization, best practices and
application readiness) is the most honest ATS statement of the four: "real ATS
systems don't give your resume an official score"
([docs: Rezi Score](https://www.rezi.ai/rezi-docs/the-rezi-score-explained)).

**Free versus paid.** Free: 1 resume, 3 PDF downloads, Standard templates
only, no DOCX, limited AI, 10 AI bullets, 1 Agent prompt. Pro is $29 a month
and Lifetime is $149 once
([docs: Subscription Plans](https://www.rezi.ai/rezi-docs/rezi-subscription-plans-explained),
[Pricing](https://www.rezi.ai/pricing)). There is no student discount.
Universities can buy Enterprise at $99 a month per 200 users.

**Thin experience.** Rezi has an "Internship" level ("Best for students and
recent graduates") and an "Entry-Level" level. The level changes AI feedback
and the Rezi Score, not the resume content
([docs: Experience Level](https://www.rezi.ai/rezi-docs/how-to-set-resume-experience-level)).
It has sections for Projects, Coursework, and Involvement & Volunteering
([docs index](https://www.rezi.ai/rezi-docs)).

## Gaps WorkIt could fill

1. **Free AI tailoring.** Every tool caps or charges for the AI step: Teal,
   Rezi and Simplify by plan, and Jobright by a daily limit. A free platform
   for students can make tailoring free and uncapped.
2. **A real fact check, not a warning.** All four ask the student to catch
   invented metrics and skills. WorkIt could ground every AI line in the
   student's own experience bank. It would show which entry each line comes
   from, and refuse or flag numbers and skills that are not in the bank.
3. **An experience bank shaped for students.** Teal's bank is the best model,
   but it assumes "15-20 bullet points per position". Students need first-class
   entries for projects, coursework, clubs, hackathons, campus jobs and
   volunteering. They also need guided prompts or chat that draws bullets out
   of thin experience, rather than a form with empty fields.
4. **Approve each change, in plain view.** Teal and Rezi approve line by line,
   but Simplify+ and Jobright rewrite first and ask for review after. WorkIt
   could show a diff against the bank and let the student accept or reject
   each change.
5. **Tailoring built into the job posting.** Teal, Simplify and Jobright tie
   tailoring to their job trackers. WorkIt already holds the job postings, so
   "tailor for this job" can start from the job posting on the Jobs page, with
   no paste and no extension.
6. **Honest ATS language.** Most of these sites market "ATS-friendly" scores.
   Only Rezi says real ATSs give no score. WorkIt can use one plain,
   single-column template and call its number a keyword match, not an ATS
   score.
