"""
The API's records as Scout's facts: what Scout is allowed to say it knows.

Pure mapping, no database or HTTP (the router loads the records). It is also
the privacy boundary: only parsed resume sections cross it — a name, email,
phone, link or the raw resume text never does, because the production model is
a free tier that may train on prompts.
"""

from datetime import date

from workit_scout.schemas import JobFacts, ResumeFacts

from app.models.dto import Education, ParsedResume
from app.schemas.jobs import JobListing

# A resume line is a summary, not the whole bullet list: enough for Scout to
# match on, short enough that ten of them stay cheap.
MAX_LINE_CHARS = 300

LEVEL = {"internship": "Internship", "new_grad": "New grad"}
WORK_STYLE = {"remote": "Remote", "hybrid": "Hybrid", "onsite": "On site"}


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


def _education(e: Education) -> str:
    """ "BS in CS at Stony Brook (2023–2027), GPA 3.7", leaving out what is unknown."""
    study = " ".join(
        part
        for part in (e.degree, e.field_of_study and f"in {e.field_of_study}")
        if part
    )
    where = f"{study} at {e.institution}" if study else e.institution
    gpa = f", GPA {e.gpa}" if e.gpa else ""
    return _line(f"{where}{_span(e.start_date, e.end_date)}{gpa}", None)


def resume_facts(parsed: ParsedResume) -> ResumeFacts:
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


def job_facts(job: JobListing) -> JobFacts:
    return JobFacts(
        title=job.title,
        company=job.company,
        location=job.location,
        work_style=WORK_STYLE.get(job.work_style) if job.work_style else None,
        experience_level=LEVEL[job.experience_level],
        description=job.description,
    )
