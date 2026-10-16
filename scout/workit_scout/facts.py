"""
The API's records as Scout's facts: what Scout is allowed to say it knows.

Both inputs are JSON-shaped data, never the API's classes (this package never
imports the backend): the experience bank as `GET /applicants/{id}/bank`
returns it, and a `feed.json` row. The private models below name only the
fields Scout reads and ignore the rest.

This is also the privacy boundary: only the bank's sections, original bullets
and skills cross it. A link (a project's included), a location, bullet
variants and the uploaded resume never do. Scout reads the bank only, with no
fallback to an uploaded resume (KAN-212).
"""

from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel

from workit_scout.schemas import JobFacts, ResumeFacts

# An entry is one short line, not its whole bullet list: enough for Scout to
# match on, short enough that twenty of them stay cheap.
MAX_LINE_CHARS = 300

LEVEL = {"internship": "Internship", "new_grad": "New grad"}
WORK_STYLE = {"remote": "Remote", "hybrid": "Hybrid", "onsite": "On site"}


class _Bullet(BaseModel):
    text: str


class _Entry(BaseModel):
    # No `link` or `location`: a link is identity data, and neither helps Scout.
    section: str
    title: str
    organization: str | None = None
    start_month: str | None = None
    end_month: str | None = None
    end_kind: str | None = None
    degree: str | None = None
    field_of_study: str | None = None
    gpa: float | None = None
    issuer: str | None = None
    award_date: str | None = None
    bullets: list[_Bullet] = []


class _Skill(BaseModel):
    name: str


class _Bank(BaseModel):
    entries: list[_Entry] = []
    skills: list[_Skill] = []


def _year(month: str | None) -> str | None:
    return month[:4] if month else None


def _span(e: _Entry) -> str:
    """ " (2023–2027)", " (2025–present)", " (2024)", or "" when undated."""
    start = _year(e.start_month)
    if e.end_kind == "present":
        end = "present"
    elif e.end_kind == "expected" and e.end_month:
        end = f"expected {_year(e.end_month)}"
    else:
        end = _year(e.end_month or e.award_date)
    if start and end:
        return f" ({start}–{end})"
    if start or end:
        return f" ({start or end})"
    return ""


def _line(head: str, detail: str | None) -> str:
    line = f"{head}: {' '.join(detail.split())}" if detail else head
    return (
        line
        if len(line) <= MAX_LINE_CHARS
        else line[:MAX_LINE_CHARS].rsplit(maxsplit=1)[0] + " …"
    )


def _head(e: _Entry) -> str:
    """ "BS in CS at Stony Brook (2023–expected 2027), GPA 3.7",
    "Intern at Acme (2025–present)", leaving out what is unknown."""
    if e.section == "education":
        study = " ".join(
            part for part in (e.degree, e.field_of_study and f"in {e.field_of_study}") if part
        )
        where = f"{study} at {e.title}" if study else e.title
        gpa = f", GPA {e.gpa:g}" if e.gpa else ""
        return f"{where}{_span(e)}{gpa}"
    if e.section == "certifications":
        return f"{e.title}{f' from {e.issuer}' if e.issuer else ''}{_span(e)}"
    return f"{e.title}{f' at {e.organization}' if e.organization else ''}{_span(e)}"


def bank_facts(bank: Mapping[str, Any], *, has_upload: bool) -> ResumeFacts:
    """A bank, as the bank API returns it, cut down to what Scout may see:
    one line per entry, in the bank's order. `has_upload` says whether the
    student has an uploaded resume, so an empty bank can point at import."""
    parsed = _Bank.model_validate(bank)
    lines: dict[str, list[str]] = {}
    for e in parsed.entries:
        detail = " ".join(b.text for b in e.bullets) or None
        lines.setdefault(e.section, []).append(_line(_head(e), detail))
    return ResumeFacts(
        skills=[s.name for s in parsed.skills],
        education=lines.get("education", []),
        experience=lines.get("experience", []),
        projects=lines.get("projects", []),
        leadership=lines.get("leadership", []),
        awards=lines.get("awards", []),
        certifications=lines.get("certifications", []),
        has_upload=has_upload,
    )


def job_facts(job: Mapping[str, Any]) -> JobFacts:
    """A feed.json row, with its codes turned into words the model can repeat."""
    work_style = job.get("work_style")
    return JobFacts(
        title=job["title"],
        company=job["company"],
        location=job.get("location"),
        work_style=WORK_STYLE.get(work_style) if work_style else None,
        experience_level=LEVEL.get(job["experience_level"]),
        description=job.get("description"),
    )
