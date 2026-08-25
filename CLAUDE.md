# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This repository is **empty of application code**. As of the current commit it contains only:

- `README.md` — "WorkIt-CSE416 / CSE 416 Final Project Group"
- `.claude/skills/pr-review/` — a project-local skill (see below)

There is no source tree, no package manifest, no build system, no test runner, and no CI configuration. Nothing about the eventual architecture, language, or framework can be inferred from what is committed. Do not assume a stack — ask, or read the code once it exists.

**When real code lands, this file should be rewritten** with the actual build/lint/test commands and an architecture overview. Until then, treating this document as a description of the project would be misleading.

## Commands

None. There is nothing to build, lint, or test.

Git conventions observable so far: work happens on Jira-style branches (`KAN-13-testing`) off `main`.

## Project-local skill

`.claude/skills/pr-review/SKILL.md` defines a `pr-review` skill used for pre-PR review and bug hunting. Its notable conventions, which apply to review work in this repo:

- Output is a severity-ranked **markdown report written to `claudeskill_reports/pr-review/`** — not a chat summary, and not edits to the author's code. The author decides what to act on.
- Reviews must first reconstruct *intended* behavior (from tests, callers, docstrings, schemas) before looking for defects — never review code against itself.
- Findings are cut aggressively; a handful that survive scrutiny beat twenty speculative ones.
- If the code cannot be run, trace its logic directly rather than skipping the path.
