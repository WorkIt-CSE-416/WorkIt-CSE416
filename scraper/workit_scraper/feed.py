"""Write the shortlist as feed.json: the data behind WorkIt's Jobs feed.

The same roles `report` renders as HTML, as rows shaped exactly like the API's
`GET /jobs` response (`backend/app/schemas/jobs.py`). The backend reads this file
and imports none of our code -- backend/CLAUDE.md: nothing above backend/ is part
of its build -- so this row is the whole contract between the two, and a field
added here must be added there.

Values are the schema's own enums, not our display labels: the labels are for the
HTML page, and translating them here, next to where they are made, keeps the
backend from knowing they exist.
"""

from __future__ import annotations

import json
from pathlib import Path

from workit_scraper.shortlist import Role, Tag

# `providers._work_style` yields exactly these three labels, or None. Indexed, not
# `.get`: a fourth label is a change there that must be decided here too, not
# silently dropped to None.
WORK_STYLE = {"Remote": "remote", "Hybrid": "hybrid", "On site": "onsite"}


def row(role: Role, logos: dict[str, str | None]) -> dict[str, object]:
    return {
        # pick() keys roles on their apply URL, so it is unique per feed.
        "id": role.apply_url,
        "title": role.title,
        "company": role.company,
        "apply_url": role.apply_url,
        "experience_level": "internship" if Tag.INTERN in role.tags else "new_grad",
        "work_style": WORK_STYLE[role.work_style] if role.work_style else None,
        "location": role.location_label or None,
        "posted_at": role.posted_at,
        "logo_url": logos.get(role.board_key),
        "description": role.description,
        "job_type": role.facts.job_type,
        **salary(role),
        "min_years_experience": role.facts.min_years,
        "start_term": role.facts.start_term,
    }


def salary(role: Role) -> dict[str, object]:
    """`job_postings`' salary columns: one amount, or a range when the two differ."""
    pay = role.facts.pay
    if pay is None:
        return dict.fromkeys(
            ("salary", "salary_min", "salary_max", "salary_currency", "salary_period")
        )
    one = pay.low == pay.high
    return {
        "salary": pay.low if one else None,
        "salary_min": None if one else pay.low,
        "salary_max": None if one else pay.high,
        "salary_currency": pay.currency,
        "salary_period": pay.period,
    }


def write(roles: list[Role], logos: dict[str, str | None], path: Path) -> None:
    """Newest first, in `pick()`'s order: the API serves a prefix of this list."""
    rows = [row(role, logos) for role in roles]
    path.write_text(json.dumps(rows, indent=1) + "\n", encoding="utf-8")
