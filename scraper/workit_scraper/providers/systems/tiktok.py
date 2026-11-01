"""Reading TikTok's job board: its reader and its record."""

from __future__ import annotations

import re
from collections.abc import Callable

from workit_scraper.providers import fetch
from workit_scraper.providers.model import Incomplete, Job, Provider
from workit_scraper.providers.registry import listing_url
from workit_scraper.providers.text import _described, _page, _place

#: Postings per TikTok request; it takes 200 (lifeattiktok.com itself asks for 12).
TIKTOK_PAGE = 200


def tiktok(
    token: str, company: str, *, pace: Callable[[str], None] = lambda url: None
) -> list[Job]:
    """Every posting TikTok lists on lifeattiktok.com (about 4,300), with its
    description and requirements, read whole or not at all. The search answers
    "invalid request" without a `website-path` header naming the site. ByteDance's
    own site (jobs.bytedance.com) is a separate list, and did not answer at all
    when this was written."""
    url = listing_url("tiktok", token)
    rows: dict[str, dict] = {}
    expected, offset = None, 0
    while expected is None or offset < expected:
        if offset:
            pace(url)
        payload = fetch._post_json(
            url,
            {
                "keyword": "",
                "limit": TIKTOK_PAGE,
                "offset": offset,
                "recruitment_id_list": [],
                "job_category_id_list": [],
                "subject_id_list": [],
                "location_code_list": [],
            },
            headers={"website-path": "tiktok"},
        )
        assert isinstance(payload, dict)
        if payload.get("code") != 0:
            raise RuntimeError(f"TikTok's search said {payload.get('message')!r}")
        data = payload.get("data") or {}
        expected = int(data.get("count") or 0) if expected is None else expected
        page = data.get("job_post_list") or []
        for row in page:
            rows.setdefault(str(row["id"]), row)
        if not page:
            break
        offset += TIKTOK_PAGE
    if len(rows) != expected:
        raise Incomplete(f"read {len(rows):,} distinct postings of {expected:,}")
    jobs = []
    for job_id, row in rows.items():
        title = (row.get("title") or "").strip()
        full, roles = _described(
            "\n\n".join(row.get(part) or "" for part in ("description", "requirement"))
        )
        jobs.append(
            Job(
                ats="tiktok",
                token=token,
                company=company,
                external_id=job_id,
                title=title,
                apply_url=f"https://lifeattiktok.com/search/{job_id}",
                location=_tiktok_place(row.get("city_info")),
                department=_tiktok_root(row.get("job_category")),
                # The search gives no date.
                page=_page(title, full, roles=roles),
            )
        )
    return jobs


def _tiktok_place(city: dict | None) -> str | None:
    """ "San Jose, California, United States of America" from a city and its parents."""
    names = []
    while city:
        names.append(city.get("en_name"))
        city = city.get("parent")
    return _place(*names) or None


def _tiktok_root(category: dict | None) -> str | None:
    """A category's top level ("R&D" over "Backend"): the closest TikTok has to a
    department."""
    while category and category.get("parent"):
        category = category["parent"]
    return (category or {}).get("en_name") or None


PROVIDER = Provider(
    # What lifeattiktok.com's search calls: a POST, one board for all of TikTok.
    listing_url="https://api.lifeattiktok.com/api/v1/public/supplier/search/job/posts",
    read=tiktok,
    # lifeattiktok.com/search/{id}, /position/{id}/detail: one board, `lifeattiktok`.
    apply_link=re.compile(r"//(?:www\.)?(lifeattiktok)\.com/", re.I),
    paged=True,
    # The list carries every description, so no page is read. No logo yet.
)
