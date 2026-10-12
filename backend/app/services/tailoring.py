'''
Tailoring a resume to one job posting (KAN-176), the parts with no database
or model: where each bullet is, and reordering a resume by how much of each
bullet and skill the posting talks about. routers/resume_builder.py scores
them (services/matching/overlap.py) and asks the model for rewordings.

Reordering only moves lines within their own item, and puts the skills the
posting mentions first; it never drops or invents a line. Nothing here
claims a skill the applicant hasn't listed: postings have no skill list to
compare against (services/matching/CLAUDE.md), so there are no "you're
missing X" flags.
'''
from dataclasses import dataclass

from app.models.dto import ParsedResume
from app.services.experience import bullets_of

# The sections whose items carry bullets, as named on ParsedResume
BULLETED = ("experience", "projects", "activities", "education")
# The model rewords this many of the most relevant bullets, no more: each one
# is a line the applicant has to read and accept
MAX_REWRITES = 6


@dataclass(frozen=True)
class Line:
    section: str
    item: int
    bullet: int
    text: str


def normalized(resume: ParsedResume) -> ParsedResume:
    '''A copy whose every bulleted item has its lines in `bullets`, so the
    rest of tailoring reads one field.'''
    copy = resume.model_copy(deep=True)
    for section in BULLETED:
        for item in getattr(copy, section):
            item.bullets = bullets_of(item)
            item.description = "\n".join(item.bullets) or None
    return copy


def lines(resume: ParsedResume) -> list[Line]:
    return [
        Line(section, i, j, text)
        for section in BULLETED
        for i, item in enumerate(getattr(resume, section))
        for j, text in enumerate(item.bullets)
    ]


def reorder(resume: ParsedResume, score: dict[str, float], skill_scores: list[float]) -> ParsedResume:
    '''Each item's bullets most relevant first, and the skills the posting
    mentions ahead of the rest; ties keep the applicant's order.'''
    out = resume.model_copy(deep=True)
    for section in BULLETED:
        for item in getattr(out, section):
            item.bullets = sorted(item.bullets, key=lambda b: -score.get(b, 0.0))
            item.description = "\n".join(item.bullets) or None
    ranked = sorted(zip(out.skills, skill_scores, strict=True), key=lambda pair: pair[1] <= 0)
    out.skills = [skill for skill, _ in ranked]
    return out


def to_reword(resume: ParsedResume, score: dict[str, float]) -> list[Line]:
    '''The bullets worth rewording: those the posting talks about most.'''
    relevant = [line for line in lines(resume) if score.get(line.text, 0.0) > 0]
    return sorted(relevant, key=lambda line: -score[line.text])[:MAX_REWRITES]
