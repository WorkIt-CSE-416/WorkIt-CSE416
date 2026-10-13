'''
The built resume view (KAN-207): one pure function from the experience bank
and one built resume's choices to the ordered content a resume shows.

    build_view(bank, choices) -> ResumeView

The renderer, the Word file, Generate, Tailor, the sent resume's content hash
and the editor all read this one shape, so a rule about what shows lives here
and nowhere else:

- **No choice row, not on the resume.** An entry, bullet or skill with no
  row in `choices` is left out (it waits in the editor's tray), so what is
  added to the bank after Generate never appears on an older resume by
  itself. A row with `shown=False` is left out too.
- **Text is always the bank's** (ADR 0001): a fix in the bank shows on every
  built resume. A bullet whose choice names a variant (Tailor's wording, or
  the resume's own) shows that variant's text instead; `BulletChoice.text`
  carries it, loaded with the choice.
- **Order:** sections in `SECTIONS` order, each entry by its choice's
  position within its section, each bullet by its position within its
  entry, skills by position. Ties keep the bank's order. An empty section is
  dropped. The GPA and coursework toggles blank those fields.

Stdlib only, like the renderer: scripts/fetch_tectonic.py renders a fixed
view to warm Tectonic's cache before Vercel's build installs anything. So
`bank` is duck-typed (services/bank.py's Bank, or any object with the same
attributes) and sections travel as their string values.
'''

from __future__ import annotations

import datetime
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

# The bank's sections in resume order: models/dto.py's bank_section, whose
# members compare equal to these strings. Skills come last, as their own list.
SECTIONS = ("education", "experience", "projects", "leadership", "awards", "certifications")


@dataclass(frozen=True)
class EntryChoice:
    shown: bool = True
    position: int = 0
    show_gpa: bool = True
    show_coursework: bool = True


@dataclass(frozen=True)
class BulletChoice:
    shown: bool = True
    position: int = 0
    variant_id: uuid.UUID | None = None
    text: str | None = None  # the variant's wording; None shows the original


@dataclass(frozen=True)
class SkillChoice:
    shown: bool = True
    position: int = 0


@dataclass(frozen=True)
class Choices:
    '''One built resume's choice rows, keyed by the bank item's id.'''

    entries: Mapping[uuid.UUID, EntryChoice] = field(default_factory=dict)
    bullets: Mapping[uuid.UUID, BulletChoice] = field(default_factory=dict)
    skills: Mapping[uuid.UUID, SkillChoice] = field(default_factory=dict)


@dataclass(frozen=True)
class ViewBullet:
    id: uuid.UUID
    text: str


@dataclass(frozen=True)
class ViewEntry:
    id: uuid.UUID
    section: str
    title: str
    organization: str | None = None
    location: str | None = None
    start_month: datetime.date | None = None
    end_month: datetime.date | None = None
    end_kind: str | None = None  # "month", "present", "expected"
    degree: str | None = None
    field_of_study: str | None = None
    gpa: Decimal | None = None
    gpa_scale: Decimal | None = None
    coursework: tuple[str, ...] = ()
    honors: str | None = None
    link: str | None = None
    issuer: str | None = None
    award_date: datetime.date | None = None
    bullets: tuple[ViewBullet, ...] = ()


@dataclass(frozen=True)
class ViewSection:
    section: str
    entries: tuple[ViewEntry, ...]


@dataclass(frozen=True)
class ViewSkill:
    id: uuid.UUID
    name: str
    group: str | None = None


@dataclass(frozen=True)
class ResumeView:
    sections: tuple[ViewSection, ...] = ()
    skills: tuple[ViewSkill, ...] = ()


def _str(value: Any) -> str | None:
    # A StrEnum member (bank_section, entry_end_kind) as its plain value
    return None if value is None else str(value)


def _ordered(items: Iterable[Any], key: Mapping[uuid.UUID, Any]) -> list[Any]:
    '''The items that have a shown choice, by position; sorted() is stable,
    so ties keep the bank's order.'''
    chosen = [item for item in items if item.id in key and key[item.id].shown]
    return sorted(chosen, key=lambda item: key[item.id].position)


def build_view(bank: Any, choices: Choices) -> ResumeView:
    '''`bank` has `.entries` (each with `.row` and `.bullets`) and `.skills`,
    in the bank's order (services/bank.py's load_bank).'''
    by_id = {entry.row.id: entry for entry in bank.entries}
    sections = []
    for section in SECTIONS:
        rows = [e.row for e in bank.entries if _str(e.row.section) == section]
        entries = []
        for row in _ordered(rows, choices.entries):
            choice = choices.entries[row.id]
            bullets = _ordered(by_id[row.id].bullets, choices.bullets)
            entries.append(ViewEntry(
                id=row.id,
                section=section,
                title=row.title,
                organization=row.organization,
                location=row.location,
                start_month=row.start_month,
                end_month=row.end_month,
                end_kind=_str(row.end_kind),
                degree=row.degree,
                field_of_study=row.field_of_study,
                gpa=row.gpa if choice.show_gpa else None,
                gpa_scale=row.gpa_scale if choice.show_gpa else None,
                coursework=tuple(row.coursework or ()) if choice.show_coursework else (),
                honors=row.honors,
                link=row.link,
                issuer=row.issuer,
                award_date=row.award_date,
                bullets=tuple(ViewBullet(b.id, choices.bullets[b.id].text or b.text) for b in bullets),
            ))
        if entries:
            sections.append(ViewSection(section, tuple(entries)))
    skills = tuple(ViewSkill(s.id, s.name, s.group) for s in _ordered(bank.skills, choices.skills))
    return ResumeView(tuple(sections), skills)


def all_chosen(bank: Any) -> Choices:
    '''What Generate writes: every entry, bullet and skill, shown, in the
    bank's own order (entries numbered within their section).'''
    entries: dict[uuid.UUID, EntryChoice] = {}
    counts: dict[str, int] = {}
    bullets: dict[uuid.UUID, BulletChoice] = {}
    for entry in bank.entries:
        section = _str(entry.row.section) or ""
        entries[entry.row.id] = EntryChoice(position=counts.get(section, 0))
        counts[section] = counts.get(section, 0) + 1
        for i, bullet in enumerate(entry.bullets):
            bullets[bullet.id] = BulletChoice(position=i)
    skills = {skill.id: SkillChoice(position=i) for i, skill in enumerate(bank.skills)}
    return Choices(entries, bullets, skills)


# Fit to One Page (KAN-218): what it cuts, least useful first. A base resume
# has no job posting to rank against, so section and place stand in for
# relevance: Leadership & Activities, Awards and Certifications give way
# before Projects, Projects before Experience, and within a section the
# bottom (oldest) entry before the top. Career-centre advice the order
# follows: drop coursework once there is experience, keep 3 to 5 bullets on
# the newest roles and 1 or 2 on older ones, and drop a weak entry whole
# rather than cut every entry to one line (the first rule hid bullets
# section by section and left a long resume a list of one-line entries).
# Education and Skills are never cut, nor an entry's first bullet, nor the
# top entry of Experience or Projects.
LOW_SECTIONS = ("leadership", "awards", "certifications")
FIT_SECTIONS = (*LOW_SECTIONS, "projects", "experience")


def _caps(experience: tuple[int, int], projects: tuple[int, int], low: tuple[int, int]) -> dict:
    return {"experience": experience, "projects": projects, **dict.fromkeys(LOW_SECTIONS, low)}


def _keep(experience: int, projects: int, low: int) -> dict:
    return {"experience": experience, "projects": projects, **dict.fromkeys(LOW_SECTIONS, low)}


# Each step, in order: hide coursework, cap each entry's bullets (the top
# entry's cap, then every other entry's), or keep only the top entries of
# each section. A step runs only past what the steps before it cut.
FIT_STEPS = (
    ("coursework", None),
    ("bullets", _caps((5, 4), (3, 3), (2, 2))),
    ("bullets", _caps((4, 3), (3, 2), (1, 1))),
    ("entries", _keep(4, 3, 2)),
    ("bullets", _caps((3, 2), (2, 2), (1, 1))),
    ("entries", _keep(3, 2, 1)),
    ("bullets", _caps((3, 2), (2, 1), (1, 1))),
    ("entries", _keep(2, 1, 0)),
    ("bullets", _caps((2, 1), (1, 1), (1, 1))),
)


@dataclass(frozen=True)
class Cut:
    '''One thing Fit to One Page hides: a bullet, a whole entry, or an
    entry's coursework line (`kind` "bullet", "entry" or "coursework").'''

    kind: str
    id: uuid.UUID


def fit_order(view: ResumeView) -> list[Cut]:
    '''What Fit to One Page hides from this view, in the order it hides
    it (FIT_STEPS). Within a step: sections least useful first, the bottom
    entry first, an entry's last bullet first.'''
    by_section = {s.section: s.entries for s in view.sections}
    shown = {e.id: list(e.bullets) for entries in by_section.values() for e in entries}
    gone: set[uuid.UUID] = set()
    order: list[Cut] = []
    for kind, limits in FIT_STEPS:
        if kind == "coursework":
            order.extend(Cut(kind, e.id) for e in reversed(by_section.get("education", ())) if e.coursework)
            continue
        for section in FIT_SECTIONS:
            entries = [e for e in by_section.get(section, ()) if e.id not in gone]
            if kind == "entries":
                floor = 0 if section in LOW_SECTIONS else 1
                for entry in reversed(entries[max(limits[section], floor):]):
                    gone.add(entry.id)
                    order.append(Cut("entry", entry.id))
                continue
            for rank, entry in reversed(list(enumerate(entries))):
                cap = max(1, limits[section][0 if rank == 0 else 1])
                while len(shown[entry.id]) > cap:
                    order.append(Cut("bullet", shown[entry.id].pop().id))
    return order
