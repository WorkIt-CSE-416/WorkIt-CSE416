---
name: pr-review
description: Pre-PR code review and bug hunt. Reads the code the user points at, reconstructs what it is supposed to do, traces every execution path against that intent, and writes a severity-ranked findings report with reasoning traces, reproduction cases, and suggested patches to claudeskill_reports/pr-review/. Use this whenever the user asks for a review of code they just wrote — "review my PR", "look this over before I open a PR", "review my changes", "check this for bugs", "did I miss any edge cases", "sanity check this implementation", "anything wrong with this?" — or hands over files/folders and asks what's broken. Use it even when the request is casual or when the code looks short and obvious, and use it for logic errors, unhandled edge cases, error handling gaps, and syntax problems alike.
---

# PR Review

A pre-PR review. The goal is to catch what the author's own eyes slide past: the branch never taken, the input never tried, the failure never handled.

The output is a markdown report in `claudeskill_reports/pr-review/`, not a chat message and not a set of edits to their code. The author decides what to act on. Try running the code with commands, but if they fail trace the logic of the program directly without running the code.

## The core discipline

Most bad code review comes from reviewing code against itself. If you read a function and ask "does this do what it does?", the answer is always yes. You have to know what it is *supposed* to do first, then check whether it does that. Everything below is in service of that.

The second failure mode is volume. Twenty speculative findings buries the two real ones. A finding that survives scrutiny is worth ten that might be something. Cut aggressively.

## Step 1 — Establish scope

Review what the user pointed at. If they named files, that's the scope. If they named a folder, read it and decide which files are actually in play. If they said "my changes" or "my PR" without specifics, check `git diff`, `git diff --staged`, and `git log --oneline -5` to find the working set — this is usually the most accurate signal of what they want reviewed.

Read every file in scope completely before analyzing any of it. Partial reads produce findings that are already handled thirty lines down.

## Step 2 — Reconstruct intended behavior

Before looking for anything wrong, build an explicit model of what correct looks like. Sources, roughly in order of reliability:

- **Tests** — the most honest statement of intent that exists. Read them even though they pass.
- **Callers** — how is this function actually used? What do callers assume about return values, exceptions, mutation, ordering?
- **Docstrings, comments, type hints, schemas** — stated intent. Note where these disagree with the code; that gap is itself a finding.
- **The diff** — what problem was the author solving? A change usually has a purpose, and bugs cluster where the purpose was imperfectly executed.
- **README, config, migrations, adjacent modules** — the surrounding context that tells you whether input is trusted, whether this runs concurrently, whether it's a hot path.
- **Naming** — weak evidence, but a function named `validate_and_save` that doesn't validate is telling you something.

Write down, for yourself, a one-line contract per unit under review: inputs and their assumed constraints, outputs, side effects, error behavior. You will check against this. If you cannot state the contract, say so in the report — ambiguous intent is a real problem worth surfacing.

## Step 3 — Trace the paths

Enumerate entry points, then walk each one.

**Control flow.** Every branch, including the implicit `else` nobody wrote. Every loop: what happens at zero iterations, one, and the boundary? Every early return — does it skip cleanup, unlock, commit, or logging that later code depends on? Every `try` — what's actually in scope of the `catch`, and what does the function return when it fires?

**Data flow.** Follow each value from where it enters to where it's consumed. Where could it be null, empty, negative, zero, unset, the wrong type, a different unit, or already-mutated by something else? Trace it through transformations and check the type and shape at each hop.

**State and lifecycle.** What's mutated, and is anything else holding a reference to it? What's shared across requests, threads, or invocations? What must be closed, released, or rolled back on every exit path, including the exceptional ones?

For anything nontrivial, actually walk a concrete input through the code and note the value of each variable as you go. Symbolic reasoning about a loop is where off-by-ones hide; arithmetic on real numbers is where they surface.

## Step 4 — Hunt

Trace first, then use this as a sweep for what tracing missed. Not every item applies to every language or codebase.

**Logic**
Off-by-one and inclusive/exclusive boundary mixups; inverted or short-circuited conditions; `&&`/`||` precedence; loop variables captured by closures; mutating a collection while iterating it; comparison of the wrong things (identity vs equality, reference vs value); early `return`/`break`/`continue` that exits sooner than intended; copy-paste where one variable didn't get renamed.

**Edge cases**
Empty collections, single-element collections, exactly-at-the-limit; null/None/undefined/nil; zero, negative, and very large numbers; division by a value that can be zero; empty strings and whitespace-only strings; unicode, emoji, and multi-byte characters where length is assumed to be byte count; duplicates where uniqueness is assumed; timezone-naive datetimes, DST boundaries, and leap days; float precision in comparisons and money.

**Errors and failure**
Swallowed exceptions (`catch` that logs and continues into code that assumed success); over-broad catches hiding real bugs; error paths that return a value the caller can't distinguish from success; resources not released on the error path; partial writes with no rollback; retries without backoff or without idempotency; failure to check a return code or a rejected promise.

**Async and concurrency**
Missing `await`; unawaited promises that swallow rejections; race conditions on shared state; check-then-act without atomicity; unbounded parallelism; deadlock ordering; assumptions that callbacks fire in order or exactly once.

**Interfaces and contracts**
Function signature vs. actual call sites; return type varying by branch (returns a list sometimes, `None` others); mutating an argument the caller still owns; breaking a documented invariant; API/schema mismatch; missing or wrong migration for a model change.

**Input handling**
Unvalidated external input reaching a query, path, command, or template; missing bounds on user-supplied sizes, counts, or offsets; trusting client-supplied identity or authorization fields; secrets or PII in logs and error messages.

**Syntax and mechanics**
Genuine syntax errors, undefined names, bad imports, unreachable code, shadowed variables, wrong argument order in a call. These are cheap to find by parsing or running — do that rather than reading for them.

## Step 5 — Verify before you write it down

This is the step that separates a useful report from noise. For every candidate finding:

1. **Construct a concrete input that triggers it.** Actual values, not "if the list were empty". If you cannot construct one, ask why — usually a caller guarantees an invariant you didn't check. Go read the callers.
2. **Re-read the surrounding code for the guard you missed.** Validation frequently lives one layer up, in a decorator, in a base class, or in middleware.
3. **Confirm it's a bug, not a preference.** Different-from-how-you'd-write-it is not a finding. Neither is style, naming, or architecture, unless the user asked.
4. **Run it if you can.** Running is optional, but it's the strongest evidence available and it's usually cheap. A tiny script that calls the function with the triggering input, or the existing test suite, converts "Likely" into "Confirmed". If dependencies are missing or the code can't run in isolation, don't fight it — reason it through instead and mark confidence honestly.

Anything that survives all four goes in the report. Anything that doesn't, drop it — or, if it's genuinely uncertain and genuinely important, keep it and label the confidence.

## Severity and confidence

**Severity** — what happens if this ships:

| Level | Meaning |
|---|---|
| Critical | Data loss or corruption, security exposure, or a crash on a common path |
| High | Wrong results or broken behavior for realistic inputs |
| Medium | Fails on edge cases, degrades under load, or handles errors badly enough to obscure failures |
| Low | Latent risk with no current trigger — unguarded assumption, missing validation reachable only by future callers |

**Confidence** — how sure you are:

- **Confirmed** — ran it, or traced it end to end with concrete values
- **Likely** — traced it, but couldn't verify by execution
- **Possible** — depends on an assumption about intent or an unread part of the system; say which

Order the report by severity, then confidence. Anything below Low is a nit — if it's worth mentioning at all, it goes in the nits section at the bottom, never in the main findings.

## The report

Create a folder called `claudeskill_reports` at the repository root, then within it a subfolder named for this skill — `claudeskill_reports/pr-review/`. Create both if they don't exist, and add `claudeskill_reports/` to `.gitignore` if it isn't already there.

Write to `claudeskill_reports/pr-review/review-YYYY-MM-DD-<scope>.md`, where `<scope>` is a short slug for what was reviewed (`auth-refactor`, `parser`, `staged-changes`). If a report with that name exists, append `-2`, `-3`, and so on rather than overwriting.

Use this structure:

```markdown
# PR review: <scope>
<date> · <N files, M lines reviewed> · <ran the code / traced only>

## Summary

- 🔴 **Critical** — [one line] · `file.py:42`
- 🟠 **High** — [one line] · `file.py:88`
- 🟡 **Medium** — [one line] · `other.py:12`
- ⚪ **Low** — [one line] · `other.py:30`

<One or two sentences on overall state. Say plainly whether this looks
ready to PR. If nothing was found, say that clearly and say what you
checked so the author knows the review had teeth.>

---

## 🔴 Critical — <short title>

**Where:** `path/to/file.py:42-47`

**Expected:** <what the contract says should happen>
**Actual:** <what the code does>

**Trace:**
<How you got there. Name the concrete values. Something like: with
`items=[]`, line 42 evaluates `len(items) - 1` to `-1`, so the loop at
line 44 never runs, and line 47 returns `total` still at its initial
`None`, which the caller at `service.py:88` immediately adds to.>

**Reproduction:**
```python
process_batch([])  # returns None, caller raises TypeError
```

**Suggested patch:**
```diff
- for i in range(len(items) - 1):
+ for i in range(len(items)):
```
<One line on why this fix and not another, if there's a real choice.>

**Confidence:** Confirmed — ran it

---

<...one section per finding, in severity order...>

## Nits

Not bugs, listed for completeness:

- `file.py:15` — unused import
- `file.py:60` — `data` shadows the module-level name

## What I checked and didn't flag

<Brief — the paths traced and areas verified clean. This tells the
author what the review actually covered and where their own attention
is still needed.>
```

Keep every part of that structure. The summary exists to be skimmed in ten seconds; the sections exist to be read when the author decides a finding is worth their time. Both matter — don't collapse one into the other.

**On patches:** suggest the fix inline as a diff, and keep it minimal — the smallest change that closes the bug. Don't refactor in a patch, and don't apply it to the user's files. They review, they decide, they edit. If a fix has a real design tradeoff, name the alternatives in one line rather than picking silently.

## After writing

Tell the user the path, then give the headline in two or three sentences: how many findings, the worst one, and whether you'd open the PR. Don't restate the report in chat — they have the file. The report should contain both the findings and suggested fixes. Create a folder called `claudeskill_reports` in the root directory, then within it create a subfolder with the skill name — `claudeskill_reports/pr-review/` — and write the report markdown file there. Also add `claudeskill_reports/` into .gitignore if not already, so it won't be accidentally pushed to github. Write the file report and save it to the folder first, then ask user if they want to make the change. You do not need to ask permission to create the folders, but let the user know the file has been created and its name.