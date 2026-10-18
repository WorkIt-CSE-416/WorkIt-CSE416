"""
What the recommender reads from an experience bank (KAN-212): the text the
bank embedding is made from, the skills and titles the other scores use, the
years of experience and the expected graduation date. Pure functions over a
loaded `services.bank.Bank`; no DB, no HTTP.
"""

import datetime

from workit_scout.identity import Identity

from app.models.dto import bank_section, entry_end_kind
from app.services.bank import Bank, Entry

MAX_CHARS = 6000

_LABEL = {
    bank_section.education: "Education",
    bank_section.experience: "Experience",
    bank_section.projects: "Projects",
    bank_section.leadership: "Leadership & Activities",
    bank_section.awards: "Awards",
    bank_section.certifications: "Certifications",
}


def _newest_first(entry: Entry) -> tuple:
    row = entry.row

    def back(day: datetime.date | None) -> int:
        return -day.toordinal() if day else 0

    return (
        row.end_kind is not entry_end_kind.present,
        back(row.end_month or row.award_date),
        back(row.start_month),
    )


def bank_text(bank: Bank, *, identity: Identity) -> str:
    """
    Embed skills, work experience, and projects using original bullets.
    """
    lines = []
    if bank.skills:
        lines.append("Skills: " + ", ".join(s.name for s in bank.skills))

    included_sections = {
        bank_section.experience,
        bank_section.projects,
    }
    entries = [
        entry
        for entry in bank.entries
        if entry.row.section in included_sections
    ]

    for e in sorted(entries, key=_newest_first):
        head = ", ".join(filter(None, (e.row.title, e.row.organization)))
        lines.append(f"{_LABEL[e.row.section]}: {head}")
        lines.extend(f"- {b.text}" for b in e.bullets)
    return identity.remove("\n".join(lines))[:MAX_CHARS].rstrip()


def skills(bank: Bank) -> list[str]:
    return [s.name for s in bank.skills]


def titles(bank: Bank) -> list[str]:
    """Experience titles, for title fit."""
    return [e.row.title for e in bank.entries if e.row.section is bank_section.experience]


def field_of_study(bank: Bank) -> str | None:
    return next(
        (e.row.field_of_study for e in bank.entries if e.row.field_of_study), None
    )


def _months(start: datetime.date, end: datetime.date) -> int:
    """Months from start to end, both counted: Jun to Aug is three."""
    return (end.year - start.year) * 12 + end.month - start.month + 1


def years_of_experience(bank: Bank, today: datetime.date) -> float:
    """
    Summed over Experience entries only. An ongoing entry counts up to this
    month; an end still to come counts only up to this month too. An entry
    with no start month adds nothing.
    """
    months = 0
    for e in bank.entries:
        row = e.row
        if row.section is not bank_section.experience or row.start_month is None:
            continue
        end = today if row.end_kind is entry_end_kind.present else row.end_month
        if end is None:
            continue
        months += max(0, _months(row.start_month, min(end, today)))
    return months / 12

# Check for eligibility
def expected_graduation(bank: Bank) -> datetime.date | None:
    """The latest end month on an Education entry, past or expected."""
    ends = [
        e.row.end_month
        for e in bank.entries
        if e.row.section is bank_section.education and e.row.end_month
    ]
    return max(ends, default=None)
