"""Bounded discovery inputs. The caller supplies robots-checked, paced HTTP reads.

These sources provide leads, never authority to add a board. Validation and
company attribution belong to the discovery command, after URL extraction.
"""

from __future__ import annotations

import html
import json
import os
import re
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Protocol
from urllib.parse import parse_qs, urlencode, urlsplit

from workit_scraper.discovery_sources import CURATED_SOURCES, Source

MAX_RESULTS = 1000
MAX_MONTHS = 12
_URL = re.compile(r"https?://[^\s<>\"']+", re.I)


class Read(Protocol):
    def __call__(self, url: str, *, headers: dict[str, str] | None = None) -> bytes: ...


@dataclass(frozen=True)
class Evidence:
    url: str
    company: str
    source: str


@dataclass(frozen=True)
class SourceFailure:
    channel: str
    source: str
    error: str


@dataclass
class CollectionResult:
    evidence: list[Evidence] = field(default_factory=list)
    failures: list[SourceFailure] = field(default_factory=list)


class DiscoveryError(ValueError):
    """A requested channel could not be read; never silently report zero leads."""


def urls(text: str) -> list[str]:
    """Extract distinct HTTP URLs from HTML, JSON string fragments or plain text."""
    text = html.unescape(text).replace("\\/", "/")
    return list(dict.fromkeys(match.rstrip(".,;!)]}") for match in _URL.findall(text)))


def curated_rows(payload: object, source: Source) -> list[Evidence]:
    """Read only the source's documented application URL and company fields."""
    if not isinstance(payload, list):
        raise DiscoveryError("expected a JSON array of listing records")
    found = []
    for row in payload:
        if not isinstance(row, dict) or source.url_field not in row:
            raise DiscoveryError(f"expected records containing {source.url_field}")
        link = row[source.url_field]
        if link is None or link == "":
            continue
        if not isinstance(link, str):
            raise DiscoveryError(f"expected a string in {source.url_field}")
        company = ""
        for key in source.company_fields:
            value = row.get(key)
            if value is not None and not isinstance(value, str):
                raise DiscoveryError(f"expected a string in {key}")
            if value and value.strip():
                company = value.strip()
                break
        link = html.unescape(link.strip())
        parsed = urlsplit(link)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise DiscoveryError(f"expected an HTTP application URL in {source.url_field}")
        found.append(Evidence(link, company, source.url))
    return found


def hn_company(text: str) -> str:
    """Keep only the conventional 'Company | role | ...' heading, not a guess."""
    plain = html.unescape(re.sub(r"<[^>]+>", " ", text)).strip()
    if "|" not in plain:
        return ""
    name = plain.split("|", 1)[0].strip()
    if not 1 <= len(name) <= 80 or "http" in name.lower() or "\n" in name:
        return ""
    if re.match(
        r"(?i)^(?:we\b|i\b|at\b|our\b|join\b|hiring\b|looking\b|seeking\b|"
        r"senior\b|staff\b|principal\b|lead\b|software\b|backend\b|frontend\b|"
        r"full[ -]?stack\b|engineer\b|developer\b|sr\.?\b|do you\b)",
        name,
    ):
        return ""
    return name


class _SearchLinks(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag != "a" or "result__a" not in (values.get("class") or "").split():
            return
        link = values.get("href") or ""
        destination = parse_qs(urlsplit(link).query).get("uddg", [link])[0]
        if urlsplit(destination).scheme in ("http", "https"):
            self.links.append(destination)


def _attempt(
    result: CollectionResult,
    channel: str,
    source: str,
    collect_source: Callable[[], list[Evidence]],
) -> None:
    """Independent sources keep their successes; failures carry safe diagnostics."""
    try:
        result.evidence.extend(collect_source())
    except Exception as error:
        message = str(error) if isinstance(error, DiscoveryError) else type(error).__name__
        result.failures.append(SourceFailure(channel, source, message))


def curated(read: Read, sources: Iterable[Source]) -> CollectionResult:
    result = CollectionResult()
    for source in sources:
        _attempt(
            result,
            "curated",
            source.url,
            lambda source=source: curated_rows(json.loads(read(source.url)), source),
        )
    return result


def _hn_comments(payload: object, thread_id: str) -> list[Evidence]:
    if not isinstance(payload, dict) or not isinstance(payload.get("children"), list):
        raise DiscoveryError("HN detail lacks a comment list")
    found = []
    for comment in payload["children"]:
        text = comment.get("text") or ""
        comment_id = str(comment.get("id", thread_id))
        if not comment_id.isdigit():
            raise DiscoveryError("HN returned an invalid comment identifier")
        source = f"https://news.ycombinator.com/item?id={comment_id}"
        found.extend(Evidence(url, hn_company(text), source) for url in urls(text))
    return found


def hn(read: Read, months: int) -> CollectionResult:
    search = "https://hn.algolia.com/api/v1/search_by_date?" + urlencode(
        {
            "tags": "story,author_whoishiring",
            "query": "Who is hiring?",
            "hitsPerPage": 30,
        }
    )
    payload = json.loads(read(search))
    threads = [row for row in payload["hits"] if "who is hiring?" in row.get("title", "").lower()][
        :months
    ]
    result = CollectionResult()
    for thread in threads:
        identifier = str(thread["objectID"])
        if not identifier.isdigit():
            result.failures.append(SourceFailure("hn", search, "invalid thread identifier"))
            continue
        source = f"https://hn.algolia.com/api/v1/items/{identifier}"
        _attempt(
            result,
            "hn",
            source,
            lambda source=source, identifier=identifier: _hn_comments(
                json.loads(read(source)), identifier
            ),
        )
    return result


def ddg(read: Read, query: str) -> CollectionResult:
    source = "https://html.duckduckgo.com/html/?" + urlencode({"q": query})
    parser = _SearchLinks()
    page = read(source).decode("utf-8")
    parser.feed(page)
    if not parser.links and "no-results" not in page:
        raise DiscoveryError("DuckDuckGo returned no recognizable results; possibly blocked")
    return CollectionResult([Evidence(url, "", source) for url in parser.links])


def github(read: Read, query: str, limit: int, env: Mapping[str, str]) -> CollectionResult:
    token = env.get("GITHUB_TOKEN") or env.get("GH_TOKEN")
    if not token:
        raise DiscoveryError("github needs GITHUB_TOKEN or GH_TOKEN")
    source = "https://api.github.com/search/code?" + urlencode(
        {
            "q": query,
            "per_page": min(limit, 100),
        }
    )
    payload = json.loads(
        read(
            source,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github.text-match+json",
            },
        )
    )
    if payload.get("incomplete_results"):
        raise DiscoveryError("GitHub returned incomplete search results; narrow the query")
    return CollectionResult(
        [
            Evidence(url, "", row["html_url"])
            for row in payload["items"]
            for fragment in row.get("text_matches", [])
            for url in urls(fragment.get("fragment", ""))
        ]
    )


def google(read: Read, query: str, limit: int, env: Mapping[str, str]) -> CollectionResult:
    key, cx = env.get("GOOGLE_CSE_KEY"), env.get("GOOGLE_CSE_CX")
    if not key or not cx:
        raise DiscoveryError("google needs GOOGLE_CSE_KEY and GOOGLE_CSE_CX")
    source = "https://customsearch.googleapis.com/customsearch/v1?" + urlencode(
        {
            "q": query,
            "cx": cx,
            "num": min(limit, 10),
        }
    )
    payload = json.loads(read(source, headers={"X-Goog-Api-Key": key}))
    if "error" in payload:
        raise DiscoveryError("Google rejected the search request")
    return CollectionResult([Evidence(row["link"], "", source) for row in payload.get("items", [])])


@dataclass(frozen=True)
class Options:
    query: str
    limit: int
    months: int
    sources: Iterable[Source]
    environ: Mapping[str, str]


@dataclass(frozen=True)
class Channel:
    run: Callable[[Read, Options], CollectionResult]
    requires_query: bool = False
    limit_results: bool = False


CHANNELS = {
    "curated": Channel(lambda read, o: curated(read, o.sources)),
    "hn": Channel(lambda read, o: hn(read, o.months)),
    "ddg": Channel(lambda read, o: ddg(read, o.query), True, True),
    "github": Channel(lambda read, o: github(read, o.query, o.limit, o.environ), True, True),
    "google": Channel(lambda read, o: google(read, o.query, o.limit, o.environ), True, True),
}


def validate_options(channel: str, *, query: str = "", limit: int = 20, months: int = 3) -> None:
    if channel not in CHANNELS:
        raise DiscoveryError(f"unknown discovery channel: {channel}")
    if not 1 <= limit <= MAX_RESULTS or not 1 <= months <= MAX_MONTHS:
        raise DiscoveryError(f"limit must be 1..{MAX_RESULTS} and months must be 1..{MAX_MONTHS}")
    if CHANNELS[channel].requires_query and not query.strip():
        raise DiscoveryError(f"{channel} needs an explicit search query")


def collect(
    channel: str,
    read: Read,
    *,
    query: str = "",
    limit: int = 20,
    months: int = 3,
    sources: Iterable[Source] | None = None,
    environ: Mapping[str, str] | None = None,
) -> CollectionResult:
    """Collect evidence and source failures; search results alone are capped."""
    validate_options(channel, query=query, limit=limit, months=months)
    options = Options(
        query,
        limit,
        months,
        CURATED_SOURCES if sources is None else sources,
        os.environ if environ is None else environ,
    )
    try:
        result = CHANNELS[channel].run(read, options)
    except DiscoveryError:
        raise
    except Exception as error:
        raise DiscoveryError(f"{channel} discovery failed ({type(error).__name__})") from None
    unique = list(dict.fromkeys(result.evidence))
    result.evidence = unique[:limit] if CHANNELS[channel].limit_results else unique
    return result
