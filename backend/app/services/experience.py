'''
The two converters between the Experience Bank and a resume (KAN-176), and
nothing else: the bank is rows (models/experience.py), a resume is one frozen
ParsedResume, and this is the only code that maps one onto the other.

- resume_to_entries: an uploaded resume's sections, as new bank entries
  (the bank's Import From Resume, and the backfill script)
- bank_to_resume: the entries and skills an applicant picked, as a resume
  (Generate, and Tailor when it starts from the bank)

Both take and return plain shapes (schemas/experience.py), never ORM rows, so
they are tested without a database.
'''
import re
from collections.abc import Iterable

from app.models.dto import (
    Activity,
    Award,
    Certification,
    Education,
    EntrySection,
    Experience,
    ParsedResume,
    Project,
    Skill,
)
from app.schemas.experience import EntryDetails, EntryDraft, SkillDraft

# A bullet glyph or dash a parser leaves at the start of a line
_MARKER = re.compile(r"^\s*(?:[•●▪◦‣∙·*\-–—]|\d+[.)])\s+")


def bullets_of(item: Education | Experience | Project | Activity | Award) -> list[str]:
    '''An item's lines. A built resume stores `bullets`; the parser and every
    resume stored before KAN-176 have only `description`, one line a bullet.'''
    if lines := [b.strip() for b in getattr(item, "bullets", []) if b.strip()]:
        return lines
    return [
        line for line in (_MARKER.sub("", raw).strip() for raw in (item.description or "").splitlines())
        if line
    ]


def _description(bullets: list[str]) -> str | None:
    # Kept beside `bullets` so what reads only `description` (Scout's facts,
    # the profile's Work Experience) still sees every line
    return "\n".join(bullets) or None


def resume_to_entries(resume: ParsedResume) -> tuple[list[EntryDraft], list[SkillDraft]]:
    entries: list[EntryDraft] = []
    for e in resume.education:
        entries.append(EntryDraft(
            section=EntrySection.education,
            # The degree is the entry's name when there is one; the school
            # alone otherwise, since an entry always has a title
            title=e.degree or e.field_of_study or e.institution,
            organization=e.institution,
            location=e.location,
            start_date=e.start_date,
            end_date=e.end_date,
            bullets=bullets_of(e),
            details=EntryDetails(field_of_study=e.field_of_study, gpa=e.gpa),
        ))
    for x in resume.experience:
        entries.append(EntryDraft(
            section=EntrySection.experience, title=x.title, organization=x.company_name or None,
            location=x.location, start_date=x.start_date, end_date=x.end_date, bullets=bullets_of(x),
        ))
    for p in resume.projects:
        entries.append(EntryDraft(
            section=EntrySection.project, title=p.project_name, start_date=p.start_date,
            end_date=p.end_date, bullets=bullets_of(p),
            details=EntryDetails(url=p.url, technologies=p.technologies),
        ))
    for a in resume.activities:
        entries.append(EntryDraft(
            section=EntrySection.activity, title=a.role, organization=a.organization,
            location=a.location, start_date=a.start_date, end_date=a.end_date, bullets=bullets_of(a),
        ))
    for w in resume.awards:
        entries.append(EntryDraft(
            section=EntrySection.award, title=w.award_name, organization=w.issuer,
            end_date=w.end_date, bullets=bullets_of(w),
        ))
    for c in resume.certifications:
        entries.append(EntryDraft(
            section=EntrySection.certification, title=c.cert_name, organization=c.issuer,
            end_date=c.end_date,
        ))
    skills = [SkillDraft(name=s.skill_name, category=s.category) for s in resume.skills]
    return entries, skills


def bank_to_resume(entries: Iterable[EntryDraft], skills: Iterable[SkillDraft]) -> ParsedResume:
    '''In the order given: the caller picks and orders them.'''
    resume = ParsedResume(skills=[Skill(skill_name=s.name, category=s.category) for s in skills])
    for e in entries:
        lines = [b.strip() for b in e.bullets if b.strip()]
        match e.section:
            case EntrySection.education:
                resume.education.append(Education(
                    institution=e.organization or e.title,
                    degree=e.title if e.organization else None,
                    field_of_study=e.details.field_of_study,
                    gpa=e.details.gpa,
                    location=e.location,
                    start_date=e.start_date,
                    end_date=e.end_date,
                    bullets=lines,
                    description=_description(lines),
                ))
            case EntrySection.experience:
                resume.experience.append(Experience(
                    company_name=e.organization or "", title=e.title, location=e.location,
                    start_date=e.start_date, end_date=e.end_date, bullets=lines,
                    description=_description(lines),
                ))
            case EntrySection.project:
                resume.projects.append(Project(
                    project_name=e.title, url=e.details.url, technologies=e.details.technologies,
                    start_date=e.start_date, end_date=e.end_date, bullets=lines,
                    description=_description(lines),
                ))
            case EntrySection.activity:
                resume.activities.append(Activity(
                    organization=e.organization or "", role=e.title, location=e.location,
                    start_date=e.start_date, end_date=e.end_date, bullets=lines,
                    description=_description(lines),
                ))
            case EntrySection.award:
                resume.awards.append(Award(
                    award_name=e.title, issuer=e.organization, end_date=e.end_date,
                    description=_description(lines),
                ))
            case EntrySection.certification:
                resume.certifications.append(Certification(
                    cert_name=e.title, issuer=e.organization, end_date=e.end_date,
                ))
    return resume
