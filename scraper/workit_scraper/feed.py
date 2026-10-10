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
        "work_style": WORK_STYLE[role.facts.work_style] if role.facts.work_style else None,
        "location": role.location_label or None,
        "posted_at": role.posted_at,
        "logo_url": logos.get(role.board_key),
        "description": role.description,
        "job_type": role.facts.job_type,
        **salary(role),
        "min_years_experience": role.facts.min_years,
        "start_term": role.facts.start_term,
        # "sponsors", "no_sponsorship", "citizens_only" or None (details.py).
        "sponsorship": role.facts.sponsorship,
    }


def salary(role: Role) -> dict[str, object]:
    """`job_postings`' salary columns, always as a range: a single amount is a
    range whose ends meet, and the card prints it once (format.ts formatSalary).
    `salary` is the company composer's single-amount column; we never fill it."""
    pay = role.facts.pay
    return {
        "salary": None,
        "salary_min": pay.low if pay else None,
        "salary_max": pay.high if pay else None,
        "salary_currency": pay.currency if pay else None,
        "salary_period": pay.period if pay else None,
    }


def write(roles: list[Role], logos: dict[str, str | None], path: Path) -> None:
    """Newest first, in `pick()`'s order: the API serves a prefix of this list."""
    rows = [row(role, logos) for role in roles]
    path.write_text(json.dumps(rows, indent=1) + "\n", encoding="utf-8")
