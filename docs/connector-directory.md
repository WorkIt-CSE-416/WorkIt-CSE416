# Connector directory submission (KAN-383)

The WorkIt connector (`backend/app/connector/`, `auto-apply/architecture.md` 14.6)
goes into Anthropic's Connectors Directory. This file holds everything the
submission form asks for, ready to paste. **Nobody has sent it yet.** The team
member who owns the Claude account sends it, after the steps in "Before you
send".

Checked against Anthropic's docs on 2026-10-25:
[submission](https://claude.com/docs/connectors/building/submission),
[review criteria](https://claude.com/docs/connectors/building/review-criteria),
[directory vs custom](https://claude.com/docs/connectors/building/directory-vs-custom).
Submit at <https://claude.ai/directory/manage>: **Submit new**, then **MCP
connector**. Any paid Claude plan can submit. Escalations: `mcp-review@anthropic.com`.

## Before you send

1. **The connector is deployed.** Checked 2026-10-31: `https://api.workitjobs.ai/mcp`
   answers 401 without a token, `/.well-known/oauth-authorization-server`
   answers 200, and `https://workitjobs.ai/connect/claude/add` redirects to the
   Add Custom Connector link below. Before you send, check once more that
   the API has `CONNECTOR_API_URL=https://api.workitjobs.ai` and
   `CONNECTOR_WEB_URL=https://workitjobs.ai`.
2. **Deploy the finished Privacy Policy.** `/privacy` has a section on the
   connector (what Claude reads, what WorkIt keeps, how to stop it), and
   the KAN-462 answers fill every open item on `/privacy` and `/terms`
   (contact email `team@workitjobs.ai`). Anthropic rejects a submission
   with an incomplete privacy policy, so deploy them before you send.
3. **Make the reviewer account** (see "Test & launch" below) and check it
   once through Claude yourself.
4. **Test every tool in Claude** as a custom connector (Auto Apply's Add to
   Claude button, or the link below), and once in MCP Inspector, with the
   steps in "Reviewer test steps" below. The form asks you to confirm both.
5. After approval, Anthropic gives the listing's slug. Set
   `CLAUDE_CONNECTOR_LINK=https://claude.ai/directory/connectors/<slug>` on
   the webapp; every Add to Claude button then opens the listing.

Until the listing is live, students add WorkIt as a custom connector through
this link (what Add to Claude opens):

```
https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=WorkIt&connectorUrl=https%3A%2F%2Fapi.workitjobs.ai%2Fmcp
```

It was checked in Chrome on 2026-10-25: claude.ai opens the Add Custom
Connector dialog with "WorkIt" and `https://api.workitjobs.ai/mcp` filled in,
under a notice that the values came from an external link. Free plans allow
one custom connector.

## Checklist

| Requirement (Anthropic) | WorkIt | Where |
|---|---|---|
| Remote server over HTTPS | `https://api.workitjobs.ai/mcp`, Streamable HTTP, stateless | `app/connector/server.py` (after deploy) |
| OAuth 2.0 for a user's account | WorkIt's own OAuth 2.1 server: discovery metadata, dynamic client registration, PKCE, refresh rotation, revocation | `app/connector/oauth.py`, consent page `/connect/claude` |
| Every tool has a `title` and `readOnlyHint` or `destructiveHint` | Yes, checked by a test for every tool | `tests/test_connector.py` |
| Read and write in separate tools | Four read tools (`get_*`), five write tools (`save_*`); none does both | `app/connector/tools.py`, `briefs.py`, `style.py` |
| Tool names of 64 characters or fewer | Yes, tested | same test |
| Descriptions say what a tool does, no instructions to Claude | Yes; the writing rules are an MCP prompt only | `tools.py` docstring |
| Actionable errors, not generic ones | Each refusal is a tool error with the reason ("The answer to 'question_7' is 812 characters; the form takes at most 600.") | `pipeline.save_answers` |
| Collect no conversation data beyond the tool's need | The tools take only what they save: answers, a fact question, a review, company facts with their source pages, a style card. Nothing reads Claude's chats, memory or files | `tools.py`, `briefs.py`, `style.py` |
| First-party API | WorkIt's own API and database | |
| No money transfer, no AI image, video or audio | None | |
| Privacy policy URL | `https://workitjobs.ai/privacy` (open items: see above) | `frontend/src/app/(landing)/privacy/page.tsx` |
| Documentation URL | `https://workitjobs.ai/docs/mcp` | `frontend/src/app/(landing)/docs/mcp/page.tsx` |
| Test account for reviewers | To make (see below) | |

## 1. Connection

- Server URL: `https://api.workitjobs.ai/mcp`
- Users connect to different URLs: **No** (one URL for everyone).

## 2. Tools

These sync from the server. Expect:

| Tool | Title | Annotations |
|---|---|---|
| `get_next_application` | Get the next application | `readOnlyHint: true`, `openWorldHint: false` |
| `get_review_task` | Get a review task | `readOnlyHint: true`, `openWorldHint: false` |
| `get_research_task` | Get a company to research | `readOnlyHint: true`, `openWorldHint: false` |
| `get_writing_samples` | Get my writing samples | `readOnlyHint: true`, `openWorldHint: false` |
| `save_answers` | Save answers | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` |
| `save_fact_question` | Ask the student for a fact | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` |
| `save_review` | Save review | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` |
| `save_company_brief` | Save a company brief | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` |
| `save_style_card` | Save my style card | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` |

Prompt: `write_my_workit_answers`, titled "Write my WorkIt answers".

`test_every_tool_carries_the_annotations_anthropics_directory_asks_for`
(`backend/tests/test_connector.py`) fails on a tool without a title or
these hints, so a tool added before you send needs a row here too.

`save_answers` is marked not destructive: it fills an application's
unanswered written questions, deletes nothing, sends nothing to an employer,
and the student reviews every answer in the form before they submit. Claude
may still ask before each save. `save_fact_question` is not destructive
either: it keeps a question for the student on one unanswered question
(KAN-369) and changes nothing else until the student answers it.
`save_review` replaces only the earlier review of the same application.
`save_company_brief` replaces the shared brief only with one that scores
higher on checked facts (KAN-382), and `save_style_card` replaces only the
student's own earlier card (KAN-384).

`save_company_brief` has `openWorldHint: false` although WorkIt reads each
fact's page: Claude does the web research itself, and WorkIt only reads the
pages Claude names, on the company's own site or a fixed list of news sites,
to check each quote. If the reviewer asks, this is the reason.

## 3. Listing

- **Server name:** WorkIt
- **One-liner** (200 max):
  > Your own Claude writes the answers to your WorkIt job applications' written questions, from your real experience, and WorkIt fills them into each open application.
- **Description** (2,000 max):
  > WorkIt helps students apply to internships and new-grad jobs. Its Chrome extension fills each application's factual fields from the student's WorkIt profile. Written questions, such as "Why do you want to work here?", need real writing, and the WorkIt connector lets the student's own Claude write them.
  >
  > Run the prompt "Write my WorkIt answers". Claude takes the student's open applications one at a time. For each, it reads the job posting, the questions still unanswered, and the student's experience bank and skills, then writes each answer in the student's voice, using only facts from their own experience. It saves the answers to WorkIt, and the extension fills each one into that application's open tab in Chrome.
  >
  > WorkIt never submits an application. The student reads every answer in the form, changes what they want, and submits it themselves. Claude sees only the application it is writing for: never the student's contact details, self-identification answers or resume files. WorkIt calls no AI model for the connector; Claude writes with the student's own Claude plan.
  >
  > Tools: get_next_application (read-only) returns the next application with written questions unanswered. save_answers saves answers to that application's questions, all or none, and refuses an answer that is empty, too long for the form, or for a question the application doesn't ask. get_research_task and save_company_brief build a short brief on each company, of facts WorkIt checks word for word on their source pages. get_writing_samples and save_style_card let Claude write in the student's own voice from samples they gave. get_review_task and save_review check finished answers before the student reads them.
- **Categories:** pick the closest to Productivity and Career (the form's list decides).
- **Documentation URL:** `https://workitjobs.ai/docs/mcp`
- **Privacy policy URL:** `https://workitjobs.ai/privacy`
- **Support contact:** `team@workitjobs.ai` (the address the Privacy Policy names).
- **Icon:** `frontend/public/workit-icon.svg` (export a square PNG if the form asks for one).
- **Slug** (permanent): `workit`

## 4. Use cases

- **Primary use cases:** writing the answers to job applications' written
  questions from the student's own experience; filling them into the open
  applications, which the student reviews and submits.
- **What users need first:** a WorkIt student account (free) with experiences
  added, the WorkIt Chrome extension, and open applications from Auto Apply.
  Any Claude plan.
- **Reads or writes:** both. It reads the next application and the student's
  experience; it writes answers to that application's questions.

## 5. Company

- Company name: WorkIt. Website: `https://workitjobs.ai`.
- Primary contact for review updates: the person who sends this.

## 6. Authentication

- Authentication requirement: **Required** (every call needs a WorkIt token).
- Method: **OAuth**, with dynamic client registration. Don't enter a client
  ID or secret: Claude registers itself at `https://api.workitjobs.ai/register`.
- Endpoints (from discovery): `/.well-known/oauth-protected-resource/mcp`,
  `/.well-known/oauth-authorization-server`, `/authorize`, `/token`,
  `/revoke`, all on `https://api.workitjobs.ai`. Scope: the one connector
  scope. Access tokens last 1 hour; refresh tokens 90 days, rotated on use.
  The student approves on `https://workitjobs.ai/connect/claude`.

## 7. Data handling

- Underlying API: **our own** (WorkIt's API and database).
- Personal health data: **No**. Sponsored content: **No**.
- What it holds: the job posting and questions of one application, the
  student's experience bank and skills (no contact details, no links), and
  the answers Claude saves; the student's own writing samples (optional) and
  the style card built from them; Claude's reviews of the answers; and
  company briefs, which hold public facts about employers only, shared by
  every student applying there. Tokens are stored as SHA-256 hashes. Deleting a
  WorkIt account deletes its tokens and saved answers.

## 8. Test & launch

Make a reviewer account before sending (not the shared team test account):

1. Sign up at `https://workitjobs.ai/signup` as a student with an email the
   team controls, e.g. `workit.reviewer+claude@<team domain>`. Finish
   onboarding with a sample resume, so the experience bank has entries and
   skills.
2. Install the WorkIt extension, open Auto Apply, and start a batch (or the
   onboarding practice batch) so at least two open applications hold written
   questions. Leave them unsubmitted. Run "Write my WorkIt answers" once
   so each of their companies has a saved brief: until then
   `get_next_application` answers `research_first` instead of the
   application.
3. Check `get_next_application` returns an application through Claude, then
   remove your own connection.

Text for the form (fill the bracketed parts):

> 1. In Claude, add a custom connector with URL https://api.workitjobs.ai/mcp (or use the directory's Connect button).
> 2. Click Connect. You are sent to WorkIt's sign-in. Sign in with: email [reviewer email], password [reviewer password]. Click Allow on the Connect Claude page.
> 3. In a chat with the WorkIt connector on, run the prompt "Write my WorkIt answers", or call get_next_application directly. It returns an open application with its job posting, unanswered written questions and the account's experience.
> 4. Call save_answers with that job_id and an answer for each question name. It answers how many were saved and how many are left; get_next_application then moves to the next application. Try an empty answer or an unknown question name to see the refusals.
> 5. The account holds [N] open applications with questions. If they run out, sign in at https://workitjobs.ai, open Auto Apply, and start a new batch (this step needs the WorkIt Chrome extension), or email team@workitjobs.ai and we reset the account.
>
> The connector never submits an application and never contacts an employer.

Confirm you ran every tool as a custom connector in Claude, and in MCP
Inspector (`npx @modelcontextprotocol/inspector`, Streamable HTTP, the URL above).

## Reviewer test steps

Run these before sending, signed in as the reviewer account, once in Claude
and once in MCP Inspector. The form's test-account field gets the short
version above; this is the full check. Nothing here submits an application
or contacts an employer.

### Reviewer test account

Lisul makes the account and sends the form; nobody else creates it.

1. Sign up at `https://workitjobs.ai/signup` as a student, with an address
   that forwards to the team Gmail (for example a `team+reviewer@` alias, if
   Cloudflare Email Routing has a route for it). Not the shared team test
   account (`frontend/CLAUDE.md`).
2. Finish onboarding with a sample resume from `frontend/public/resumes/`,
   so the experience bank has entries and skills.
3. On Profile, add one or two Writing Samples (any short text the team
   wrote), so `get_writing_samples` and `save_style_card` have something to
   work on.
4. Install the WorkIt extension, open Auto Apply, and start a batch (or the
   onboarding practice batch) until at least three open applications hold
   written questions. Leave every one unsubmitted.
5. Write down the email, password and the number of open applications for
   the form's bracketed parts.
6. After your own test, disconnect Claude in Settings > Sign-In & Security >
   Connected Apps, so the reviewer starts from a clean connection. Answers
   you saved stay on the applications; start a fresh batch if fewer than
   three are left unanswered.

### In Claude

Add the connector (Settings > Connectors > Add custom connector, URL
`https://api.workitjobs.ai/mcp`, or the install link above), click Connect,
sign in as the reviewer and click Allow on the Connect Claude page. In a new
chat with WorkIt turned on, type each prompt and check the result. Read
tools run with no permission prompt; Claude asks before each `save_*` tool
unless you allowed it.

| # | Tool | Type this in Claude | Expected result |
|---|---|---|---|
| 1 | `get_research_task` | `Use WorkIt's get_research_task tool and tell me which company it returns and why.` | A company from an open application, with a `reason` of `missing`, `stale`, `weak` or `unnamed`, its score, the categories it lacks and the allowed news sites. `company: null` once every company has a current brief. |
| 2 | `save_company_brief` | `Research that company on its own website and save a brief of at least 3 facts with save_company_brief, each with its page URL and a word-for-word quote.` | `kept` counts the facts that passed, `dropped` lists each failed fact with its reason (quote not on the page, site not allowed, number not in the quote). `saved: true` when at least 3 facts pass and the score beats the kept brief. |
| 3 | `get_next_application` | `Use WorkIt's get_next_application tool and show me the company, job title and questions it returns.` | A `job_id`, the company, title and job posting, the unanswered questions (each with `name`, `kind` and `max_length`), the experience bank and skills, and the company brief. If it returns `research_first` with a company name instead, run steps 1 and 2 for that company and ask again. |
| 4 | `save_fact_question` | `For one of those questions, use save_fact_question to ask me for one fact about my first experience entry that the answer would need.` | `left` counts the questions still unanswered. The question shows on WorkIt's Written Answers page (`/auto-apply/answers`) and in the application's tab. A `name` the application doesn't have is refused with that reason. |
| 5 | `save_answers` | `Write an answer to each remaining question from my experience and save them with save_answers.` | `saved` and `left` counts, and `read_first` naming the answers to read before Submit. The answers show in the application's open tab in Chrome. |
| 5b | `save_answers` (refusals) | `Call save_answers for that job with an empty answer to the first question, then with a question name of "not_a_question".` | Two tool errors, nothing saved: `The answer to '<name>' is empty.` and `The application has no question named 'not_a_question'. Use the names get_next_application gave.` |
| 6 | `get_review_task` | `Use WorkIt's get_review_task tool and show me the application and answers it returns.` | An application whose questions are all answered, each answer with its question, `own` flag and `version`. `job_id: null` when none is waiting. |
| 7 | `save_review` | `Review those answers against my experience and save the review with save_review, passing back each answer's version.` | `flagged` counts the answers the tab now marks as needing the student (0 when none is wrong); `changed` lists any answer edited since step 6. |
| 8 | `get_writing_samples` | `Use WorkIt's get_writing_samples tool and show me what it returns.` | The samples added on Profile, word for word, and `style_card: null` before step 9. |
| 9 | `save_style_card` | `Build a short style card from those samples and save it with save_style_card.` | `saved: true`. Running step 8 again shows the card. An empty card is refused with `The style card is empty.` |
| 10 | prompt `write_my_workit_answers` | Pick "Write my WorkIt answers" from the connector's prompts (the + menu), then send. | Claude runs the tools above in order on each open application, saves the answers, and stops after 5 applications with a message to start a new chat. |

### In MCP Inspector

1. Run `npx @modelcontextprotocol/inspector` and open the URL it prints.
2. Transport **Streamable HTTP**, URL `https://api.workitjobs.ai/mcp`.
3. Open the authentication settings and run the OAuth flow (the guided or
   quick flow). It registers a client at `/register`, opens WorkIt's
   sign-in; sign in as the reviewer and click Allow. Then **Connect**.
   Without a token the server answers 401.
4. **Tools > List Tools**: nine tools. Click each and check its annotations
   against the table in "2. Tools": the four `get_*` tools `readOnlyHint:
   true`, the five `save_*` tools `readOnlyHint: false` and
   `destructiveHint: false`, all `openWorldHint: false`.
5. Run each tool with the arguments below and check the result matches the
   Claude table. Leave `chat` empty.

| Tool | Arguments | Expected |
|---|---|---|
| `get_research_task` | none | As row 1. |
| `save_company_brief` | `company` from that result, `facts` a list of 3 objects `{category, fact, url, quote}` | As row 2; a made-up quote comes back in `dropped`. |
| `get_next_application` | none | As row 3. |
| `save_fact_question` | `job_id`, `name` of one question, `question`, `about` = the first line of one entry in `experience` | As row 4. |
| `save_answers` | `job_id`, `answers: [{"name": "<question name>", "answer": ""}]` | The empty-answer refusal (row 5b). A real text answer also needs `plan` and `unsupported`, which the prompt builds; save one through Claude instead. |
| `get_review_task` | none | As row 6. |
| `save_review` | `job_id`, `problems: []`, `versions` from `get_review_task` | `flagged: 0`. |
| `get_writing_samples` | none | As row 8. |
| `save_style_card` | `card: "Short sentences, plain words."` | `saved: true`. |

6. **Prompts > List Prompts**: `write_my_workit_answers`, titled "Write my
   WorkIt answers"; **Get Prompt** returns its text.

## 9. Compliance

Seven acknowledgments: directory guidelines, first-party API usage,
financial transactions, AI media generation, prompt injection, conversation
data collection, public documentation. All apply cleanly: WorkIt's own API,
no payments, no media generation, no instructions in tool descriptions, no
conversation data, public docs at `/docs/mcp`.

## 10. Review and submit

Read the quality warnings the form shows, fix any short answers, and send.
After sending, Anthropic scans it and by default lists it as a Community
connector; track it at `claude.ai/directory/manage`.
