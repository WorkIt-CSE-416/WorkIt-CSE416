"""Discover and validate company boards on demand; preview by default.

python discover_boards.py --channel hn --limit 20
python discover_boards.py --channel ddg --query 'site:jobs.ashbyhq.com fintech'
python discover_boards.py --url https://jobs.ashbyhq.com/acme --company Acme --apply
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from workit_scraper import shortlist, web
from workit_scraper.board_read import ReadStatus, read_board, reported_name
from workit_scraper.board_resolve import (
    GH_JID,
    ICIMS_HERE,
    SHORTENER,
    greenhouse_board,
    icims_board,
    unshortened,
)
from workit_scraper.catalog import BOARDS_CSV, add_boards, load_boards, same_file
from workit_scraper.discovery_channels import (
    CHANNELS,
    OPEN_JOBS,
    DiscoveryError,
    Evidence,
    SourceFailure,
    collect,
    validate_options,
)
from workit_scraper.polite import Robots
from workit_scraper.providers import Board, Job, name_url
from workit_scraper.providers.urls import board_keys as board_keys


@dataclass
class Candidate:
    ats: str
    token: str
    companies: list[str] = field(default_factory=list)
    evidence: list[Evidence] = field(default_factory=list)
    status: str = "pending"
    postings: int | None = None
    #: A pool board's titles the shortlist keeps, the reason it is proposed.
    kept: list[str] = field(default_factory=list)


#: Kept titles recorded per pool board: enough for a reviewer to see why.
KEPT_SHOWN = 5


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


def _read(row: Candidate, board: Board, robots: Robots) -> list[Job] | None:
    """Read the board into `row`'s status and posting count; its jobs when complete."""
    result = read_board(board, robots)
    if result.status is ReadStatus.OK:
        row.status, row.postings = "validated", len(result.jobs)
        return result.jobs
    if result.status is ReadStatus.MISSING:
        row.status = "not_found"
    elif result.reason == "robots.txt":
        row.status = "robots_disallowed"
    else:
        row.status = f"unread:{result.reason}"
    return None


def validate(row: Candidate, robots: Robots) -> None:
    _read(row, Board(row.ats, row.token, row.companies[0]), robots)


def pooled(row: Candidate) -> bool:
    """An open-jobs pool board no other source named."""
    return not row.companies and any(item.source == OPEN_JOBS for item in row.evidence)


def validate_pooled(row: Candidate, robots: Robots) -> None:
    """A pool board is proposed only when it lists a posting the shortlist keeps,
    under the name its hiring system gives it (docs/adr/0007-trust-the-hiring-systems-name.md)."""
    board = Board(row.ats, row.token, row.token)
    jobs = _read(row, board, robots)
    if jobs is None:
        return
    row.kept = [role.title for role in shortlist.pick(jobs, is_new=lambda _: False)][:KEPT_SHOWN]
    if not row.kept:
        row.status = "no_early_career"
        return
    name = reported_name(board, robots)
    if name is None:
        row.status = "needs_company"
        return
    row.companies = [name]
    row.evidence.append(Evidence(row.evidence[0].url, name, name_url(row.ats, row.token)))


def rotated(rows: list[Candidate], offset: int) -> list[Candidate]:
    if not rows:
        return rows
    offset %= len(rows)
    return rows[offset:] + rows[:offset]


def positive(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def nonnegative(value: str) -> int:
    number = int(value)
    if number < 0:
        raise argparse.ArgumentTypeError("must be nonnegative")
    return number


def resolve_evidence(
    evidence: list[Evidence],
    robots: Robots,
    get: Callable[[str], bytes],
) -> list[Evidence]:
    """Resolve unmatched evidence URLs and return new Evidence for any boards found.

    Short links are followed to their destination, then ``board_keys`` extracts
    the board.  Career pages with ``?gh_jid=`` or ``icims`` are proved against
    the ATS API.  Each resolved board becomes an Evidence whose URL
    ``board_keys`` recognises, entering the normal pipeline.
    """
    unmatched = [e for e in evidence if not board_keys(e.url)]
    resolved: list[Evidence] = []

    # --- short links --------------------------------------------------------
    short = [e for e in unmatched if SHORTENER.search(e.url)]
    with ThreadPoolExecutor(8) as pool:
        targets = list(pool.map(lambda e: unshortened(e.url, robots, get), short))
    remaining: list[Evidence] = []
    for ev, target in zip(short, targets, strict=True):
        if not target:
            continue
        keys = board_keys(target)
        if keys:
            resolved.append(Evidence(target, ev.company, ev.source))
        else:
            # Destination is not a known board URL; check as a careers page.
            remaining.append(Evidence(target, ev.company, ev.source))
    short_boards = len(resolved)
    print(
        f"resolve: {len(short)} short links,"
        f" {sum(1 for t in targets if t)} led somewhere,"
        f" {short_boards} boards"
    )

    # Careers pages: original unmatched (minus short links) plus unshortened
    # destinations that still didn't match.
    careers = [e for e in unmatched if not SHORTENER.search(e.url)] + remaining

    # --- Greenhouse behind a company's site ---------------------------------
    gh_count, gh_proved = 0, 0
    for ev in careers:
        if not GH_JID.search(ev.url):
            continue
        gh_count += 1
        token = greenhouse_board(ev.url, ev.company, robots, get)
        if token:
            gh_proved += 1
            resolved.append(
                Evidence(f"https://job-boards.greenhouse.io/{token}", ev.company, ev.source)
            )
    if gh_count:
        print(f"resolve: greenhouse behind a company's site: {gh_count} tried, {gh_proved} proved")

    # --- iCIMS behind a company's site --------------------------------------
    ic_count, ic_proved = 0, 0
    for ev in careers:
        if not ICIMS_HERE.search(ev.url) or GH_JID.search(ev.url):
            continue
        ic_count += 1
        token = icims_board(ev.url, ev.company, robots, get)
        if token:
            ic_proved += 1
            url = f"https://{token}.icims.com/jobs/1/job"
            resolved.append(Evidence(url, ev.company, ev.source))
    if ic_count:
        print(f"resolve: icims behind a company's site: {ic_count} tried, {ic_proved} proved")

    return resolved


def rejected_boards(path: Path | None) -> set[str]:
    """Only explicit review rejections exclude candidates from validation."""
    if path is None:
        return set()
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("review decisions must be an object keyed by ATS/board token")
    rejected = set()
    for key, row in data.items():
        if not isinstance(key, str) or "/" not in key or not all(key.split("/", 1)):
            raise ValueError("review decision keys must contain ATS/board token")
        if not isinstance(row, dict) or row.get("decision") not in ("proposed", "rejected"):
            raise ValueError("each review decision must be proposed or rejected")
        if row["decision"] == "rejected":
            rejected.add(key)
    return rejected


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
    parser.add_argument(
        "--offset",
        type=nonnegative,
        default=0,
        help="rotate eligible candidates before applying the validation limit",
    )
    parser.add_argument(
        "--pool-limit",
        type=nonnegative,
        default=0,
        help="maximum open-jobs pool boards to read (--channel openjobs)",
    )
    parser.add_argument(
        "--pool-offset",
        type=nonnegative,
        default=0,
        help="rotate the pool before applying --pool-limit",
    )
    parser.add_argument(
        "--exclude", type=Path, help="review ledger; rejected boards are skipped before validation"
    )
    parser.add_argument("--boards", type=Path, default=BOARDS_CSV)
    parser.add_argument("--report", type=Path, default=Path("discovery-report.json"))
    parser.add_argument(
        "--resolve",
        action="store_true",
        help="resolve short links and careers pages (Greenhouse ?gh_jid=, iCIMS)"
        " before extracting candidates",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="add validated boards locally; review company ownership before committing",
    )
    args = parser.parse_args(argv)
    if not args.channel and not args.url:
        parser.error("select --channel or provide --url and --company")
    if bool(args.url) != bool(args.company.strip()):
        parser.error("--url and --company must be supplied together")
    if same_file(args.boards, args.report):
        parser.error("--report must not identify the --boards catalog")
    if args.exclude and (
        same_file(args.exclude, args.boards) or same_file(args.exclude, args.report)
    ):
        parser.error("--exclude must differ from --boards and --report")
    try:
        rejected = rejected_boards(args.exclude)
    except (OSError, ValueError) as error:
        parser.error(f"cannot load review decisions: {error}")
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
    if args.resolve:

        def resolve_get(url: str) -> bytes:
            return web.get(url, timeout=30)

        evidence.extend(resolve_evidence(evidence, robots, resolve_get))
    rows = candidates(evidence)
    known = {(b.ats, b.token) for b in load_boards(args.boards)} if args.boards.exists() else set()
    eligible, pool = [], []
    for row in rows:
        if (row.ats, row.token) in known:
            row.status = "already_known"
        elif f"{row.ats}/{row.token}" in rejected:
            row.status = "rejected"
        elif pooled(row):
            row.status = "deferred"
            pool.append(row)
        elif len(row.companies) != 1:
            row.status = "needs_company" if not row.companies else "conflicting_companies"
        else:
            row.status = "deferred"
            eligible.append(row)
    for row in rotated(eligible, args.offset)[: args.limit]:
        validate(row, robots)
        print(f"{row.ats}/{row.token}: {row.status}")
    # Most pool boards list no early-career posting, so only proposals are printed.
    for row in rotated(pool, args.pool_offset)[: args.pool_limit]:
        validate_pooled(row, robots)
        if row.status == "validated":
            print(f"{row.ats}/{row.token}: pool, named {row.companies[0]!r}")
    print(
        "Boards: "
        + ", ".join(
            f"{status} {count}" for status, count in sorted(Counter(r.status for r in rows).items())
        )
    )
    report = {
        "generated_at": datetime.now(UTC).isoformat(),
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
