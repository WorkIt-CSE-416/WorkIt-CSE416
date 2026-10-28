"""Discover and validate company boards on demand; preview by default.

python discover_boards.py --channel hn --limit 20
python discover_boards.py --channel ddg --query 'site:jobs.ashbyhq.com fintech'
python discover_boards.py --url https://jobs.ashbyhq.com/acme --company Acme --apply
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path

from workit_scraper import web
from workit_scraper.board_read import ReadStatus, read_board
from workit_scraper.catalog import BOARDS_CSV, add_boards, load_boards, same_file
from workit_scraper.discovery_channels import (
    CHANNELS,
    DiscoveryError,
    Evidence,
    SourceFailure,
    collect,
    validate_options,
)
from workit_scraper.polite import Robots
from workit_scraper.providers import Board
from workit_scraper.providers.urls import board_keys as board_keys


@dataclass
class Candidate:
    ats: str
    token: str
    companies: list[str] = field(default_factory=list)
    evidence: list[Evidence] = field(default_factory=list)
    status: str = "pending"
    postings: int | None = None


def candidates(evidence: list[Evidence]) -> list[Candidate]:
    found: dict[tuple[str, str], Candidate] = {}
    for item in evidence:
        for ats, token in board_keys(item.url):
            row = found.setdefault((ats, token), Candidate(ats, token))
            name = item.company.strip()
            if name and name not in row.companies:
                row.companies.append(name)
            if item not in row.evidence:
                row.evidence.append(item)
    return list(found.values())


def validate(row: Candidate, robots: Robots) -> None:
    result = read_board(Board(row.ats, row.token, row.companies[0]), robots)
    if result.status is ReadStatus.OK:
        row.status, row.postings = "validated", len(result.jobs)
    elif result.status is ReadStatus.MISSING:
        row.status = "not_found"
    elif result.reason == "robots.txt":
        row.status = "robots_disallowed"
    else:
        row.status = f"unread:{result.reason}"


def positive(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--channel", action="append", choices=tuple(CHANNELS))
    parser.add_argument("--query", default="")
    parser.add_argument("--url", help="a known company's ATS board or posting URL")
    parser.add_argument("--company", default="", help="company attributed to --url")
    parser.add_argument(
        "--limit",
        type=positive,
        default=20,
        help="maximum new boards to validate, and results per channel",
    )
    parser.add_argument("--months", type=positive, default=3)
    parser.add_argument("--boards", type=Path, default=BOARDS_CSV)
    parser.add_argument("--report", type=Path, default=Path("discovery-report.json"))
    parser.add_argument("--apply", action="store_true", help="add validated, named boards")
    args = parser.parse_args(argv)
    if not args.channel and not args.url:
        parser.error("select --channel or provide --url and --company")
    if bool(args.url) != bool(args.company.strip()):
        parser.error("--url and --company must be supplied together")
    if same_file(args.boards, args.report):
        parser.error("--report must not identify the --boards catalog")
    try:
        for channel in args.channel or ["curated"]:
            validate_options(channel, query=args.query, limit=args.limit, months=args.months)
    except DiscoveryError as error:
        parser.error(str(error))
    robots = Robots()

    def read(url: str, *, headers: dict[str, str] | None = None) -> bytes:
        if not robots.allows(url):
            raise PermissionError("robots.txt disallows this discovery request")
        robots.pace(url)
        return web.get(url, timeout=30, headers=headers)

    evidence = [Evidence(args.url, args.company.strip(), "manual")] if args.url else []
    failures = []
    for channel in dict.fromkeys(args.channel or []):
        try:
            result = collect(channel, read, query=args.query, limit=args.limit, months=args.months)
            evidence.extend(result.evidence)
            failures.extend(result.failures)
            print(f"{channel}: {len(result.evidence)} links")
        except Exception as error:
            detail = str(error) if isinstance(error, DiscoveryError) else type(error).__name__
            failures.append(SourceFailure(channel, channel, detail))
    for failure in failures:
        print(f"{failure.channel}: {failure.source}: {failure.error}")
    rows = candidates(evidence)
    known = {(b.ats, b.token) for b in load_boards(args.boards)} if args.boards.exists() else set()
    attempts = 0
    for row in rows:
        if (row.ats, row.token) in known:
            row.status = "already_known"
        elif len(row.companies) != 1:
            row.status = "needs_company" if not row.companies else "conflicting_companies"
        elif attempts >= args.limit:
            row.status = "deferred"
        else:
            validate(row, robots)
            attempts += 1
            print(f"{row.ats}/{row.token}: {row.status}")
    print(
        "Boards: "
        + ", ".join(
            f"{status} {count}" for status, count in sorted(Counter(r.status for r in rows).items())
        )
    )
    report = {
        "candidates": [asdict(r) for r in rows],
        "channel_failures": [asdict(f) for f in failures],
        "unmatched": [asdict(e) for e in evidence if not board_keys(e.url)],
    }
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    added = (
        add_boards(
            args.boards,
            (
                Board(row.ats, row.token, row.companies[0])
                for row in rows
                if row.status == "validated" and len(row.companies) == 1
            ),
        )
        if args.apply
        else 0
    )
    print(
        f"Report: {args.report}; {added} boards added"
        if args.apply
        else f"Preview: {args.report}; use --apply to add validated, named boards"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
