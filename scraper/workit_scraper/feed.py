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

from workit_scraper.logos import company_domain
from workit_scraper.shortlist import Role, Tag, classify_with_description
from workit_scraper.store import Store

# `providers.text._work_style` yields exactly these three labels, or None. Indexed, not
# `.get`: a fourth label is a change there that must be decided here too, not
# silently dropped to None.
WORK_STYLE = {"Remote": "remote", "Hybrid": "hybrid", "On site": "onsite"}


def row(role: Role, logos: dict[str, str | None]) -> dict[str, object]:
    logo = logos.get(role.board_key)
    return {
        # pick() keys roles on their apply URL, so it is unique per feed.
        "id": role.apply_url,
        "title": role.title,
        "company": role.company,
        "apply_url": role.apply_url,
        # Who it is for, and how it is set up (KAN-233): an internship is the
        # job type internship for a student, whatever hours it states.
        "experience_level": "student" if Tag.INTERN in role.tags else "new_grad",
        "work_style": WORK_STYLE[role.facts.work_style] if role.facts.work_style else None,
        "location": role.location_label or None,
        "posted_at": role.posted_at,
        "logo_url": logo,
        # The employer's own website, which the Jobs page draws the logo from
        # (KAN-442); `logo_url` stays as the page's fallback.
        "company_domain": company_domain(role.board_key, logo),
        "description": role.description,
        "job_type": "internship" if Tag.INTERN in role.tags else role.facts.job_type,
        **salary(role),
        "min_years_experience": role.facts.min_years,
        "start_term": role.facts.start_term,
        # "sponsors", "no_sponsorship", "citizens_only" or None (details.py).
        "sponsorship": role.facts.sponsorship,
        # Its categories, first first, then its specialties: ["data_ai", "software",
        # "data_ai/ml"] (shortlist.Tag). The backend ignores them since KAN-155: it
        # tags each job from its title with its own job_roles list.
        "roles": list(role.roles),
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


#: Why a stored posting is not in the feed, as `job_postings.closed_reason` has
#: them (backend migration bd730e8ab454). The import closes each one it held
#: under its reason here, and under "unknown" one this file does not name.
#: Ranked: when copies at one URL disagree, the first reason wins.
REASONS = ("filtered_out", "replaced", "board_gone", "gone_from_board")


def closings(run: Store, roles: list[Role]) -> dict[str, str]:
    """Why each posting the store holds is missing from the feed, keyed by apply URL.

    Worked out from the store as it is, not from the last run's feed, so an import
    that failed or was skipped loses nothing: the next one still finds why. Every
    posting the store holds and the feed lacks is here, whether or not it was ever
    imported; the import reads only the ones it closes.

    - Not listed, its board said "no such board": `board_gone`.
    - Not listed (two complete reads lacked it): `gone_from_board`.
    - Listed, its title no longer kept (`pick` reads every title again):
      `filtered_out`.
    - Listed and kept, but another copy of its requisition leads the card:
      `replaced`. Copies of one requisition share a title, so a copy's own title
      stands for its card's.
    """
    shown = {role.apply_url for role in roles}
    found: dict[str, str] = {}
    for job in run.jobs:
        if job.apply_url in shown:
            continue
        if run.is_listed(job):
            why = (
                "replaced"
                if classify_with_description(job.title, job.description)
                else "filtered_out"
            )
        else:
            reads = run.boards.get(job.board_key)
            why = "board_gone" if reads and reads.missing_at else "gone_from_board"
        if job.apply_url not in found or REASONS.index(why) < REASONS.index(found[job.apply_url]):
            found[job.apply_url] = why
    return found


def write_closings(found: dict[str, str], path: Path) -> None:
    """closings.json, beside feed.json: `closings`, sorted by URL."""
    path.write_text(json.dumps(found, indent=1, sort_keys=True) + "\n", encoding="utf-8")
