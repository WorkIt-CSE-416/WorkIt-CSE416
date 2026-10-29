"""Reading SuccessFactors career sites (its career-site builder, jobs.grainger.com):
its reader, its page reader and its record."""

from __future__ import annotations

import html
import re
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime

from workit_scraper.providers import fetch
from workit_scraper.providers.fetch import _iso
from workit_scraper.providers.model import Incomplete, Job, Provider
from workit_scraper.providers.registry import job_url, listing_url
from workit_scraper.providers.text import _described, _page


def successfactors(
    token: str, company: str, *, pace: Callable[[str], None] = lambda url: None
) -> list[Job]:
    """Every posting on a SuccessFactors career site, read whole or not at all,
    from its search page: a table of title, place and date, as many rows a page
    as the site chose (Grainger 35). No description: the posting's own page has
    it (`describe_successfactors`)."""
    rows: dict[str, tuple[str, str, str, str]] = {}
    served, expected, ended = 0, None, False
    while expected is None or len(rows) < expected:
        url = listing_url("successfactors", token).replace("startrow=0", f"startrow={len(rows)}")
        if rows:
            pace(url)
        text = fetch._get_text(url)
        total = re.search(r"paginationLabel[^>]*>.*?of\s*<b>([\d,]+)</b>", text, re.S)
        expected = int(total[1].replace(",", "")) if total else 0 if expected is None else expected
        page = _successfactors_rows(text)
        served += len(page)
        for row in page:
            rows.setdefault(row[0], row)
        if not page:
            # Past the last posting. As on Oracle, the count can run over what the
            # site serves. Every posting seen is whole even if pages overlapped:
            # postings with one title can still swap places between pages
            # (Sonepar: 938 of 938 read, some twice).
            ended = True
            break
    if len(rows) != expected and (served != len(rows) or len(rows) > expected or not ended):
        raise Incomplete(f"read {len(rows):,} distinct postings of {expected:,}")
    return [
        Job(
            ats="successfactors",
            token=token,
            company=company,
            # The posting's path, which its own page is read by.
            external_id=path,
            title=title,
            apply_url=f"https://{token}{path}",
            location=place or None,
            posted_at=_successfactors_date(day, "%b %d, %Y"),
        )
        for path, title, place, day in rows.values()
    ]


def _successfactors_rows(text: str) -> list[tuple[str, str, str, str]]:
    """(path, title, place, date) per row of a search page's results table."""
    found = []
    for row in re.findall(r'<tr class="data-row">(.*?)</tr>', text, re.S):
        link = re.search(r'<a href="([^"]+)" class="jobTitle-link">(.*?)</a>', row, re.S)
        place = re.search(r'<span class="jobLocation">(.*?)</span>', row, re.S)
        day = re.search(r'<span class="jobDate">(.*?)</span>', row, re.S)
        if link:
            found.append(
                (
                    html.unescape(link[1]),
                    html.unescape(link[2]).strip(),
                    " ".join(html.unescape(place[1]).split()) if place else "",
                    " ".join(day[1].split()) if day else "",
                )
            )
    return found


def _successfactors_date(text: str | None, layout: str) -> str | None:
    try:
        return _iso(datetime.strptime((text or "").strip(), layout).date().isoformat())
    except ValueError:
        return None


def describe_successfactors(job: Job) -> Job:
    """The same SuccessFactors posting with its description and the exact time it
    went up ("Tue Oct 13 07:00:00 UTC 2026"), from its own page."""
    text = fetch._get_text(job_url("successfactors", job.token, job.external_id))
    posted = re.search(r'<meta itemprop="datePosted" content="([^"]+)"', text)
    try:
        stamp = posted and datetime.strptime(posted[1], "%a %b %d %H:%M:%S UTC %Y")
    except ValueError:
        stamp = None
    full, roles = _described(_element(text, '<span itemprop="description"'))
    return replace(
        job,
        posted_at=_iso(stamp.replace(tzinfo=UTC).isoformat()) if stamp else job.posted_at,
        page=_page(job.title, full, roles=roles),
    )


def _element(text: str, opening: str) -> str | None:
    """The element starting at `opening`, up to its own closing tag."""
    start = text.find(opening)
    if start < 0:
        return None
    tag = re.match(r"<(\w+)", opening)[1]
    depth = 0
    for match in re.finditer(rf"<(/?){tag}\b[^>]*>", text[start:]):
        depth += -1 if match[1] else 1
        if depth == 0:
            return text[start : start + match.end()]
    return text[start:]


PROVIDER = Provider(
    # Its own search page, HTML, a few dozen postings a page. `token` is the site's
    # host. Sorted by title: the default order is not stable from page to page
    # (Hershey's repeated 8 postings across pages and left 8 out; by title, 328 of
    # 328, 2026-10-26).
    listing_url="https://{token}/search/?q=&sortColumn=sort_title&sortDirection=asc&startrow=0",
    read=successfactors,
    # A SuccessFactors career site marks its links `?ats=successfactors`; the
    # board is the site's host (jobs.grainger.com).
    apply_link=re.compile(r"//([a-z0-9.-]+)/[^\s?#]*\?(?:[^\s#]*&)?ats=successfactors", re.I),
    # The posting's own page, by its path, as on Workday.
    job_url="https://{token}{job_id}",
    describe=describe_successfactors,
    paged=True,
    page_date=True,
    # No logo yet.
)
