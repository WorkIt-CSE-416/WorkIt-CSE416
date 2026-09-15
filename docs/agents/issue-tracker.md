# Issue tracker: Jira

Issues and specs for this repo live in **Jira**, project key **`KAN`**. Branches
and PR titles already carry the ticket id (`KAN-55-Job-Scraper`,
`KAN-63: Define ingestion architecture`), so the ticket id is the join key
between a branch, its PR, and its spec.

Access is via the **Atlassian MCP server** (`mcp__atlassian__*` tools),
configured at local scope in `.claude.json`. The exact tool names appear once
the server is authenticated — list them rather than guessing, then use the one
matching the operation below. If the server is unauthenticated, tell the user to
run `/mcp`, select `atlassian`, and complete the browser OAuth flow; do not fall
back to inventing ticket ids.

GitHub Issues is **not** used for this repo and should never be written to.
GitHub holds pull requests only.

## Conventions

- **Create an issue**: create a Jira issue in project `KAN` via the MCP create tool. Title is a single imperative line; body is the spec.
- **Read an issue**: fetch by key (`KAN-55`) including comments.
- **List issues**: search with JQL, e.g. `project = KAN AND status != Done ORDER BY created DESC`.
- **Comment on an issue**: add a comment via the MCP comment tool, addressed by key.
- **Apply / remove labels**: edit the issue's `labels` field. Jira labels are free-form strings; see `triage-labels.md`.
- **Close**: transition the issue to `Done` and leave a comment saying why.

## Pull requests as a request surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

Pull requests live on GitHub (`gh pr ...`) and are the review surface, not the
tracking surface. A PR is expected to reference its Jira key in the title.

## When a skill says "publish to the issue tracker"

Create a Jira issue in project `KAN`. If the Atlassian MCP server is not
authenticated, write the ticket to `.scratch/<feature>/<slug>.md` instead and
tell the user it needs pasting into Jira — never silently drop it.

## When a skill says "fetch the relevant ticket"

Resolve the Jira key from the current branch name (`KAN-55-Job-Scraper` →
`KAN-55`) and fetch that issue with its comments.

## Wayfinding operations

Used by `/wayfinder`. The **map** is one Jira issue; **tickets** are its children.

- **Map**: a Jira issue labelled `wayfinder-map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: a subtask of the map issue, or a task linked to it with a `relates to` link where subtasks are unavailable. Labels: `wayfinder-research`, `wayfinder-prototype`, `wayfinder-grilling`, `wayfinder-task`.
- **Blocking**: Jira's native issue links — `is blocked by` / `blocks`. This is the canonical, UI-visible representation; do not encode edges in body text when the link type is available.
- **Frontier query**: `project = KAN AND parent = <map> AND status != Done AND assignee IS EMPTY`, then drop any issue with an unresolved `is blocked by` link. First in map order wins.
- **Claim**: assign the issue to the driving dev, the session's first write.
- **Resolve**: comment the answer, transition to `Done`, then append a context pointer to the map's Decisions-so-far.
