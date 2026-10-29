# Issue tracker: Jira (KAN)

Issues and specs for this repo live in Jira: site `workitsbu.atlassian.net`
(cloudId `19bf5b0f-191c-4078-a5ec-543cf6597321`), project **KAN**. Use the
Atlassian MCP server's tools (`mcp__atlassian__*`); `gh issue` is not used. The
repo has never had a GitHub issue.

Each person connects once: `claude mcp add --scope user --transport http
atlassian https://mcp.atlassian.com/v2/mcp`, then `/mcp` to sign in.

## The project's shape

- **Types:** Epic, Story and Task, nothing else.
  - **Epic**: one outcome that ships, closed when it is live (e.g. KAN-181
    Resume Builder & Parser, KAN-68 Job Scraper).
  - **Story**: a change a student can see. A bug fix is a Story, since the
    student sees the fix.
  - **Task**: work no student sees: infra, research, chores.
- **No Bug, no Subtask.** The project never had a Bug type. Subtask blurred
  into Task, so the team dropped it (2026-10-27); the finished Subtasks under
  KAN-329 are history, and none are made again.
- **Statuses:** To Do → In Progress → In PR Review → Done.
- **Hierarchy:** two levels. Every Story and Task hangs under an Epic through
  the `parent` field; none floats. Nothing hangs under a Story or Task.
- **One ticket, one PR.** A ticket too big for one PR is split into more
  Stories or Tasks under the same Epic, never into pieces under itself.
- **GitHub link:** Jira's GitHub integration attaches PRs to a ticket through
  the `KAN-###` in the branch name, so every branch is `KAN-###-slug` off `main`.

## Conventions

- **Create an issue**: `createJiraIssue` with projectKey `KAN`, type Story
  (a student sees it, bug fixes included) or Task (no student sees it), and
  `parent` set to the right Epic. KAN is the whole team's board: show the user
  every title and body and get a yes before creating anything.
- **Read an issue**: `getJiraIssue` (view `evidence` adds links and comments).
- **List issues**: `searchJiraIssuesUsingJql`, e.g.
  `project = KAN AND status = "To Do" AND labels = ready-for-agent`.
- **Make an issue a sub-issue of a parent**: set `parent` to the Epic's key.
  The parent is always an Epic, never a Story or Task.
- **Comment on an issue**: `addOrEditJiraIssueComment`.
- **Apply / remove labels**: `editJiraIssue` on the `labels` field.
- **Move status**: `transitionJiraIssue`, with the transition id from
  `listJiraIssueTransitions` (via `discover` / `executeRead`).
- **Close**: transition to Done with a comment saying why. Never delete an issue.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a KAN issue as in **Create an issue** above, after the user approves it.

## When a skill says "fetch the relevant ticket"

Take the KAN key from the branch name (`git branch --show-current`) unless the
user names one, and read it with `getJiraIssue`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single Epic with **child** issues as tickets.

- **Map**: an Epic labelled `wayfinder:map`, holding the Notes /
  Decisions-so-far / Fog body in its description.
- **Child ticket**: a Story or Task with `parent` set to the map Epic, labelled
  `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: Jira's "Blocks" issue link. A ticket is unblocked when every
  issue that blocks it is Done.
- **Frontier query**: `parent = <map> AND statusCategory != Done AND assignee
  is EMPTY ORDER BY Rank`, dropping any with an open blocker; first wins.
- **Claim**: assign the ticket to the current user (`atlassianUserInfo`) and
  transition it to In Progress, the session's first write.
- **Resolve**: comment the answer, transition to Done, then append a context
  pointer (gist + link) to the map's Decisions-so-far.
