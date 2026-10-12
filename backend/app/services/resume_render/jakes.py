'''
Jake's Resume (jakegut/resume, MIT, Jake Gutierrez), rebuilt as blocks: the
one-column LaTeX template students use because applicant tracking systems
read it cleanly. Centred name over one contact line; small-caps section
headings over a rule; each entry's bold title and dates, then its
organization and place in italics; tight bullets; skills grouped one line
per category. Its four sections are Education, Experience, Projects and
Technical Skills; Leadership & Activities, Awards and Certifications are
added in the same style and drawn only when they have entries.
'''
from collections.abc import Iterable
from datetime import date
from itertools import groupby

from app.models.dto import ParsedResume
from app.services.experience import bullets_of
from app.services.resume_render.blocks import (
    Block,
    Bullet,
    Contact,
    EntryHeader,
    Heading,
    Name,
    SkillLine,
)

KEY = "jakes"
TITLE = "Jake's Resume"


def _when(d: date | None) -> str:
    """"Aug. 2018", "June 2020": the original abbreviates a month with a
    period, and spells out the short ones."""
    if not d:
        return ""
    name = d.strftime("%B")
    return f"{name} {d.year}" if len(name) <= 4 else f"{name[:3]}. {d.year}"


def span(start: date | None, end: date | None) -> str:
    '''"June 2024 – Present", "Aug. 2027", or nothing.'''
    if start and end:
        return f"{_when(start)} – {_when(end)}"
    if start:
        return f"{_when(start)} – Present"
    return _when(end)


def _section(title: str, body: list[Block]) -> list[Block]:
    return [Heading(title), *body] if body else []


def _bullets(lines: Iterable[str]) -> list[Block]:
    return [Bullet(line) for line in lines]


def layout(resume: ParsedResume, name: str, contacts: list[tuple[str, str | None]]) -> list[Block]:
    blocks: list[Block] = [Name(name)]
    if contacts:
        blocks.append(Contact(tuple(contacts)))

    education: list[Block] = []
    for e in resume.education:
        # "Bachelor of Science in Computer Science", not "… in Computer
        # Science in Computer Science" when the degree already names its field
        field = e.field_of_study if e.field_of_study and (e.field_of_study.casefold()
                                   not in (e.degree or "").casefold()) else None
        study = " in ".join(part for part in (e.degree, field) if part)
        gpa = f"GPA {e.gpa:g}" if e.gpa else ""
        education.append(EntryHeader(
            left=e.institution, right=e.location or "",
            sub_left=", ".join(part for part in (study, gpa) if part),
            sub_right=span(e.start_date, e.end_date),
        ))
        education += _bullets(bullets_of(e))

    experience: list[Block] = []
    for x in resume.experience:
        experience.append(EntryHeader(
            left=x.title, right=span(x.start_date, x.end_date),
            sub_left=x.company_name, sub_right=x.location or "",
        ))
        experience += _bullets(bullets_of(x))

    projects: list[Block] = []
    for p in resume.projects:
        projects.append(EntryHeader(
            left=p.project_name, note=p.technologies or "", right=span(p.start_date, p.end_date),
        ))
        projects += _bullets(bullets_of(p))

    activities: list[Block] = []
    for a in resume.activities:
        activities.append(EntryHeader(
            left=a.role, right=span(a.start_date, a.end_date),
            sub_left=a.organization, sub_right=a.location or "",
        ))
        activities += _bullets(bullets_of(a))

    awards: list[Block] = []
    for w in resume.awards:
        awards.append(EntryHeader(left=w.award_name, note=w.issuer or "", right=_when(w.end_date)))
        awards += _bullets(bullets_of(w))

    certifications: list[Block] = [
        EntryHeader(left=c.cert_name, note=c.issuer or "", right=_when(c.end_date))
        for c in resume.certifications
    ]

    # One line per category, in the order the categories first appear;
    # uncategorised skills under "Skills"
    order: dict[str, int] = {}
    for s in resume.skills:
        order.setdefault(s.category or "Skills", len(order))
    grouped = sorted(resume.skills, key=lambda s: order[s.category or "Skills"])
    skills: list[Block] = [
        SkillLine(label, ", ".join(s.skill_name for s in group))
        for label, group in groupby(grouped, key=lambda s: s.category or "Skills")
    ]

    blocks += _section("Education", education)
    blocks += _section("Experience", experience)
    blocks += _section("Projects", projects)
    blocks += _section("Leadership & Activities", activities)
    blocks += _section("Awards", awards)
    blocks += _section("Certifications", certifications)
    blocks += _section("Technical Skills", skills)
    return blocks
