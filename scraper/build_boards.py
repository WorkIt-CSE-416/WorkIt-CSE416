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

The scheduled scrape runs this before every scrape (.github/workflows/scrape.yml),
so a company a list names today is read on the next run without anyone committing
it. Since boards are only added and nothing is written until every list has
loaded, a failed download leaves boards.csv as it was.
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.error
from collections import Counter
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from urllib.parse import urlsplit

from workit_scraper import web
from workit_scraper.catalog import BOARDS_CSV, load_boards, write_boards
from workit_scraper.discovery_sources import SOURCES
from workit_scraper.polite import Robots
from workit_scraper.providers import PROVIDERS, Board, listing_url
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


#: The link shortener the vanshb03 list wraps every apply link in (2026-10-27):
#: its 1,877 rows named no board, and nothing said so.
SHORTENER = re.compile(r"//go\.vansh\.nyc/", re.I)
#: A Greenhouse posting on a company's own careers site, by its number
#: (careers.withwaymo.com/jobs?gh_jid=8189848).
GH_JID = re.compile(r"[?&]gh_jid=(\d+)", re.I)
#: An iCIMS posting on a company's own careers site (careers.amd.com/jobs/86868?icims=1).
ICIMS_HERE = re.compile(r"icims", re.I)

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


# --- Resolving: the boards behind links no pattern takes (`--resolve`) ------------
#
# Each board is proved before it is kept, never guessed: a board under the wrong
# name would put another company's name on real cards. Only on request, never in
# the scheduled run: it asks a few hundred hosts each time, and a person commits
# the boards.csv it grows, as with every board.

#: Names a careers page may give its Greenhouse board by: the embed script
#: (`embed/job_board/js?for=waymo`), the API, or the board's own address.
GH_NAMED = (
    re.compile(
        r"greenhouse\.io/embed/job_(?:board|app)(?:/js)?\?[^\"'<>\s]*?\bfor=([a-z0-9_-]+)", re.I
    ),
    re.compile(r"boards-api\.greenhouse\.io/v1/boards/([a-z0-9_-]+)", re.I),
    re.compile(r"//(?:job-)?boards(?:\.eu)?\.greenhouse\.io/(?!embed\b)([a-z0-9_-]+)", re.I),
)
#: A posting's number in a company careers site's path (`/jobs/86868`).
JOB_NUMBER = re.compile(r"/jobs/(\d+)")
#: Tries per company and host: a closed posting proves nothing either way.
TRIES = 3


def _get(url: str) -> bytes:
    return web.get(url, timeout=30)


def _read(url: str, robots: Robots, get: Callable[[str], bytes]) -> bytes | None:
    """The body; b"" for a 404, which answers "no"; None when we may not ask or the
    answer says nothing (robots.txt, a refused redirect, a failure)."""
    if not robots.allows(url):
        return None
    robots.pace(url)
    try:
        return get(url)
    except urllib.error.HTTPError as error:
        return b"" if error.code == 404 else None
    except Exception:  # noqa: BLE001 - one link must not end the run
        return None


def _guesses(company: str, link: str) -> list[str]:
    """Board names a company is likely to use: its name run together, and its
    careers site's own name (careers.withwaymo.com: "withwaymo")."""
    labels = (urlsplit(link).hostname or "").split(".")
    site = labels[-2] if len(labels) >= 2 else ""
    return list(dict.fromkeys(g for g in (re.sub(r"[^a-z0-9]", "", company.lower()), site) if g))


def greenhouse_board(listing: Listing, robots: Robots, get: Callable[[str], bytes]) -> str | None:
    """The Greenhouse board whose posting this careers page shows, proved by asking
    that board for the posting's number: only its own board answers 200."""
    number = GH_JID.search(listing.link)
    if not number:
        return None

    def holds(token: str) -> bool:
        api = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{number[1]}"
        return bool(_read(api, robots, get))

    guesses = _guesses(listing.company, listing.link)
    if found := next((token for token in guesses if holds(token)), None):
        return found
    page = (_read(listing.link, robots, get) or b"").decode("utf-8", "replace")
    named = dict.fromkeys(m.lower() for p in GH_NAMED for m in p.findall(page))
    return next((token for token in named if token not in guesses and holds(token)), None)


def icims_board(listing: Listing, robots: Robots, get: Callable[[str], bytes]) -> str | None:
    """The iCIMS tenant whose posting this careers page shows, proved by its sitemap,
    which lists every open job by number (`providers.icims`)."""
    number = JOB_NUMBER.search(urlsplit(listing.link).path)
    if not number:
        return None
    page = (_read(listing.link, robots, get) or b"").decode("utf-8", "replace")
    named = [m.lower() for m in PROVIDERS["icims"].apply_link.findall(page)]
    guesses = [f"careers-{g}" for g in _guesses(listing.company, listing.link)]
    for tenant in dict.fromkeys([*named, *guesses]):
        sitemap = _read(listing_url("icims", tenant), robots, get)
        if sitemap and f"/jobs/{number[1]}/".encode() in sitemap:
            return tenant
    return None


def unshortened(link: str, robots: Robots, get: Callable[[str], bytes]) -> str | None:
    """Where a short link leads: `web.get` refuses the redirect to another site and
    names where it went, which is all this needs."""
    if not robots.allows(link):
        return None
    robots.pace(link)
    try:
        get(link)
    except urllib.error.HTTPError as error:
        if 300 <= error.code < 400 and error.filename and error.filename != link:
            return error.filename
    except Exception:  # noqa: BLE001 - one link must not end the run
        return None
    return None


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
            if token := readers[ats](listing, robots, get):
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
