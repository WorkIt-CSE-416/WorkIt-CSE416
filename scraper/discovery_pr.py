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
            resolution_path = worktree / RESOLUTION_STATE
            resolution_state = read_json(resolution_path)
            if not isinstance(resolution_state, dict):
                raise ValueError("resolution state must be an object")
            resolution_offset = resolution_state.get("next_offset", 0)
            if type(resolution_offset) is not int or resolution_offset < 0:
                raise ValueError("resolution next_offset must be a nonnegative integer")
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
            update = reconcile(base, base, main_ledger, report)
            validate_catalog(update.boards, update.ledger)
            next_resolution_state = resolution_state
            if report.get("resolution") is not None:
                next_offset = report["resolution"]["next_offset"]
                if type(next_offset) is not int or next_offset < 0:
                    raise ValueError("reported resolution next_offset must be nonnegative")
                next_resolution_state = {"next_offset": next_offset}
            if (
                not update.added
                and update.ledger == main_ledger
                and next_resolution_state == resolution_state
            ):
                print("No new candidates")
                return result
            write_update(worktree, base_content, update)
            (worktree / REVIEW).write_text(render_review(update, base), encoding="utf-8")
            resolution_path.write_text(
                json.dumps(next_resolution_state, indent=2) + "\n", encoding="utf-8"
            )
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
