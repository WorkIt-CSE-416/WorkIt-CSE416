"""
One fill report as a fix brief on disk (KAN-369 fix reports), for a coding
agent to work from:

    uv run python -m app.scripts.fill_report <report id> [--out DIR]
    uv run python -m app.scripts.fill_report --latest [--job-system greenhouse] [--out DIR]

writes DIR/fill-report-<id8>/ (default DIR: ./fill-reports, gitignored):
brief.md (app/services/fill_brief.py, docs/fill-reports.md), the form's HTML
with values out (fill-report-<id8>.html), question-set.json (the fields as
the engine's Question set) and report.json (the report as the API answers
it). It reads the database DATABASE_URL names, so run it against a local
copy or with the team's read access; it writes nothing to the database.

The engine commit: the report names the engine by version ("0.3.2+fcaaf20",
package.json's version and a hash of src/, fill-engine build.mjs). The script
hashes src/ at the engine checkout's recent commits (HEAD's history) the same way and names
the one that matches, when one does.
"""

import argparse
import asyncio
import hashlib
import json
import subprocess
import sys
import uuid
from pathlib import Path

from app.db import get_sessionmaker
from app.queries.fill_reports import get_report, list_reports
from app.routers.fill_reports import _detail
from app.services.fill_brief import fix_brief, fixture_name, question_set

ENGINE_CHECKOUT = Path(__file__).resolve().parents[3] / "autofiller_extension" / "fill-engine"
COMMITS_TRIED = 300


def _git(*args: str) -> bytes:
    return subprocess.run(["git", "-C", str(ENGINE_CHECKOUT), *args], check=True, capture_output=True).stdout


def engine_commit(version: str) -> str | None:
    """The engine commit whose src/ build.mjs would name `version`, among the checkout's last COMMITS_TRIED; None if none."""
    package, _, digest = version.partition("+")
    if not digest:
        return None
    try:
        commits = _git("rev-list", f"--max-count={COMMITS_TRIED}", "HEAD").decode().split()
        for commit in commits:
            if json.loads(_git("show", f"{commit}:package.json")).get("version") != package:
                continue
            files = sorted(p for p in _git("ls-tree", "-r", "--name-only", commit, "src/").decode().splitlines() if p.endswith(".ts"))
            hash_ = hashlib.sha256()
            for path in files:
                hash_.update(path.removeprefix("src/").encode() + b"\0")
                hash_.update(_git("show", f"{commit}:{path}"))
                hash_.update(b"\0")
            if hash_.hexdigest().startswith(digest):
                return commit[:12]
    except (subprocess.CalledProcessError, FileNotFoundError, json.JSONDecodeError):
        return None
    return None


def write_brief(report: dict, out: Path, commit: str | None) -> Path:
    """Writes the brief's folder for `report` (the API's JSON) under `out`; answers the folder."""
    short = str(report["id"])[:8]
    folder = out / f"fill-report-{short}"
    folder.mkdir(parents=True, exist_ok=True)
    fixture = fixture_name(str(report["id"]))
    (folder / "brief.md").write_text(fix_brief(report, engine_commit=commit, fixture_path=fixture))
    if report.get("html"):
        (folder / fixture).write_text(report["html"])
    (folder / "question-set.json").write_text(question_set(report))
    (folder / "report.json").write_text(json.dumps(report, indent=1, default=str) + "\n")
    return folder


async def _load(report_id: uuid.UUID | None, job_system: str | None) -> dict | None:
    async with get_sessionmaker()() as db:
        if report_id is None:
            rows, _ = await list_reports(db, job_system=job_system, limit=1)
            if not rows:
                return None
            report_id = rows[0].id
        row = await get_report(db, report_id)
        return None if row is None else _detail(row).model_dump(mode="json")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write a fill report's fix brief and fixture to a folder.")
    parser.add_argument("report_id", nargs="?", type=uuid.UUID)
    parser.add_argument("--latest", action="store_true", help="the newest report (with --job-system, of that job system)")
    parser.add_argument("--job-system")
    parser.add_argument("--out", type=Path, default=Path("fill-reports"))
    args = parser.parse_args(argv)
    if not args.report_id and not args.latest:
        parser.error("give a report id or --latest")
    report = asyncio.run(_load(args.report_id, args.job_system))
    if report is None:
        print("No such report.", file=sys.stderr)
        return 1
    folder = write_brief(report, args.out, engine_commit(report["engine_version"]))
    print(folder / "brief.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
