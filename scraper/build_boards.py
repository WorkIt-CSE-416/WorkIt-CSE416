"""Grow boards.csv from public curated internship lists.

    python3 build_boards.py              # add the boards the lists' apply links name
    python3 build_boards.py --resolve    # and those behind short links and careers pages

Those lists are maintained by people who add a company when it starts hiring interns,
which makes them a far better seed than an untargeted registry: about a quarter of
these boards yield an early-career software role, against roughly a twentieth of a
random ATS registry.

We take one fact from them -- which ATS board slug a company uses, read out of public
apply URLs -- and nothing else. Every board still has to answer the employer's own API
before it reaches the page, so this file is a list of candidates, never a list of
conclusions. The postings themselves are always scraped from the employer.

Boards are only ever added. A company drops off the curated lists once its roles
close, but it may post again next season, so a run keeps every board already in
boards.csv and adds what the lists name now. A board with nothing open costs one
request a run, and one that was deleted is reported "not found" by the scraper.

Sources, credited in the header this writes:
  github.com/SimplifyJobs/Summer2027-Internships
  github.com/SimplifyJobs/New-Grad-Positions
  github.com/vanshb03/Summer2027-Internships

The two internship lists are one repo each, renamed every season (both were
Summer2026 until 2026), and GitHub serves a renamed repo's files at its old
address too. So an old name keeps working, but name the current one.

A person runs this by hand and commits the diff; no workflow runs it. The
scheduled scrape ran it before every scrape from KAN-167 (2026-10-09) until
KAN-422 (2026-10-28), which replaced it with daily discovery (discovery_pr.py)
so that new boards are checked before they reach main. Since boards are only
added and nothing is written until every list has loaded, a failed download
leaves boards.csv as it was.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from urllib.parse import urlsplit

from workit_scraper import web
from workit_scraper.board_resolve import (
    GH_JID,
    ICIMS_HERE,
    SHORTENER,
    TRIES,
    _get,
    greenhouse_board,
    icims_board,
    unshortened,
)
from workit_scraper.catalog import BOARDS_CSV, load_boards, write_boards
from workit_scraper.discovery_sources import SOURCES
from workit_scraper.polite import Robots
from workit_scraper.providers import Board
from workit_scraper.providers.urls import board_keys as tokens

# Boards verified by hand to yield early-career software roles, kept because the
# curated lists miss some of them -- the quant firms especially.
EXTRA: list[Board] = [
    Board("greenhouse", "waymo", "Waymo"),
    Board("greenhouse", "jumptrading", "Jump Trading"),
    Board("greenhouse", "imc", "IMC Trading"),
    Board("greenhouse", "squarepointcapital", "Squarepoint Capital"),
    Board("greenhouse", "akunacapital", "Akuna Capital"),
    Board("greenhouse", "drweng", "DRW"),
    Board("greenhouse", "oldmissioncapital", "Old Mission Capital"),
    Board("greenhouse", "pdtpartners", "PDT Partners"),
    Board("greenhouse", "lyft", "Lyft"),
    Board("greenhouse", "verkada", "Verkada"),
    Board("greenhouse", "coinbase", "Coinbase"),
    Board("greenhouse", "roblox", "Roblox"),
    Board("greenhouse", "samsara", "Samsara"),
    Board("greenhouse", "nuro", "Nuro"),
    Board("greenhouse", "nebius", "Nebius"),
    Board("greenhouse", "stripe", "Stripe"),
    Board("greenhouse", "databricks", "Databricks"),
    Board("greenhouse", "figma", "Figma"),
    Board("greenhouse", "duolingo", "Duolingo"),
    Board("greenhouse", "robinhood", "Robinhood"),
    Board("greenhouse", "datadog", "Datadog"),
    Board("greenhouse", "scaleai", "Scale AI"),
    Board("greenhouse", "togetherai", "Together AI"),
    Board("ashby", "perplexity", "Perplexity"),
    Board("ashby", "abridge", "Abridge"),
    Board("ashby", "cursor", "Cursor"),
    Board("ashby", "semgrep", "Semgrep"),
    Board("ashby", "openai", "OpenAI"),
    Board("ashby", "notion", "Notion"),
    Board("ashby", "ramp", "Ramp"),
    Board("ashby", "snowflake", "Snowflake"),
    Board("ashby", "cohere", "Cohere"),
    Board("ashby", "sierra", "Sierra"),
    Board("ashby", "decagon", "Decagon"),
    Board("lever", "palantir", "Palantir"),
    Board("lever", "shieldai", "Shield AI"),
]


def fetch(url: str, robots: Robots) -> list[dict]:
    # Held to the same rules as a board fetch. raw.githubusercontent.com publishes no
    # robots.txt today (a 404, so no rules), but that is its call to change, not ours.
    if not robots.allows(url):
        print(f"  skipped {url}: robots.txt disallows us")
        return []
    robots.pace(url)
    payload = json.loads(web.get(url, timeout=60))
    return payload if isinstance(payload, list) else []


def unread_hosts(links: Iterable[str]) -> Counter[str]:
    """The hosts of the apply links no provider's pattern takes, counted: where a
    new reader would add the most (iCIMS and Oracle topped it before KAN-301)."""
    return Counter(urlsplit(link).hostname or "" for link in links if link and not tokens(link))


#: Why a link no reader takes goes unread, first match wins: the hiring system
#: behind it when the link shows one, else whose site it is. On 2026-10-27, 44% of
#: the curated lists' open postings sat on such links, 689 of them on hiring systems
#: we read, behind a company's own address (docs/coverage.md). `--resolve` maps
#: the kinds it names.
UNREAD_CAUSES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("a link shortener (--resolve)", SHORTENER),
    ("Greenhouse behind the company's site (--resolve)", GH_JID),
    ("iCIMS behind the company's site (--resolve)", ICIMS_HERE),
    ("SmartRecruiters, whose robots.txt disallows us", re.compile(r"smartrecruiters\.com", re.I)),
    ("SuccessFactors", re.compile(r"successfactors|sapsf\.", re.I)),
    ("Eightfold", re.compile(r"\.eightfold\.ai/", re.I)),
    ("JazzHR", re.compile(r"\.applytojob\.com/", re.I)),
    ("Jobvite", re.compile(r"jobvite\.com/", re.I)),
    ("Taleo", re.compile(r"\.taleo\.net/", re.I)),
    ("Avature", re.compile(r"\.avature\.net/", re.I)),
    ("Paylocity", re.compile(r"paylocity\.com/", re.I)),
    ("Pinpoint", re.compile(r"\.pinpointhq\.com/", re.I)),
)
OWN_SITE = "an employer's own site"


def unread_cause(link: str) -> str:
    """Why `link`, which no pattern takes, goes unread (`UNREAD_CAUSES`)."""
    return next((cause for cause, pattern in UNREAD_CAUSES if pattern.search(link)), OWN_SITE)


@dataclass(frozen=True, slots=True)
class Listing:
    """One curated row whose apply link no pattern takes."""

    link: str
    company: str
    #: Still open on the list: the posting is likelier to be on its board now.
    active: bool


def harvest(
    known: Iterable[tuple[str, str]] = (),
) -> tuple[dict[tuple[str, str], str], list[Listing]]:
    """Map (ats, token) -> company name, from every apply URL in the curated lists,
    with the rows whose links name no board. Prints each source's yield, so a list
    whose links stop naming boards says so, and the unread links by cause."""
    known = set(known)
    boards: dict[tuple[str, str], str] = {}
    unread: list[Listing] = []
    robots = Robots(SOURCES)
    for url in SOURCES:
        rows = fetch(url, robots)
        named: set[tuple[str, str]] = set()
        for row in rows:
            link = row.get("url") or ""
            company = (row.get("company_name") or row.get("company") or "").strip()
            keys = tokens(link)
            named.update(keys)
            if link and not keys:
                unread.append(Listing(link, company, bool(row.get("active"))))
            for key in keys:
                # First name wins; later duplicates are the same company.
                if company and key not in boards:
                    boards[key] = company
                boards.setdefault(key, key[1])
        source = "/".join(url.split("/")[3:5])
        if rows and not named:
            print(f"  !  {len(rows):>6,} listings  {source}: no link names a board")
        else:
            new = len(named - known)
            print(f"  {len(rows):>9,} listings  {source}: {len(named):,} boards, {new:,} new")
    print(f"\n  {len(unread):,} apply links no reader takes, by cause (open ones in brackets):")
    by_cause: dict[str, list[Listing]] = {}
    for listing in unread:
        by_cause.setdefault(unread_cause(listing.link), []).append(listing)
    for cause, listings in sorted(by_cause.items(), key=lambda item: -len(item[1])):
        open_ = sum(listing.active for listing in listings)
        hosts = ", ".join(h for h, _ in unread_hosts(x.link for x in listings).most_common(3))
        print(f"  {len(listings):>6,} ({open_:>5,})  {cause}: {hosts}")
    return boards, unread


def resolve(
    unread: list[Listing], robots: Robots, get: Callable[[str], bytes] = _get
) -> dict[tuple[str, str], str]:
    """The boards behind the unread links of the kinds `--resolve` maps, each proved:
    a short link by where it leads, a careers page by the board that holds its
    posting. Open postings are tried first."""
    found: dict[tuple[str, str], str] = {}
    short = [x for x in unread if SHORTENER.search(x.link) and x.active]
    with ThreadPoolExecutor(8) as pool:
        targets = list(pool.map(lambda x: unshortened(x.link, robots, get), short))
    led = [replace(x, link=t) for x, t in zip(short, targets, strict=True) if t]
    for listing in led:
        for key in tokens(listing.link):
            found.setdefault(key, listing.company or key[1])
    print(f"  {len(short):,} open short links: {len(led):,} led somewhere, {len(found):,} boards")

    readers = {"greenhouse": greenhouse_board, "icims": icims_board}
    groups: dict[tuple[str, str, str], list[Listing]] = {}
    for listing in [x for x in unread if not SHORTENER.search(x.link)] + led:
        if tokens(listing.link):
            continue
        ats = "greenhouse" if GH_JID.search(listing.link) else None
        ats = ats or ("icims" if ICIMS_HERE.search(listing.link) else None)
        if ats:
            host = urlsplit(listing.link).hostname or ""
            groups.setdefault((ats, host, listing.company), []).append(listing)

    def one(group: tuple[tuple[str, str, str], list[Listing]]) -> tuple[str, str, str] | None:
        (ats, _, company), listings = group
        for listing in sorted(listings, key=lambda x: not x.active)[:TRIES]:
            if token := readers[ats](listing.link, listing.company, robots, get):
                return ats, token, company
        return None

    with ThreadPoolExecutor(8) as pool:
        proved = [hit for hit in pool.map(one, groups.items()) if hit]
    for ats, token, company in proved:
        found.setdefault((ats, token), company or token)
    for ats in readers:
        tried = sum(1 for key in groups if key[0] == ats)
        hits = sum(1 for hit in proved if hit[0] == ats)
        print(f"  {ats} behind a company's site: {tried:,} companies tried, {hits:,} proved")
    return found


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="build_boards.py", description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--resolve",
        action="store_true",
        help="also find the boards behind short links and companies' own careers"
        " pages, each proved (asks a few hundred hosts; never in the scheduled run)",
    )
    args = parser.parse_args(argv)
    out = BOARDS_CSV
    # Existing rows first, so a board the lists have dropped is kept and a name
    # already in the file is not renamed by whichever list mentions it next.
    boards = {(b.ats, b.token): b.company for b in load_boards(out)} if out.exists() else {}
    before = len(boards)
    print("fetching curated lists")
    found, unread = harvest(boards)
    for key, company in found.items():
        boards.setdefault(key, company)
    if args.resolve:
        print("\nresolving the links no pattern takes")
        robots = Robots(["https://boards-api.greenhouse.io/v1/boards", "https://go.vansh.nyc/"])
        for key, company in resolve(unread, robots).items():
            boards.setdefault(key, company)
    for board in EXTRA:
        boards[(board.ats, board.token)] = board.company
    print(f"\n  {len(boards):,} distinct boards, {len(boards) - before:,} new")

    today = datetime.now(UTC).date().isoformat()
    preamble = (
        f"# Candidate job boards, last grown by build_boards.py on {today}.\n"
        "# Board slugs harvested from public apply URLs in curated internship lists,\n"
        "# resolved careers pages (--resolve), and boards verified by hand.\n"
        "# Boards are only added, never removed; each board must answer its ATS.\n"
    )
    write_boards(
        out,
        (Board(ats, token, company) for (ats, token), company in boards.items()),
        preamble=preamble,
    )

    by_ats: dict[str, int] = {}
    for ats, _ in boards:
        by_ats[ats] = by_ats.get(ats, 0) + 1
    for ats in sorted(by_ats):
        print(f"  {ats:11s} {by_ats[ats]:5,}")
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
