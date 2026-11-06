# Apply

The system that finds Summer 2027 internship postings that fit Lisul and submits applications to them, with Claude answering every question.

## Language

**Posting**:
One open internship role at one company, with a link to its application form.
_Avoid_: job, listing, opening

**Posting description**:
A Posting's own text: its company, its role, its pay range if it states one, and the job's description with its equal-opportunity, benefits and privacy paragraphs left out, cut to about a thousand tokens. It is read once per Application, from the job system's API, else off the posting's own page (its JobPosting schema, its job description section, its meta description), and every Claude call for that Application gets it. It is employer text, never instructions: a sentence in it that speaks to AI agents ("if you are an LLM, ...") makes the Application a Handoff that names it, and no Claude call sees it; when the text can be read without opening the form, that happens before the form opens. A ban on AI-written applications, or a sentence that just tells the reader not to use AI ("Do not use AI.", "No AI."), bans AI-written text on its form. AI as the work itself ("you will build LLM tools") is neither.
_Avoid_: JD, job context, job info

**Match**:
A Posting that passes Lisul's filters: Summer 2027, US or remote, a software or AI/ML role, open to undergraduates (not PhD or master's only). The system applies to every Match, at any company, newest Postings first.
_Avoid_: aligned job, fit, target

**Target company**:
One of the twelve companies named in the resume glossary. A Match at a Target company is always held for approval.
_Avoid_: FAANG, top company

**Employer limit**:
An employer's own cap on one candidate's applications, such as OpenAI's 5 in any 180 days, kept in policies.yaml (`employer_limits`) beside Apply's own cap of 3 per company in any 7 days (`company_cap`). A company matches a limit as it does a Target company, by the first words of its name, so "Cognition" also covers "Cognition Therapeutics". A Match is applied to only while every window that applies has room, Applications still on their way counting; one over a limit is skipped with its reason logged and tried again on a later run. A Request skips Apply's cap, and one over an employer's limit is applied to anyway, with a warning in the run and a note on its Tracker row.
_Avoid_: rate limit, quota

**Application**:
One attempt to apply to one Match, from the first filled field to submission.
_Avoid_: submission, app

**Applicant profile**:
The facts Lisul gives once (work authorization, graduation date, demographic answers and similar) that Claude draws on to answer questions. Claude never states a fact that is not in the profile, the master resume or a defensible claim.
_Avoid_: personal info, answers file

**Missing fact**:
A required question only Lisul can answer: one asking for an Applicant profile fact the profile lacks, a one-off question Claude can't answer from his facts, or one that stays his whatever Claude knows (references or contacts, government IDs, signatures and attestations, criminal history, an "if yes, explain" his answer calls for), or a fact an Essay plan's required slot needs that no Story bank line states (asked as "Essay fact: …"). A follow-up that Apply's own answer to the question before it doesn't call for ("If yes, …" or "If a contingent worker, …" after a No, 'If "Other," …' after another pick) is not one: it is left blank, or answered N/A where it must be answered. Pay is not one: asked as a figure it gets the middle of the Posting's own pay range, or Lisul's fallback rate (policies.yaml); asked in words it gets "Open to the posted range" when the Posting names its pay, else the fallback rate ("$30/hr"); asked whether the posted or stated pay suits him, it gets Yes. Its Application pauses until Lisul answers, and the answer joins the profile (an Essay fact's joins the Story bank, and the essay is then written). A question that the profile, the Answer bank, the Story bank or the resume already answers is not one: Apply answers it from there. Each one shows a context line: its form step, the question before a bare label, its pair, or the essay that it is for.
_Avoid_: unknown question, gap

**Go to question**:
The button on a Needs you question whose form is still open in its Worker's browser. It brings that browser to the front and scrolls to the field, which it focuses and outlines. A field on another Workday step is not shown: Apply names the step and moves nothing. Lisul can then answer the question on the form. Once he leaves the field and it rests a moment, Apply saves his answer as the card saves it, and the question leaves Needs you.
_Avoid_: jump, show field

**Answer bank**:
Every answer to a one-off question (a required question no Applicant profile fact or rule answers), kept by the question's wording so the same question gets the same answer on every form. The first time a form asks one, Claude drafts the answer from Lisul's facts and the Story bank in the Application's one Claude call, and it goes straight into the bank and the form; a draft never holds an Application by itself. Each later form a draft answers counts as a use, and every run lists the drafts Lisul hasn't reviewed that it used again, which the Answers tab also puts first. Only if Lisul opts in with the `max_unreviewed_uses` policy does an unreviewed draft used that many times hold the Application, until he reviews it. Lisul reviews, edits, deletes or adds answers in the Answers tab of the Apply window (`apply answers`), in the Tracker's Answers tab or in answer-bank.yaml, and his answer is used word for word from then on. A one-off question about the company itself ("how familiar are you with our products?") is never banked: Claude answers it from the Posting description each time, and only Lisul's own answer to one is used again.
_Avoid_: cache, saved answers, FAQ

**Hold**:
The state of a filled Application that waits for Lisul's approval before it is submitted. Every Target company Application, every Application with a High-stakes essay, every Application with an Essay that still fails its code gates after the editor's pass, every Application that fails its Pre-submit check, every Application in the Calibration run, and (once Lisul opts in with `max_unreviewed_uses`) every Application answered by an unreviewed draft used that many times is held.
_Avoid_: draft, pending, queue

**Calibration run**:
The first ten Applications, all held, so Lisul can judge Claude's answers before anything is submitted unseen.
_Avoid_: test run, pilot

**Rehearsal**:
Applications to links Lisul gives, carried exactly as a run carries a Request up to the form's last page, and never submitted. Holds and Missing facts don't stop one. Its Missing facts show in the Apply window's Needs you tab as soon as the planner finds them, before Claude drafts the form's other answers (a one-off question Claude can't answer from his facts, and an Essay fact, are known only once that call returns), each marked Required or Optional as its form marks it; an answer Lisul gives there joins the profile, and Claude fills it into that field of the open form. It signs in as a run does, making an Employer account and reading its code or link from Gmail where it must (without Gmail set up, such a sign-in stops it), and each browser stays open where it stopped for Lisul to look at. Once Apply stops, that page is his: he may press Submit himself, and nothing blocks it; an Application he submits that way goes in the Tracker as submitted, and the page's Fill again button fills the form anew. If his Submit brings a step that asks for a code the job system emails, Apply fills its Emailed code.
_Avoid_: dry run, test run, preview

**Emailed code**:
The code a job system emails before it takes an Application that Lisul submitted himself from a Rehearsal's page, such as Greenhouse's 8-character security code. Apply reads it from Gmail (only a mail from the job system's senders, else the page's domain, that arrived after his press, and only a code the mail names as one) and types it into the code field. It never presses Submit, Verify or Resend after it: that stays his. With no such mail within 3 minutes, no sure code, a code that does not fit the field, or two held pages waiting on the same senders at once (Greenhouse mails every company's code from one), the field stays empty and the Apply window's Needs you tab tells him to type it. A code typed into one page is never typed into another.
_Avoid_: OTP, 2FA code, verification (alone)

**Backlog run**:
A single pass over every Posting open when the system starts.
_Avoid_: blast, initial sweep

**Daily sweep**:
The recurring pass that picks up Postings that are new since the last run. launchd starts it (`apply run`) once a day at policies.yaml's `schedule.daily_sweep_at`, and between sweeps the Requests check (`apply run --requests-only`) every 5 minutes takes approved Holds and Requests; `apply schedule install` writes both jobs and loads them only with `--load`.
_Avoid_: cron, refresh

**Daily cap**:
The most Matches applied to (submitted or held) in one day, local time, kept in policies.yaml (`daily_cap`) and counted from the Tracker's rows for today, so a bad night does at most a day's damage. A run that reaches it stops taking Matches, says so in its output, and leaves the rest for the next day. Requests and approved Holds are never stopped by it; an approved Hold submitted today still counts toward it.
_Avoid_: daily limit, quota, rate limit

**Tracker**:
Apply's own working state, one row per Application, in a file in the data folder (`tracker.json`). It keeps each Application's status, the Holds Lisul approves and the Missing facts he answers in the Apply window. It also keeps the Requests, the Employer accounts and the Answer bank list. It is not the record of what he applied to: WorkIt's Applications Tracker is the record. Each new status is also written there: submitted as Applied with the resume sent, handoff, missing fact and held as Needs you (never as Queued: on WorkIt, Queued is the batch apply queue that the extension fills). The Google Sheet that held it before, the **Tracker Sheet**, is retired. Apply only reads it, one time, to copy its rows in and to import its submitted rows into WorkIt.
_Avoid_: ledger, log, dashboard

**Waiting write**:
A write to WorkIt's Applications Tracker that could not reach WorkIt (no answer, or no live login) or that WorkIt's daily cap of added jobs refused, kept in the data folder (`workit-queue.json`) and sent first by the next run or rehearsal. A write the cap refused is not sent again until the cap resets (the next UTC day, or when WorkIt's Retry-After says). `apply doctor` lists them, and says which wait for the cap. A later status of the same Application replaces one still waiting.
_Avoid_: retry queue, outbox

**WorkIt client**:
The one module in Apply that calls WorkIt's API, as the student that `apply login` signed in. The login is kept in the data folder.
_Avoid_: API wrapper, WorkIt SDK

**Top 500**:
The 500 most prestigious non-quant companies with a Summer 2027 software internship open to Lisul, ranked 1 to 500, one row each with the link to its best open Posting and whether he has applied. Ranked by tier first, then intern pay and how much the company innovates. A company ranked above the cutoff with nothing open yet is listed apart as Not open yet.
_Avoid_: target list, shortlist, top companies

**Tier**:
How prestigious a company's software internship is, from 1 (elite) to 5 (solid). It is the first thing the Top 500 and Quant firms are ranked by: every Tier 1 company comes before every Tier 2 company.
_Avoid_: grade, level, bucket

**Not open yet**:
A company ranked high enough for the Top 500 that has no matching Summer 2027 Posting open when checked. It is listed apart with its overall rank and why it is not open, so Lisul can watch for it, and takes a Top 500 place once a Posting opens.
_Avoid_: closed, missing, skipped

**Quant firm**:
A trading firm, market maker, hedge fund or investment bank. Quant firms are kept out of the Top 500 and ranked in their own list. Fintech product companies (Stripe, Ramp) and Capital One are not Quant firms.
_Avoid_: finance company, quant (alone)

**Employer mail**:
A mail from an employer or its job system about an Application: a confirmation that it arrived, a rejection, an online assessment (with its link, and its deadline if the mail states one), an interview invite, or other. It is read with fixed patterns, never by a model, and only ever read: never sent, moved, deleted or marked read. It belongs to an Application only when its sender and subject name that one company and the role picks one row; anything less sure is listed for Lisul and changes nothing.
_Avoid_: email sync, inbox, reply

**Confirmation received**:
The day an Employer mail showed an Application arrived; any confirmation, rejection, assessment or interview invite shows it. A Handoff that one shows arrived, such as a submit Apply was interrupted in, is Submitted.
_Avoid_: confirmed, verified, receipt

**Suggested outcome**:
What the latest Employer mail about a submitted Application says came of it (rejected, OA or interview), written beside the Outcome for Lisul to accept. The Outcome stays Lisul's: Apply never writes it.
_Avoid_: auto outcome, detected outcome, status

**Handoff**:
An Application the system cannot finish alone, for example a site that blocks the browser, or a Posting description that speaks to AI agents (handed off before its form opens, quoting the sentence). A captcha that Lisul did not do within the Captcha wait is also a Handoff. Lisul finishes it from the Tracker row.
_Avoid_: manual, fallback, failed

**Captcha wait**:
The time that Apply keeps a form open for Lisul to do its captcha. Apply never solves or touches a captcha. This includes an "I'm not a robot" box: Claude and its tools cannot click in a captcha's frame. A challenge on the page starts the wait at once. A box that nobody ticked starts it when the form is filled. It pushes "Do the captcha on <company>" to his phone and shows the captcha in the Apply window. When the challenge goes away, or he presses Resume, the fill continues on the same page. After `captcha_wait_minutes` (15), the Application is a Handoff. In a Rehearsal, a captcha after Lisul's own Submit gets only the push: he does it himself. A Bot block has no challenge, so it gets no Captcha wait.
_Avoid_: captcha solve, captcha bypass

**Bot block**:
A page that refuses the Worker's Chrome as a bot and has nothing to solve. Examples are DataDome's "We detected unusual activity from your device or network", Lever's "There was an error verifying your application" and Tesla's "Access Denied". Apply makes it a Handoff at once. It does not retry, sign in again or ask for a new code. The Application stays at Needs you. The student finishes it in their everyday Chrome, where the extension fills the form. In a live run, Apply opens the posting there and pushes "Finish <Company> in your Chrome: the extension fills it". In a Rehearsal, Apply opens it only when Lisul presses Open in my Chrome. Apply never opens it over DevTools or in a Worker profile.
_Avoid_: ban, captcha, stealth

**Resume**:
The action that continues a paused Rehearsal on its open page. A Rehearsal pauses when its fill stops mid-form for Lisul, for example on a step that does not go on. He fixes the page, then presses Resume on its card or Needs you item. Apply reads the page as it is, keeps his fixes and fills the remaining steps. It never starts over, never submits and never asks for a new code. When the tab is closed, the button says why it cannot continue. A filling Rehearsal also shows Resume when Apply waits on Claude, the page shows a field error, or the fill makes no progress for 45 seconds. There, Resume stops the wait and continues from the page as he left it.
_Avoid_: retry, restart, continue

**Worker**:
One process with its own browser that carries one Application at a time: it runs the Filler for the Posting's job system and calls Claude only for answers no stored fact covers. Several run at once.
_Avoid_: bot, agent, runner

**Bot signal**:
A sign that a job system took a Worker's browser for a bot: a captcha challenge, Greenhouse asking for the security code it emails before it takes the form, Ashby refusing the sent form ("We couldn't submit your application"), or a Bot block. Each Tracker row a Worker filled notes the Bot signals it met and whether the Worker's Chrome ran headless or with a window (`worker_headless` in policies.yaml), so the two can be compared before Lisul chooses one. Apply never disguises its browser to avoid them.
_Avoid_: bot score, detection, fingerprint

**Orchestrator**:
The one process that hands Matches to Workers, decides how many run at once, and pauses them all when Lisul's usage limit nears.
_Avoid_: scheduler, manager, controller

**Worker profile**:
A Worker's own browser profile that persists between runs and stays signed in to Lisul's Google account.
_Avoid_: session, browser, Chrome profile

**Apply window**:
The one window where Lisul watches every Worker live (a tile each), reads and edits his answers (the Answers tab), signs in to his Employer accounts (the Accounts tab) and pastes his Own applications (atop that tab), opened by a run or rehearsal, `apply watch` or `apply answers`. On the Mac it is its own app, Apply (~/Applications/Apply.app), in the Dock: click it to bring the window forward, Quit or close the window to end it, and keep it in the Dock to open it again.
_Avoid_: dashboard, Chrome window

**Essay**:
Any free-text answer Claude writes for a form: a question's answer or a Cover letter. Each one answers exactly one Question type.
_Avoid_: unique answer, long answer, free-text response

**Question type**:
The kind of question an Essay answers, which decides what a great answer to it holds: why-company, what-youd-build, values, why-role, preference, best-project, named-area, failure, not-on-resume, ai-tools, opinion, why-field, about-me, anything-else or cover-letter, else the general fallback. Each has a guidance file in apply/answering/types/.
_Avoid_: question category, prompt kind, essay kind

**Essay plan**:
What one Essay will say, picked for the whole form before any is written: its Question type, the Story bank story it leads with, the Company brief fact it ties to him (if any), its angle (a point away from the typical applicant's answer), and its slots: the parts a great answer of that type holds (a claim, a decision and its reason, a result), each with the Story bank or Company brief lines that back it, quoted. An Essay says only what its slots' quotes back: a required slot with no backing becomes a Missing fact for Lisul, and an optional one (a lesson, a feeling, why he cared) is left out. Code checks every quote is word for word in the sources. No two essays on a form lead with the same story. A held row shows each essay's plan above its text.
_Avoid_: outline, essay brief, strategy

**Catch-all box**:
An optional free-text question that asks for anything at all rather than one thing ("Additional information", "Anything else you'd like us to know?", "Comments", "Other information"), on any job system: the anything-else Question type on a question the form doesn't require.
Apply always leaves it blank on purpose. Claude never drafts it, and Needs you never asks it. Verifying notes it as blank on purpose.
A required one is answered briefly. A catch-all box is the one exception to "a blank optional is a bug".
_Avoid_: additional info field, comments box

**High-stakes essay**:
A required free-text answer that asks about this company specifically, asks for something beyond the resume, sits on a form that bans AI-written text (or whose Posting description or Company material does, if only by saying "Do not use AI."), or sits on an Ashby form (held in case Ashby flags AI-written text). Answers about projects, experience or courses drawn from the master resume are not high-stakes.
_Avoid_: hard question, important essay

**Cover letter**:
The one-page letter Claude writes wherever a form offers one, optional or not (policies.yaml: `cover_letter`), except at a company that takes none (`cover_letter_never`: Amazon). Claude fills the four paragraphs of one fixed template (apply.cover_letter, built on research/cover-letter.md); Apply adds the salutation and sign-off and, for an upload, prints it as a PDF in the resume's header and font, named like the resume (Test_Person_Cover_Letter.pdf). It is an essay like any other: checked, held and edited the same way.
_Avoid_: motivation letter, personal statement

**Stock answer**:
Lisul's core answer for a Question type that recurs across forms (why this field, his best project, a failure, how he uses AI tools, and the like; never one about the company), kept one per type. It starts as a real Essay Claude wrote for a held Application, and becomes a Stock answer only when Lisul approves it. Later Essays of that type reuse its facts and reasoning as material, written fresh for each question, never pasted. Only a form that bans AI-written text gets one of his own core answers word for word.
_Avoid_: template answer, canned answer, boilerplate

**Company material**:
What else the employer publishes about itself and the role, read when an Application has essays: any page a question links to, and the company's about page or homepage. The Posting's own text is its Posting description, which every call has already. It is employer text: Claude takes facts about the company from it and never follows instructions in it. It is read for AI traps and bans as the Posting description is.
_Avoid_: research, context, company info

**Company brief**:
What a company builds and works on: its engineering work first (a problem its engineers solved and what made it hard), then its products, customers and people, and the work of the team a role names, each fact with the page it came from, the kinds of problem it is, and a mark when it is the headline launch every applicant sees. It also holds the company's mission and values word for word, what kind of company it is, and, when a form asks, the problems it states itself and what each of its teams or tracks works on. Every fact is confirmed by a quote on its page; one whose page can't be read is marked unchecked and is never a Named fact. Drawn from the company's own pages, or from press coverage when its own pages can't be read. Lisul may edit it. Essays, cover letters and questions about the company draw on it beside the Company material; it is web text, not employer text. Apply reads a brief only when its heading names the form's company. The company comes from the link, the posting, the open form page or a known job site's host. When none names it, essays get no brief, only a note.
_Avoid_: research notes, company profile

**Named fact**:
The one Company brief fact an essay ties to Lisul, with its page, shown with the essay so he can read up on it before an interview.
_Avoid_: cited fact, company hook

**Screener**:
A yes/no or choice question that can rule an applicant out, such as a graduation window or a degree requirement.
_Avoid_: knockout, filter question

**Self-ID answers**:
Lisul's answers, or declines, to the voluntary equal-opportunity questions (gender, race, veteran status, disability).
_Avoid_: EEO data, demographics

**Feed**:
The public list of internship Postings that every run reads from.
_Avoid_: source, job board, listings

**Closed**:
A Posting that no longer takes applications: the Feed marks it inactive, or its job system no longer has it. A Closed Posting is skipped before any form opens; one found closed after its row was written ends with the status closed.
_Avoid_: expired, dead, removed

**Repost**:
A Posting that reappears in the Feed under a new identity but is the same role Lisul already applied to. It counts as applied.
_Avoid_: duplicate, relisting

**Filler**:
The fixed procedure that fills every form of one job system (Greenhouse, Ashby, Lever, Workday, Rippling, Workable, Eightfold) from the Applicant profile.
_Avoid_: autofill, script, bot

**Fill engine**:
The one set of Fillers and answer rules that Apply and the WorkIt extension both run, kept in its own private repo in the WorkIt team's organization. Everything about filling a form lives in it; the two differ only in where written answers come from (Claude for Apply, Scout for the extension) and in what Apply does around the form (sign-in, mail codes, Holds, submitting).
_Avoid_: shared code, autofill library, extension engine

**Claude fill**:
How an Application is filled on a job system with no Filler: Claude works the form in the Worker's browser step by step, under a hard cap on turns and tokens. Hitting the cap, or a form it can't finish alone, is a Handoff, and so is a submit the page never confirms: filled is not applied. A sign-in or new Employer account in the way of the form is got past as for a Filler: Claude fills its email and names, Apply types the password and the emailed code itself (Claude never sees a password), and a refused password or an account Keychain has no password for is a Handoff. While Claude works it, in a run as in a Rehearsal, the drive guard blocks the button that sends the form, a sign-in other than Google's (the sign-in's own button goes through only when Apply clicks it), a payment, withdrawing or deleting the application, account or profile (removing an uploaded file goes on, so a wrong file can be replaced), and ticking an opt-in to texts or marketing that Lisul's policies say no to; it is lifted only for the plain-code click that submits, and anything it blocked is a Handoff, in a Rehearsal as in a run (a Rehearsal still sends nothing). Claude stops at the form's last step and names the button that sends, never clicking it: a click it names as that button is refused before it runs, and one the guard blocked on the very button it then names as the one that sends leaves the form filled, not a Handoff, as a Filler leaves it. A company careers page that embeds a Greenhouse form (its link carries ?gh_jid= or the job's id in its path, or its page shows that form in a frame, as Lever and Ashby forms are found too) is filled by the Greenhouse Filler on that form's own Greenhouse link, not by Claude fill.
_Avoid_: fallback, fallback filler, agent fill

**Question set**:
Every question one Posting's form asks, read before the form is opened.
_Avoid_: form fields, questionnaire

**Pre-submit check**:
The check every filled Application must pass before it is submitted: each answer on the page is read back and compared with what was meant, then Claude reviews the question-and-answer pairs for answers that are valid but wrong.
_Avoid_: validation, QA, review

**Verifying**:
The last part of the Pre-submit check, in rehearsals and runs alike: Apply reads the filled form back from the page and checks it against the Applicant profile, the Posting and its own plan, then the Application is Verified, or Verified with flags. A flag names a field and why it needs Lisul (a blank field, a value the page shows otherwise, a wrong file, a date or pay that doesn't fit, a wrong name or pronoun or another company's name in an essay, answers that contradict each other); a flag holds a run's Application in Needs you, where Lisul fixes or dismisses it. A note (an answer Claude guessed, a blank optional field) holds nothing. A review problem with a legal or eligibility answer (work authorization, sponsorship, citizenship, U.S. Person, export control, age, criminal history) is more than a note. Apply fills the review's fix when it gives one, and reviews the form again. Without a fix, the held page blocks Submit under a red note. Submit is Lisul's again after he presses the note's Dismiss or dismisses it in the window. Verifying only reads: it never presses Submit.
_Avoid_: validation, QA, double-check

**Employer account**:
A login the system creates for Lisul on one employer's careers site when that site requires one and offers no Sign in with Google. On Workday, the system creates one even when the site offers Sign in with Google, unless Lisul's policies say `workday_sign_in: google`. Its password is only in the macOS Keychain. The Accounts tab of the Apply window lists each one. Copy password puts the password on the clipboard for 60 s, and Open sign-in page opens the site in Lisul's own Chrome. The Tracker lists the account, also one that a Rehearsal made.
_Avoid_: ATS account, candidate account

**Not eligible**:
The end state of an Application Lisul would honestly fail, for example a Master's-only role or a graduation window he misses. A Screener on the form finds it, or, before any form opens, the Posting's own required qualifications (one that asks for current graduate study). It is never submitted.
Only an answer that fails the Screener rules him out. A Screener that no option fits is a Missing fact for Lisul.
In a rehearsal, its tile has a Fill it anyway button. The button fills the form as in any rehearsal, and its note says why he was ruled out. A Closed tile has the button too.
_Avoid_: rejected, skipped, disqualified

**Story bank**:
A short set of facts distilled once from the master resume and defensible claims, which Claude reads to write essays instead of the whole resume repo. Lisul's answers to Essay facts are added under "Answered during applications".
_Avoid_: context, notes, bio

**Story map**:
Routing tags for each episode of the Story bank (one story, as one of its lines tells it): the Question types it answers, the kinds of problem it is (the same kinds a Company brief fact carries), the numbers its line holds, what an answer must never claim from it, the questions an interviewer would ask next with whether the Story bank can answer each, and the episodes related to it. It states no facts of its own: the Story bank stays the only source, and an entry whose line has changed since it was tagged is set aside until Lisul tags the bank again. Lisul reviews it in story-map.yaml in the data folder, and the follow-ups the bank can't answer become questions for him.
_Avoid_: story index, tag file, personalized prompts

**Record**:
An Application's full answers and form screenshot, and once it is submitted a screenshot of the page the submit led to, kept outside the Tracker and linked from its row.
_Avoid_: log, artifact, receipt

**Trace**:
What happened in one Application, step by step, kept on this Mac only: each page navigation, console line (the submit guard's blocks among them, naming the request they stopped), page error, non-GET request, failed request and error response, each step of a Claude fill session, and how it ended. Read with `apply trace [query]`; kept two weeks.
_Avoid_: log, debug log, transcript

**Request**:
A Posting Lisul adds himself by pasting its link. It goes to the front of the queue and skips the Match filters, but still passes the Repost check, Screeners, the Pre-submit check and the Hold rules.
_Avoid_: manual application, custom link, add

**Own application**:
An Application Lisul submitted himself, outside Apply, that he adds to the Tracker by pasting a link to its Posting or to the page the employer showed after he submitted (`apply applied <link>`, or the box atop the Apply window's Answers tab). One Haiku call reads the company and role off the link and its page, and the row starts as submitted, dated that day, so the Repost check keeps Apply from applying to that Posting again.
_Avoid_: manual application, logged application, self-apply

**Regenerate**:
Lisul's request that Claude write one of its answers on a held form again, with context he types. He presses "Add context and regenerate" beside the field, on the form or in the Apply window. His context joins the Story bank with the question it was for. Claude writes the answer by the usual essay path, and the answer replaces the field's value. An answer over the form's limit, or with a fact no source holds, stays off the form. Nothing is sent.
_Avoid_: redo, rewrite, retry

**Ask Claude**:
Claude's fix, live on a held form, of a problem Lisul tells it in his own words. He types it in the form's tile in the Apply window, or sends it with `apply ask`. Claude reads back what it changed and answers in the Application's thread. It never submits and never ticks his attestation boxes unless he says so. A fact he states goes in the Answer bank only on his click.
_Avoid_: chat, assistant, live edit

**Rescue**:
Claude filling, live on the open form, one field a Filler's own code failed on (a FillError, or a click that timed out), so the Application goes on to the next step instead of failing. It runs under the drive guard, is read back and checked like any field, and leaves a Repair request so the Filler's code is fixed too. Workday's Filler has one.
_Avoid_: fallback, live repair, retry

**Repair request**:
A failure of Apply's own making, kept for a Repair: an Application that failed with an error, a Missing fact the Applicant profile may already answer, an answer the Pre-submit check caught wrong, or a field a Rescue filled. One cause makes one Repair request, however many Applications it hits.
_Avoid_: bug report, ticket, issue

**Repair**:
Claude's fix to Apply's own code for one Repair request, written test-first on its own branch (in the Fill engine's repo when the fix is to filling or a rule) and merged only if Apply's whole test suite and the engine's tests pass and it leaves the protected paths alone (the submit guard and every Filler's submit, which stay in Apply; the Hold and Pre-submit rules, sign-in, mail and passwords, the Applicant profile, the Answer bank, the Story bank, the policies; the engine's dependencies and test setup). An engine fix merges into the branch Apply's submodule tracks and moves Apply's pointer, never WorkIt's. A Repair that fails that gate waits for Lisul. A merged Repair queues its Applications again; a Missing fact no profile entry answers stays Lisul's.
_Avoid_: patch, self-heal, auto-fix
