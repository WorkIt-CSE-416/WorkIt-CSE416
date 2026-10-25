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

1. **Deploy the connector.** On 2026-10-25, `https://api.workitjobs.ai/mcp`
   and `/.well-known/oauth-authorization-server` answer 404: the KAN-369
   branch is not deployed. Deploy it, run the branch's migrations on the
   shared database (among them `b4d6f8a0c223_connector_oauth`, the three
   connector tables, and the written-answers one), and set
   `CONNECTOR_API_URL=https://api.workitjobs.ai` and
   `CONNECTOR_WEB_URL=https://workitjobs.ai` on the API.
2. **Fill the Privacy Policy's open items.** `/privacy` has a section on the
   connector (what Claude reads, what WorkIt keeps, how to stop it), but its
   `[TEAM TO DECIDE]` marks (operator's legal name, privacy contact email,
   retention after an account closes) are still open. Anthropic rejects a
   submission with an incomplete privacy policy.
3. **Make the reviewer account** (see "Test & launch" below) and check it
   once through Claude yourself.
4. **Test every tool in Claude** as a custom connector (Auto Apply's Add to
   Claude button, or the link below), and once in MCP Inspector. The form
   asks you to confirm both.
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
| Read and write in separate tools | One read tool, one write tool | `app/connector/tools.py` |
| Tool names of 64 characters or fewer | Yes, tested | same test |
| Descriptions say what a tool does, no instructions to Claude | Yes; the writing rules are an MCP prompt only | `tools.py` docstring |
| Actionable errors, not generic ones | Each refusal is a tool error with the reason ("The answer to 'question_7' is 812 characters; the form takes at most 600.") | `pipeline.save_answers` |
| Collect no conversation data beyond the tool's need | The tools take a job id and answers only; nothing reads Claude's chats, memory or files | `tools.py` |
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
| `save_answers` | Save answers | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` |

Prompt: `write_my_workit_answers`, titled "Write my WorkIt answers".

If KAN-379 to KAN-382 add tools before you send, check each one shows a title
and is in the right group (the test fails on a tool without them).

`save_answers` is marked not destructive: it fills an application's
unanswered written questions, deletes nothing, sends nothing to an employer,
and the student reviews every answer in the form before they submit. Claude
may still ask before each save.

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
  > Tools: get_next_application (read-only) returns the next application with written questions unanswered. save_answers saves answers to that application's questions, all or none, and refuses an answer that is empty, too long for the form, or for a question the application doesn't ask.
- **Categories:** pick the closest to Productivity and Career (the form's list decides).
- **Documentation URL:** `https://workitjobs.ai/docs/mcp`
- **Privacy policy URL:** `https://workitjobs.ai/privacy`
- **Support contact:** the team's support email (to decide; the same one the Privacy Policy names).
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
  the answers Claude saves. Tokens are stored as SHA-256 hashes. Deleting a
  WorkIt account deletes its tokens and saved answers.

## 8. Test & launch

Make a reviewer account before sending (not the shared team test account):

1. Sign up at `https://workitjobs.ai/signup` as a student with an email the
   team controls, e.g. `workit.reviewer+claude@<team domain>`. Finish
   onboarding with a sample resume, so the experience bank has entries and
   skills.
2. Install the WorkIt extension, open Auto Apply, and start a batch (or the
   onboarding practice batch) so at least two open applications hold written
   questions. Leave them unsubmitted.
3. Check `get_next_application` returns an application through Claude, then
   remove your own connection.

Text for the form (fill the bracketed parts):

> 1. In Claude, add a custom connector with URL https://api.workitjobs.ai/mcp (or use the directory's Connect button).
> 2. Click Connect. You are sent to WorkIt's sign-in. Sign in with: email [reviewer email], password [reviewer password]. Click Allow on the Connect Claude page.
> 3. In a chat with the WorkIt connector on, run the prompt "Write my WorkIt answers", or call get_next_application directly. It returns an open application with its job posting, unanswered written questions and the account's experience.
> 4. Call save_answers with that job_id and an answer for each question name. It answers how many were saved and how many are left; get_next_application then moves to the next application. Try an empty answer or an unknown question name to see the refusals.
> 5. The account holds [N] open applications with questions. If they run out, sign in at https://workitjobs.ai, open Auto Apply, and start a new batch (this step needs the WorkIt Chrome extension), or email [support contact] and we reset the account.
>
> The connector never submits an application and never contacts an employer.

Confirm you ran every tool as a custom connector in Claude, and in MCP
Inspector (`npx @modelcontextprotocol/inspector`, Streamable HTTP, the URL above).

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
