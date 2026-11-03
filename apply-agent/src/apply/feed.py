"""The Feed: Simplify's Summer 2027 listings.json, narrowed to Matches with
plain code over the Feed's own fields. Zero tokens.

The rules come from the Match filter research (research/match-filter.md on
branch research/match-filter).
"""

import json
import re
from collections.abc import Callable
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import urlopen

from apply.model import Posting
from apply.profile import POLICIES, load_policies

LIVE = "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json"

TERM = "Summer 2027"
CATEGORIES = {"Software", "AI/ML/Data", "Software Engineering", "Data Science, AI & Machine Learning"}
# Categories whose engineering titles are software roles in disguise.
RESCUE_CATEGORIES = {"Hardware", "Quant", "Hardware Engineering"}

# A software or AI/ML title, wherever the Feed filed it.
ENGINEERING = re.compile(
    r"software|developer|\bswe\b|\bsde\b|programmer|machine learning|\bml\b|\bai\b|artificial intelligence"
    r"|computer vision|deep learning|\bllm|data engineer|data scien|full[- ]stack|backend|back[- ]end"
    r"|frontend|front[- ]end|embedded|firmware|autonom|robotics software|platform engineer|infrastructure"
    r"|devops|\bsre\b|cloud"
)
# A fellowship is a Match only where its title names engineering work, not just AI.
FELLOWSHIP = re.compile(r"\bfellow")
FELLOWSHIP_ENGINEERING = re.compile(r"engineer|scientist|software|developer|programmer|machine learning|\bml\b|data scien")
GRAD_DEGREE_TITLE = re.compile(r"master|\bmba\b|ph\.?d|doctor")
UNDERGRAD_DEGREES = {"Bachelor's", "Associate's"}

STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
    "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
US_PLACES = {
    "nyc", "sf", "south sf", "la", "united states", "usa", "us", "remote in usa", "remote in us",
    *(name.casefold() for name in STATES.values()),
}


class SimplifyFeed:
    """The Feed's Matches, from Simplify's JSON however it is read (a download or a file)."""

    def __init__(self, read: Callable[[], bytes], policies: Path = POLICIES):
        """A title in a core category that isn't engineering (analytics, BI, IT,
        operations) is dropped: policies.yaml's not_engineering_titles."""
        self._read = read
        self._not_engineering = re.compile("|".join(load_policies(policies)["not_engineering_titles"]))

    def postings(self) -> list[Posting]:
        """Every Match, newest `date_posted` first, then newest `date_updated`,
        each role once (on its newest Posting). Postings older than 60 days
        stay in: the Feed keeps them open."""
        records = [r for r in json.loads(self._read()) if is_match(r, self._not_engineering)]
        records.sort(key=lambda r: (r["date_posted"], r["date_updated"]), reverse=True)
        matches, seen = [], set()
        for r in records:
            keys = repost_keys(r["id"], r["url"])
            if not keys & seen:
                seen |= keys
                matches.append(Posting(id=r["id"], company=r["company_name"], title=r["title"], url=r["url"]))
        return matches


def live_feed() -> SimplifyFeed:
    """The Feed as it is now, downloaded on every read."""
    return SimplifyFeed(lambda: urlopen(LIVE, timeout=60).read())


def is_match(record: dict, not_engineering: re.Pattern) -> bool:
    """Open, shown, Summer 2027, a software or AI/ML role, in the US and open to undergraduates."""
    return (
        record["active"]
        and record["is_visible"]
        and any(TERM in term for term in record["terms"])
        and _is_role(record["category"], record["title"].casefold(), not_engineering)
        and any(_is_us(place) for place in record["locations"])
        and _is_undergrad(record["degrees"], record["title"].casefold())
    )


def _is_role(category: str, title: str, not_engineering: re.Pattern) -> bool:
    if FELLOWSHIP.search(title) and not FELLOWSHIP_ENGINEERING.search(title):
        return False  # The New York Times' "AI Initiatives Fellow" is journalism: "AI" alone names the topic, not the work
    if category in CATEGORIES:
        return not not_engineering.search(title) or bool(ENGINEERING.search(title) or re.search(r"engineer|scientist", title))
    if category in RESCUE_CATEGORIES:
        return bool(ENGINEERING.search(title)) and "product manag" not in title
    return False


def _is_us(place: str) -> bool:
    place = place.strip().casefold()
    if place in US_PLACES:
        return True
    *_, last = (part.strip() for part in place.split(","))
    return "," in place and (last.upper() in STATES or last in US_PLACES)


def _is_undergrad(degrees: list[str], title: str) -> bool:
    return (not degrees or bool(UNDERGRAD_DEGREES & set(degrees))) and not GRAD_DEGREE_TITLE.search(title)


# Query parameters that only track where a click came from or how a page renders.
NOISE_PARAMS = re.compile(r"utm_.*|ref|source|src|gh_src|lever-source|mobile|needsredirect|embed|icims|ats|lang|nl|fr|in_iframe")
WORKDAY_REQ = re.compile(r"//([^./]+)\.wd\d+\.myworkdayjobs\.com/.*_([^_/]+)$")


def names(url: str, listings: bytes) -> tuple[str, str] | None:
    """The company and title the Feed lists for the role at `url` (the same
    role by its repost keys), whether or not it is a Match."""
    keys = repost_keys("", url) - {("id", "")}
    return next(((r["company_name"], r["title"]) for r in json.loads(listings) if repost_keys(r["id"], r["url"]) & keys), None)


def repost_keys(application_id: str, url: str) -> set[tuple[str, ...]]:
    """What makes two Postings the same role: the Feed id, the normalized URL,
    or the Workday tenant and req id (one req is often on two career sites)."""
    keys = {("id", application_id), ("url", normalize_url(url))}
    if workday := WORKDAY_REQ.search(normalize_url(url)):
        tenant, req = workday.groups()
        keys.add(("workday req", tenant, re.sub(r"-\d{1,2}$", "", req)))
    return keys


def normalize_url(url: str) -> str:
    """Lowercase scheme and host; no fragment, tracking parameters, trailing
    slash, /apply or /application. Other parameters (a Greenhouse embed's
    token, say) name the Posting, so they stay."""
    parts = urlsplit(url.strip())
    query = sorted({(k, v) for k, v in parse_qsl(parts.query) if not NOISE_PARAMS.fullmatch(k.casefold())})
    path = re.sub(r"(/apply|/application)?/*$", "", parts.path)
    return urlunsplit((parts.scheme.casefold(), parts.netloc.casefold(), path, urlencode(query), ""))
