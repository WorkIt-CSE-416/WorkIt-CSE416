"""Regenerate boards.csv from public curated internship lists.

    python3 build_boards.py

Those lists are maintained by people who add a company when it starts hiring interns,
which makes them a far better seed than an untargeted registry: about a quarter of
these boards yield an early-career software role, against roughly a twentieth of a
random ATS registry.

We take one fact from them -- which ATS board slug a company uses, read out of public
apply URLs -- and nothing else. Every board still has to answer the employer's own API
before it reaches the page, so this file is a list of candidates, never a list of
conclusions. The postings themselves are always scraped from the employer.

Sources, credited in the header this writes:
  github.com/SimplifyJobs/Summer2026-Internships
  github.com/SimplifyJobs/New-Grad-Positions
  github.com/vanshb03/Summer2026-Internships
"""

from __future__ import annotations

import csv
import json
import re
from datetime import UTC, datetime
from pathlib import Path

from workit_scraper import web
from workit_scraper.polite import Robots
from workit_scraper.providers import Board

SOURCES = [
    "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/vanshb03/Summer2026-Internships/dev/.github/scripts/listings.json",
]

PATTERNS = {
    "greenhouse": re.compile(
        r"(?:boards|job-boards)\.greenhouse\.io/(?:embed/job_app\?for=)?([a-z0-9_-]+)", re.I
    ),
    "lever": re.compile(r"jobs\.lever\.co/([a-z0-9_.-]+)", re.I),
    "ashby": re.compile(r"jobs\.ashbyhq\.com/([a-z0-9_.-]+)", re.I),
}

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


def harvest() -> dict[tuple[str, str], str]:
    """Map (ats, token) -> company name, from every apply URL in the curated lists."""
    boards: dict[tuple[str, str], str] = {}
    robots = Robots(SOURCES)
    for url in SOURCES:
        rows = fetch(url, robots)
        print(f"  {len(rows):>6,} listings  {url.split('/')[4]}")
        for row in rows:
            link = row.get("url") or ""
            company = (row.get("company_name") or row.get("company") or "").strip()
            for ats, pattern in PATTERNS.items():
                for token in pattern.findall(link):
                    key = (ats, token.lower())
                    # First name wins; later duplicates are the same company.
                    if company and key not in boards:
                        boards[key] = company
                    boards.setdefault(key, token)
    return boards


def main() -> int:
    print("fetching curated lists")
    boards = harvest()
    for board in EXTRA:
        boards[(board.ats, board.token)] = board.company
    print(f"\n  {len(boards):,} distinct boards")

    out = Path(__file__).parent / "boards.csv"
    today = datetime.now(UTC).date().isoformat()
    with out.open("w", newline="", encoding="utf-8") as handle:
        handle.write(
            f"# Candidate job boards, regenerated by build_boards.py on {today}.\n"
            "# Board slugs harvested from public apply URLs in the curated internship\n"
            "# lists at SimplifyJobs/Summer2026-Internships, SimplifyJobs/New-Grad-Positions\n"
            "# and vanshb03/Summer2026-Internships, plus boards verified by hand.\n"
            "# These are candidates, not conclusions: every board must answer the\n"
            "# employer's own API before any posting reaches the page.\n"
        )
        # csv.writer defaults to CRLF; the repo normalises to LF (see ../.gitattributes)
        # and asks that CRLF never be committed, so say so rather than rely on the filter.
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["ats", "token", "company"])
        for (ats, token), company in sorted(boards.items()):
            writer.writerow([ats, token, company])

    by_ats: dict[str, int] = {}
    for ats, _ in boards:
        by_ats[ats] = by_ats.get(ats, 0) + 1
    for ats in sorted(by_ats):
        print(f"  {ats:11s} {by_ats[ats]:5,}")
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
