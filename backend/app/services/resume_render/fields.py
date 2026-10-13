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
    scale = f"/{_number(entry.gpa_scale)}" if entry.gpa_scale is not None else ""
    return f"GPA: {_number(entry.gpa)}{scale}"


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


def details(entry: ViewEntry) -> list[str]:
    '''Lines shown above an entry's bullets: Education's GPA, coursework
    and honors.'''
    lines = []
    if score := gpa(entry):
        lines.append(score)
    if entry.coursework:
        lines.append("Relevant Coursework: " + ", ".join(entry.coursework))
    if entry.honors:
        lines.append("Honors: " + entry.honors)
    return lines


def skill_lines(skills) -> list[tuple[str, str]]:
    '''(label, "a, b, c") per group, in the order groups first appear.
    Ungrouped skills are "Other" beside groups, or unlabeled ("") alone.'''
    groups: dict[str | None, list[str]] = {}
    for skill in skills:
        groups.setdefault(skill.group, []).append(skill.name)
    if list(groups) == [None]:
        return [("", ", ".join(groups[None]))]
    return [(group or "Other", ", ".join(names)) for group, names in groups.items()]


def link_text(url: str) -> str:
    '''How a link prints: no scheme, no "www.", no trailing slash.'''
    for prefix in ("https://", "http://", "mailto:"):
        if url.lower().startswith(prefix):
            url = url[len(prefix):]
    if url.lower().startswith("www."):
        url = url[4:]
    return url.rstrip("/")
