"""
The API's records as Scout's facts: what Scout is allowed to say it knows.

Both inputs are JSON-shaped data, never the API's classes (this package never
imports the backend): a resume's stored `parsed_json` and a `feed.json` row.
The private models below name only the fields Scout reads and ignore the rest.

This is also the privacy boundary: only parsed resume sections cross it — a
name, email, phone, link or the raw resume text never does, because the
production model is a free tier that may train on prompts.
"""

from collections.abc import Mapping
from datetime import date
from typing import Any

from pydantic import BaseModel

from workit_scout.schemas import JobFacts, ResumeFacts

# A resume line is a summary, not the whole bullet list: enough for Scout to
# match on, short enough that ten of them stay cheap.
MAX_LINE_CHARS = 300

LEVEL = {"internship": "Internship", "new_grad": "New grad"}
WORK_STYLE = {"remote": "Remote", "hybrid": "Hybrid", "onsite": "On site"}


class _Education(BaseModel):
    institution: str
    degree: str | None = None
    field_of_study: str | None = None
    gpa: float | None = None
    start_date: date | None = None
    end_date: date | None = None


class _Experience(BaseModel):
    company_name: str
    title: str
    start_date: date | None = None
    end_date: date | None = None
    description: str | None = None


class _Skill(BaseModel):
    skill_name: str


class _Project(BaseModel):
    # No `url`: a link is contact-adjacent and useless to Scout.
    project_name: str
    description: str | None = None


class _Resume(BaseModel):
    education: list[_Education] = []
    experience: list[_Experience] = []
    skills: list[_Skill] = []
    projects: list[_Project] = []


def _span(start: date | None, end: date | None) -> str:
    if not start and not end:
        return ""
    return f" ({start.year if start else '?'}–{end.year if end else 'present'})"


def _line(head: str, detail: str | None) -> str:
    line = f"{head}: {' '.join(detail.split())}" if detail else head
    return (
        line
        if len(line) <= MAX_LINE_CHARS
        else line[:MAX_LINE_CHARS].rsplit(maxsplit=1)[0] + " …"
    )


def _education(e: _Education) -> str:
    """ "BS in CS at Stony Brook (2023–2027), GPA 3.7", leaving out what is unknown."""
    study = " ".join(
        part
        for part in (e.degree, e.field_of_study and f"in {e.field_of_study}")
        if part
    )
    where = f"{study} at {e.institution}" if study else e.institution
    gpa = f", GPA {e.gpa}" if e.gpa else ""
    return _line(f"{where}{_span(e.start_date, e.end_date)}{gpa}", None)


def resume_facts(parsed_json: Mapping[str, Any]) -> ResumeFacts:
    """A resume's stored parsed_json, cut down to what Scout may see."""
    parsed = _Resume.model_validate(parsed_json)
    return ResumeFacts(
        skills=[s.skill_name for s in parsed.skills],
        experience=[
            _line(
                f"{e.title} at {e.company_name}{_span(e.start_date, e.end_date)}",
                e.description,
            )
            for e in parsed.experience
        ],
        education=[_education(e) for e in parsed.education],
        projects=[_line(p.project_name, p.description) for p in parsed.projects],
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
