"""Discover new boards and commit them directly to main.

Run from a main checkout. Without --publish, no remote changes occur.
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

CATALOG = "scraper/boards.csv"
LEDGER = "scraper/discovery-review.json"
REVIEW = "scraper/discovery-review.md"
FILES = (CATALOG, LEDGER, REVIEW)
#: open-jobs pool boards read per day: ~15,700 boards, so one pass in about 16
#: days, and a pool board without an early-career posting is asked again then.
#: The 2026-10-29 sample read about 0.4 seconds a board, so ~7 minutes a run.
POOL_LIMIT = 1000


def command(args: list[str], cwd: Path) -> str:
    return subprocess.check_output(args, cwd=cwd, text=True, encoding="utf-8").strip()


def git(root: Path, *args: str) -> str:
    return command(["git", *args], root)


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


def publish(worktree: Path) -> None:
    git(worktree, "add", "--", *FILES)
    staged = git(worktree, "diff", "--cached", "--name-only")
    if set(staged.splitlines()) - set(FILES):
        raise ValueError("Refusing to publish changes outside the discovery review files")
    if not staged:
        return
    git(
        worktree,
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "commit",
        "-m",
        "chore(scraper): add discovered boards",
    )
    git(worktree, "push", "origin", "HEAD:refs/heads/main")


def run(root: Path, repository: str, *, publishing: bool = False) -> int:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("GITHUB_REPOSITORY must be an owner/repository name")
    git(root, "fetch", "origin", "main")
    if publishing and git(root, "rev-parse", "HEAD") != git(root, "rev-parse", "origin/main"):
        raise ValueError("Main moved or this is not its checkout; retry from current main")
    with tempfile.TemporaryDirectory(prefix="workit-discovery-") as folder:
        worktree = Path(folder) / "review"
        git(root, "worktree", "add", "--detach", str(worktree), "origin/main")
        try:
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
            # Write the ledger to the worktree so discover_boards reads it
            # via --exclude, even when main has no ledger yet.
            (worktree / LEDGER).write_text(
                json.dumps(main_ledger, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            now = datetime.now(UTC)
            result = discover_boards.main(
                [
                    "--channel",
                    "curated",
                    "--channel",
                    "hn",
                    "--channel",
                    "openjobs",
                    "--months",
                    "1",
                    "--limit",
                    "20",
                    "--offset",
                    str(now.date().toordinal() * 20),
                    "--pool-limit",
                    str(POOL_LIMIT),
                    "--pool-offset",
                    str(now.date().toordinal() * POOL_LIMIT),
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
            update = reconcile(base, base, main_ledger, report)
            validate_catalog(update.boards, update.ledger)
            if not update.added and update.ledger == main_ledger:
                print("No new candidates")
                return result
            write_update(worktree, base_content, update)
            (worktree / REVIEW).write_text(render_review(update, base), encoding="utf-8")
            if publishing:
                publish(worktree)
            else:
                print(f"Preview: {update.added} new boards; not published")
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
