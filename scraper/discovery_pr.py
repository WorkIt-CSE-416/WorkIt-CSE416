"""Maintain one developer-reviewed discovery PR; never push to main.

Run from a main checkout. Only CSV/JSON data is read from the proposal branch;
all code runs from this checkout. Without --publish, no remote changes occur.
Every source goes through the PR, the open-jobs pool included: there a person
checks the sampled boards the review page marks (docs/adr/0007).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import discover_boards
from workit_scraper.catalog import add_boards, load_boards
from workit_scraper.discovery_review import reconcile, render_review, validate_catalog

PREFIX = "codex/board-discovery-"
CATALOG = "scraper/boards.csv"
LEDGER = "scraper/discovery-review.json"
REVIEW = "scraper/discovery-review.md"
#: Where careers-page resolution resumes (`discover_boards --resolve-offset`).
#: It rides on the proposal branch with the other review files and reaches main
#: when the PR merges.
RESOLUTION_STATE = "scraper/discovery-resolution.json"
FILES = (CATALOG, LEDGER, REVIEW, RESOLUTION_STATE)
#: Days in one pass of the open-jobs pool: each day reads the boards whose key
#: hashes to it (`discover_boards.on_day`), and a pool board without an
#: early-career posting is asked again a pass later.
POOL_DAYS = 16
#: A guard on a run's time, never meant to bite: the 15,532 pool boards of
#: 2026-11-01 come to 930 to 1,005 a day, and one a day past it would wait a
#: whole pass. At the 2026-10-29 sample's 0.4 seconds a board, ~8 minutes a run.
POOL_LIMIT = 1200


def command(args: list[str], cwd: Path) -> str:
    return subprocess.check_output(args, cwd=cwd, text=True, encoding="utf-8").strip()


def git(root: Path, *args: str) -> str:
    return command(["git", *args], root)


def pull_requests(root: Path, repository: str) -> list[dict]:
    pages = json.loads(
        command(
            [
                "gh",
                "api",
                "--paginate",
                "--slurp",
                f"repos/{repository}/pulls?state=all&base=main&per_page=100",
            ],
            root,
        )
    )
    return [
        pr
        for page in pages
        for pr in page
        if pr["head"]["ref"].startswith(PREFIX)
        and (pr["head"].get("repo") or {}).get("full_name") == repository
    ]


def current_pr(prs: list[dict]) -> dict | None:
    opened = [pr for pr in prs if pr["state"] == "open"]
    if len(opened) > 1:
        raise ValueError("Multiple discovery PRs are open; consolidate them before running again")
    if opened:
        return opened[0]
    latest = max(prs, key=lambda pr: pr["number"], default=None)
    if latest and not latest.get("merged_at"):
        raise ValueError("Last discovery PR was closed without merging; reopen it to resume review")
    return None


def next_branch(prs: list[dict]) -> str:
    """Stable until this cycle has a PR, including a failed PR-creation attempt."""
    return PREFIX + "after-" + str(max((pr["number"] for pr in prs), default=0))


def assert_data_only(root: Path) -> None:
    changed = set(git(root, "diff", "--name-only", "origin/main...HEAD").splitlines())
    if changed - set(FILES):
        raise ValueError("Discovery branch contains non-review changes; resolve them manually")
    if any((root / name).is_symlink() for name in FILES):
        raise ValueError("Review files must be regular files, not symbolic links")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def write_update(worktree: Path, base_content: bytes, update) -> None:
    # Retain main's exact comments, names, and rows; reviewer edits to added rows
    # survive through reconciliation. No existing main row is removed.
    (worktree / CATALOG).write_bytes(base_content)
    add_boards(worktree / CATALOG, update.boards)
    (worktree / LEDGER).write_text(
        json.dumps(update.ledger, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def publish(
    root: Path,
    worktree: Path,
    repository: str,
    branch: str,
    pr: dict | None,
    *,
    proposes: bool = True,
) -> None:
    """Push the review files to the proposal branch, and open its PR when there is
    something to review. With only the resolution cursor moved (`proposes` False)
    the branch keeps the cursor and no PR opens: an empty review is noise, and a
    cursor left behind would resolve the same careers pages every day."""
    # A reviewer may have changed the PR during slow network reads.
    latest_prs = pull_requests(root, repository)
    latest = current_pr(latest_prs)
    if (latest or {}).get("number") != (pr or {}).get("number"):
        raise ValueError("Discovery PR changed during this run; retry with its latest state")
    if pr and latest["head"]["sha"] != pr["head"]["sha"]:
        raise ValueError("A reviewer updated the branch; retry without overwriting")
    if not pr and branch != next_branch(latest_prs):
        raise ValueError("Discovery review cycle changed during this run; retry")
    git(worktree, "add", "--", *FILES)
    staged = git(worktree, "diff", "--cached", "--name-only")
    if set(staged.splitlines()) - set(FILES):
        raise ValueError("Refusing to publish changes outside the discovery review files")
    if staged:
        git(
            worktree,
            "-c",
            "user.name=github-actions[bot]",
            "-c",
            "user.email=41898282+github-actions[bot]@users.noreply.github.com",
            "commit",
            "-m",
            "chore(scraper): propose discovered boards for review",
        )
    # An orphan branch may already contain this exact proposal. A normal push
    # protects against concurrent edits, then PR creation can be retried even
    # when no files changed. This also publishes a main-only merge commit.
    git(worktree, "push", "origin", f"HEAD:refs/heads/{branch}")
    if pr:
        print(f"Updated {pr['html_url']}")
        return
    if not proposes:
        print(f"Saved the resolution cursor on {branch}; nothing to review yet")
        return
    body = worktree / "discovery-pr-body.txt"
    body.write_text(
        "These are proposed boards, not verified company identities. Nothing is added to "
        "the live catalog until this PR is reviewed and merged.\n\n"
        f"[Review evidence and instructions](https://github.com/{repository}/blob/{branch}/{REVIEW})"
        "\n\nCheck the company association using its official website. Remove uncertain rows "
        "from scraper/boards.csv before merging; subsequent runs preserve those decisions. "
        "Marking only the ledger decision rejected requests removal by the next bot run; "
        "the rejected CSV row must be gone before merging. "
        "Merge the ledger even when rejecting every candidate. "
        "Closing this PR without merging pauses discovery proposals.\n\n"
        "Daily runs append new candidates here. Review all additions before merging; "
        "GitHub's approval dismissal settings still apply to new commits.\n",
        encoding="utf-8",
    )
    print(
        command(
            [
                "gh",
                "pr",
                "create",
                "--repo",
                repository,
                "--base",
                "main",
                "--head",
                branch,
                "--title",
                "Review discovered company job boards",
                "--body-file",
                str(body),
            ],
            root,
        )
    )


def run(root: Path, repository: str, *, publishing: bool = False) -> int:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("GITHUB_REPOSITORY must be an owner/repository name")
    prs = pull_requests(root, repository)
    pr = current_pr(prs)
    git(root, "fetch", "origin", "main")
    if publishing and git(root, "rev-parse", "HEAD") != git(root, "rev-parse", "origin/main"):
        raise ValueError("Main moved or this is not its checkout; retry from current main")
    branch = pr["head"]["ref"] if pr else next_branch(prs)
    if not re.fullmatch(r"codex/board-discovery-[A-Za-z0-9_-]+", branch):
        raise ValueError("Invalid discovery branch name")
    start = "origin/main"
    remote = git(root, "ls-remote", "--heads", "origin", f"refs/heads/{branch}")
    if pr and not remote:
        raise ValueError("Discovery PR branch is missing; restore it before running again")
    if remote:
        expected_head = pr["head"]["sha"] if pr else remote.split()[0]
        git(root, "fetch", "origin", branch)
        start = "FETCH_HEAD"
        if git(root, "rev-parse", start) != expected_head:
            raise ValueError("Discovery branch changed while selecting it; retry")
    with tempfile.TemporaryDirectory(prefix="workit-discovery-") as folder:
        worktree = Path(folder) / "review"
        git(root, "worktree", "add", "--detach", str(worktree), start)
        try:
            assert_data_only(worktree)
            git(
                worktree,
                "-c",
                "user.name=github-actions[bot]",
                "-c",
                "user.email=41898282+github-actions[bot]@users.noreply.github.com",
                "merge",
                "--no-edit",
                "origin/main",
            )
            base_content = subprocess.check_output(
                ["git", "show", f"origin/main:{CATALOG}"], cwd=root
            )
            base_path = Path(folder) / "base.csv"
            base_path.write_bytes(base_content)
            base = load_boards(base_path)
            main_ledger = (
                json.loads(git(root, "show", f"origin/main:{LEDGER}"))
                if git(root, "ls-tree", "--name-only", "origin/main", "--", LEDGER)
                else {}
            )
            validate_catalog(base, main_ledger)
            now = datetime.now(UTC)
            prior = reconcile(
                base,
                load_boards(worktree / CATALOG),
                read_json(worktree / LEDGER),
                {"candidates": [], "generated_at": now.isoformat()},
            )
            write_update(worktree, base_content, prior)
            resolution_path = worktree / RESOLUTION_STATE
            resolution_state = read_json(resolution_path)
            if not isinstance(resolution_state, dict):
                raise ValueError("resolution state must be an object")
            resolution_offset = resolution_state.get("next_offset", 0)
            if type(resolution_offset) is not int or resolution_offset < 0:
                raise ValueError("resolution next_offset must be a nonnegative integer")
            result = discover_boards.main(
                [
                    "--channel",
                    "curated",
                    "--channel",
                    "hn",
                    "--channel",
                    "openjobs",
                    "--resolve",
                    "--resolve-limit",
                    str(discover_boards.RESOLVE_LIMIT),
                    "--resolve-seconds",
                    str(discover_boards.RESOLVE_SECONDS),
                    "--resolve-offset",
                    str(resolution_offset),
                    "--months",
                    "1",
                    "--limit",
                    "20",
                    "--offset",
                    str(now.date().toordinal() * 20),
                    "--pool-limit",
                    str(POOL_LIMIT),
                    "--pool-days",
                    str(POOL_DAYS),
                    "--pool-day",
                    str(now.date().toordinal()),
                    "--boards",
                    str(worktree / CATALOG),
                    "--exclude",
                    str(worktree / LEDGER),
                    "--report",
                    str(root / "scraper/discovery-report.json"),
                ]
            )
            report = json.loads(
                (root / "scraper/discovery-report.json").read_text(encoding="utf-8")
            )
            update = reconcile(base, prior.boards, prior.ledger, report)
            validate_catalog(update.boards, update.ledger)
            next_resolution_state = resolution_state
            if report.get("resolution") is not None:
                next_offset = report["resolution"]["next_offset"]
                if type(next_offset) is not int or next_offset < 0:
                    raise ValueError("reported resolution next_offset must be nonnegative")
                next_resolution_state = {"next_offset": next_offset}
            proposes = bool(update.added) or update.ledger != main_ledger
            if not pr and not proposes and next_resolution_state == resolution_state:
                print("No new candidates for review")
                return result
            write_update(worktree, base_content, update)
            (worktree / REVIEW).write_text(render_review(update, base), encoding="utf-8")
            resolution_path.write_text(
                json.dumps(next_resolution_state, indent=2) + "\n", encoding="utf-8"
            )
            if publishing:
                publish(root, worktree, repository, branch, pr, proposes=proposes)
            else:
                print(f"Preview: {update.added} new proposals; no PR published")
            return result
        finally:
            git(root, "worktree", "remove", "--force", str(worktree))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument(
        "--repo", help="GitHub owner/repository; defaults to this checkout's remote"
    )
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parent.parent
    repository = (
        args.repo
        or os.environ.get("GITHUB_REPOSITORY")
        or command(
            ["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], root
        )
    )
    return run(
        root,
        repository,
        publishing=args.publish,
    )


if __name__ == "__main__":
    raise SystemExit(main())
