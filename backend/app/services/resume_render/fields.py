'''
How a view's fields read as resume text, shared by the PDF templates and the
Word file so the two always say the same thing. Plain text out: each layout
escapes or styles it itself. Stdlib only, like the rest of this package.
'''

import datetime
from dataclasses import dataclass
from decimal import Decimal

from app.services.resume_view import ViewEntry

SECTION_LABELS = {
    "education": "Education",
    "experience": "Experience",
    "projects": "Projects",
    "leadership": "Leadership & Activities",
    "awards": "Awards",
    "certifications": "Certifications",
}
SKILLS_LABEL = "Technical Skills"
# Jake's own spelling of months: "Aug. 2018", "June 2020", "Sep. 2018"
_MONTHS = ("Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sep.", "Oct.", "Nov.", "Dec.")
# Sections whose heading is two rows (title and place, then subtitle and
# dates); the rest are one row, title and a tag, with the dates at the right.
TWO_ROW = {"education", "experience", "leadership"}


def month(day: datetime.date) -> str:
    return f"{_MONTHS[day.month - 1]} {day.year}"


def dates(entry: ViewEntry) -> str:
    '''"Aug. 2018 – May 2021", "June 2020 – Present", "Expected May 2027",
    or "" when the entry has no dates.'''
    if entry.section == "awards":
        return month(entry.award_date) if entry.award_date else ""
    if entry.end_kind == "present":
        end = "Present"
    elif entry.end_month:
        end = ("Expected " if entry.end_kind == "expected" else "") + month(entry.end_month)
    else:
        end = ""
    start = month(entry.start_month) if entry.start_month else ""
    return f"{start} – {end}" if start and end else start or end


def _number(value: Decimal) -> str:
    # 3.80 -> "3.8", 4.00 -> "4.0", 3.85 -> "3.85"
    text = f"{value:f}".rstrip("0")
    return text + "0" if text.endswith(".") else text


def gpa(entry: ViewEntry) -> str | None:
    if entry.gpa is None:
        return None
    score = _number(entry.gpa)
    scale = ""
    if entry.gpa_scale is not None:
        # the scale as precise as the GPA: "3.81/4.00", "3.8/4.0"
        places = len(score.partition(".")[2])
        scale = "/" + max(_number(entry.gpa_scale), f"{entry.gpa_scale:.{places}f}", key=len)
    return f"GPA: {score}{scale}"


@dataclass(frozen=True)
class Heading:
    '''An entry's heading. Two-row sections use all four slots; one-row
    sections show `title` and `tag` on the left and `right` at the right.'''

    title: str
    right: str = ""
    subtitle: str = ""
    subright: str = ""
    tag: str = ""


def heading(entry: ViewEntry) -> Heading:
    when = dates(entry)
    if entry.section == "education":
        degree = " in ".join(x for x in (entry.degree, entry.field_of_study) if x)
        subtitle = ", ".join(x for x in (degree, entry.organization) if x)
        return Heading(entry.title, entry.location or "", subtitle, when)
    if entry.section in TWO_ROW:
        return Heading(entry.title, when, entry.organization or "", entry.location or "")
    if entry.section == "certifications":
        tag = entry.issuer or entry.organization or ""
    else:  # projects, awards
        tag = " | ".join(x for x in (entry.organization, entry.link) if x)
    return Heading(entry.title, when, tag=tag)


def heading_fields(section: str) -> dict[str, str]:
    '''Which entry field each of heading()'s slots shows, by slot name: the
    `kind` of the slot's click target in the editor (KAN-209). Education's
    subtitle is the degree line, which also names the school.'''
    if section == "education":
        return {"title": "title", "right": "location", "subtitle": "degree", "subright": "dates"}
    if section in TWO_ROW:
        return {"title": "title", "right": "dates", "subtitle": "organization", "subright": "location"}
    return {"title": "title", "tag": "organization", "right": "dates"}


def details(entry: ViewEntry) -> list[tuple[str, str]]:
    '''(kind, line) for each line shown above an entry's bullets:
    Education's GPA, coursework and honors.'''
    lines = []
    if score := gpa(entry):
        lines.append(("gpa", score))
    if entry.coursework:
        lines.append(("coursework", "Relevant Coursework: " + ", ".join(entry.coursework)))
    if entry.honors:
        lines.append(("honors", "Honors: " + entry.honors))
    return lines


def skill_lines(skills) -> list[tuple[str, tuple]]:
    '''(label, skills) per group, in the order groups first appear; a layout
    joins the names with ", ". Ungrouped skills are "Other" beside groups,
    or unlabeled ("") alone.'''
    groups: dict[str | None, list] = {}
    for skill in skills:
        groups.setdefault(skill.group, []).append(skill)
    if list(groups) == [None]:
        return [("", tuple(groups[None]))]
    return [(group or "Other", tuple(members)) for group, members in groups.items()]


def link_text(url: str) -> str:
    '''How a link prints: no scheme, no "www.", no trailing slash.'''
    for prefix in ("https://", "http://", "mailto:"):
        if url.lower().startswith(prefix):
            url = url[len(prefix):]
    if url.lower().startswith("www."):
        url = url[4:]
    return url.rstrip("/")
