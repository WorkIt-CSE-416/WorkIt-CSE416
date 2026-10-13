"""
Import (KAN-211): turn the heuristic parser's reading of an uploaded resume
into draft entries and draft skills. Pure: no database, no HTTP. The router
adds the "Already in your bank" flags and saves nothing; the student saves
each draft through the bank's own routes.

Drafts keep the resume's words. The only changes are the ones a draft must
pass to be a valid entry: text clipped to the field's length, at most 30
bullets and 40 courses, and dates dropped when the end comes before the start.
"""

import datetime
import re

from pydantic import ValidationError

from app.models.dto import Experience, ParsedResume, bank_section, entry_end_kind
from app.schemas.bank import DraftEntry, DraftSkill

_SHORT, _LONG, _NAME = 200, 500, 60
_COURSEWORK_RE = re.compile(r"^(?:Relevant\s+)?(?:Coursework|Courses)\s*:?\s*", re.IGNORECASE)
_GPA_LINE_RE = re.compile(r"^GPA\b", re.IGNORECASE)


def _clip(value: str | None, limit: int = _SHORT) -> str | None:
    value = (value or "").strip()
    return value[:limit].strip() or None


def _bullets(description: str | None) -> list[str]:
    lines = [_clip(line, _LONG) for line in (description or "").splitlines()]
    return [line for line in lines if line][:30]


def _span(start: datetime.date | None, end: datetime.date | None) -> dict:
    """An ongoing role (a start, no end) runs to Present."""
    if end is not None:
        return {"start_month": start, "end_month": end, "end_kind": entry_end_kind.month}
    return {"start_month": start, "end_month": None, "end_kind": entry_end_kind.present if start else None}


def _role(section: bank_section, role: Experience) -> dict:
    title = _clip(role.title) or _clip(role.company_name)
    organization = _clip(role.company_name)
    return {
        "section": section,
        "title": title,
        "organization": organization if organization != title else None,
        "location": _clip(role.location),
        **_span(role.start_date, role.end_date),
        "bullets": _bullets(role.description),
    }


def _raw_drafts(parsed: ParsedResume, today: datetime.date) -> list[dict]:
    drafts: list[dict] = []
    for school in parsed.education:
        coursework: list[str] = []
        bullets: list[str] = []
        for line in _bullets(school.description):
            if _COURSEWORK_RE.match(line):
                coursework += [c for c in (_clip(x) for x in _COURSEWORK_RE.sub("", line).split(",")) if c]
            elif not _GPA_LINE_RE.match(line):
                bullets.append(line)
        end = school.end_date
        drafts.append({
            "section": bank_section.education,
            "title": _clip(school.institution),
            "degree": _clip(school.degree),
            "field_of_study": _clip(school.field_of_study),
            "gpa": school.gpa,
            "coursework": coursework[:40],
            "start_month": school.start_date,
            "end_month": end,
            # A graduation still to come is an expected one.
            "end_kind": None if end is None else entry_end_kind.expected if end > today else entry_end_kind.month,
            "bullets": bullets,
        })
    drafts += [_role(bank_section.experience, job) for job in parsed.experience]
    for project in parsed.projects:
        drafts.append({
            "section": bank_section.projects,
            "title": _clip(project.project_name),
            "link": _clip(project.url, _LONG),
            **_span(project.start_date, project.end_date),
            "bullets": _bullets(project.description),
        })
    drafts += [_role(bank_section.leadership, role) for role in parsed.leadership]
    for award in parsed.awards:
        drafts.append({
            "section": bank_section.awards,
            "title": _clip(award.title),
            "organization": _clip(award.issuer),
            "award_date": award.date,
        })
    for cert in parsed.certifications:
        drafts.append({
            "section": bank_section.certifications,
            "title": _clip(cert.cert_name),
            "issuer": _clip(cert.issuer),
        })
    return drafts


def _valid(raw: dict) -> DraftEntry | None:
    if not raw.get("title"):
        return None
    try:
        return DraftEntry.model_validate(raw)
    except ValidationError:
        # Dates that do not fit together (an end before the start) are the
        # likely cause; the student can add them back in the editor.
        undated = {**raw, "start_month": None, "end_month": None, "end_kind": None}
        try:
            return DraftEntry.model_validate(undated)
        except ValidationError:
            return None


def draft_entries(parsed: ParsedResume, today: datetime.date | None = None) -> list[DraftEntry]:
    """Draft entries in section order, each section in the resume's order."""
    today = today or datetime.datetime.now(datetime.UTC).date()
    return [d for d in (_valid(raw) for raw in _raw_drafts(parsed, today)) if d is not None]


def draft_skills(parsed: ParsedResume, bank_names: set[str]) -> list[DraftSkill]:
    """One draft per skill name, ignoring case; `bank_names` are the bank's
    skill names, lowercased."""
    seen: set[str] = set()
    out: list[DraftSkill] = []
    for skill in parsed.skills:
        name = _clip(skill.skill_name, _NAME)
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        out.append(DraftSkill(name=name, group=_clip(skill.category, _NAME), in_bank=name.lower() in bank_names))
    return out
