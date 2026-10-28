"""Maintain one developer-reviewed discovery PR; never push to main.

Run from a main checkout. Only CSV/JSON data is read from the proposal branch;
all code runs from this checkout. Without --publish, no remote changes occur.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path

import discover_boards
from workit_scraper.catalog import add_boards, load_boards
from workit_scraper.discovery_review import reconcile, render_review

PREFIX = "codex/board-discovery-"
CATALOG = "scraper/boards.csv"
LEDGER = "scraper/discovery-review.json"
REVIEW = "scraper/discovery-review.md"
FILES = (CATALOG, LEDGER, REVIEW)


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


def assert_data_only(root: Path) -> None:
    changed = set(git(root, "diff", "--name-only", "origin/main...HEAD").splitlines())
    if changed - set(FILES):
        raise ValueError("Discovery branch contains non-review changes; resolve them manually")
    if any((root / name).is_symlink() for name in FILES):
        raise ValueError("Review files must be regular files, not symbolic links")


def read_ledger(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def write_update(worktree: Path, base_content: bytes, update) -> None:
    # Retain main's exact comments, names, and rows; reviewer edits to added rows
    # survive through reconciliation. No existing main row is removed.
    (worktree / CATALOG).write_bytes(base_content)
    add_boards(worktree / CATALOG, update.boards)
    (worktree / LEDGER).write_text(
        json.dumps(update.ledger, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def publish(root: Path, worktree: Path, repository: str, branch: str, pr: dict | None) -> None:
    # A reviewer may have changed the PR during slow network reads.
    latest = current_pr(pull_requests(root, repository))
    if (latest or {}).get("number") != (pr or {}).get("number"):
        raise ValueError("Discovery PR changed during this run; retry with its latest state")
    if pr and latest["head"]["sha"] != pr["head"]["sha"]:
        raise ValueError("A reviewer updated the branch; retry without overwriting")
    git(worktree, "add", "--", *FILES)
    staged = git(worktree, "diff", "--cached", "--name-only")
    if not staged:
        print("No new review changes")
        return
    if set(staged.splitlines()) - set(FILES):
        raise ValueError("Refusing to publish changes outside the discovery review files")
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
    git(worktree, "push", "origin", f"HEAD:refs/heads/{branch}")
    if pr:
        print(f"Updated {pr['html_url']}")
        return
    body = worktree / "discovery-pr-body.txt"
    body.write_text(
        "These are proposed boards, not verified company identities. Nothing is added to "
        "the live catalog until this PR is reviewed and merged.\n\n"
        f"[Review evidence and instructions](https://github.com/{repository}/blob/{branch}/{REVIEW})"
        "\n\nCheck the company association using its official website. Remove uncertain rows "
        "from scraper/boards.csv or mark their ledger decision rejected; subsequent runs "
        "preserve those decisions. Merge the ledger even when rejecting every candidate. "
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
    pr = current_pr(pull_requests(root, repository))
    git(root, "fetch", "origin", "main")
    if publishing and git(root, "rev-parse", "HEAD") != git(root, "rev-parse", "origin/main"):
        raise ValueError("Main moved or this is not its checkout; retry from current main")
    branch = pr["head"]["ref"] if pr else PREFIX + uuid.uuid4().hex[:12]
    if not re.fullmatch(r"codex/board-discovery-[A-Za-z0-9_-]+", branch):
        raise ValueError("Invalid discovery branch name")
    start = "origin/main"
    if pr:
        git(root, "fetch", "origin", branch)
        start = "FETCH_HEAD"
        if git(root, "rev-parse", start) != pr["head"]["sha"]:
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
            now = datetime.now(UTC)
            prior = reconcile(
                base,
                load_boards(worktree / CATALOG),
                read_ledger(worktree / LEDGER),
                {"candidates": [], "generated_at": now.isoformat()},
            )
            write_update(worktree, base_content, prior)
            result = discover_boards.main(
                [
                    "--channel",
                    "curated",
                    "--channel",
                    "hn",
                    "--months",
                    "1",
                    "--limit",
                    "20",
                    "--offset",
                    str(now.date().toordinal() * 20),
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
            if not pr and not update.added and update.ledger == read_ledger(root / LEDGER):
                print("No new candidates for review")
                return result
            write_update(worktree, base_content, update)
            (worktree / REVIEW).write_text(render_review(update, base), encoding="utf-8")
            if publishing:
                publish(root, worktree, repository, branch, pr)
            else:
                print(f"Preview: {update.added} new proposals; no PR published")
            return result
        finally:
            git(root, "worktree", "remove", "--force", str(worktree))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    return run(
        Path(__file__).resolve().parent.parent,
        os.environ.get("GITHUB_REPOSITORY", ""),
        publishing=args.publish,
    )


if __name__ == "__main__":
    raise SystemExit(main())
