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
- **Bold and italic live in the resume's own wording** (KAN-435), as `**` and
  `*` around the words. `ViewBullet.text` is always the plain words, for every
  reader (Tailor, keywords, Word); only the PDF reads `marked`.
- **Order:** sections in `SECTIONS` order, then the sections the student
  named (KAN-498) in the bank's order, each entry by its choice's position
  within its section, each bullet by its position within its entry, skills
  by position. Ties keep the bank's order. An empty section is dropped. The
  GPA and coursework toggles blank those fields. Where the page prints each
  section is the page's (`resume_render.printed_order`), not the view's.
- **Custom sections group by name** (`custom_key`): two uploads that each
  hold a "Languages" section print one Languages heading. The section's
  `label` is its name as typed and `layout` how it prints ("entries" or
  "lines"), the first section's when names repeat. A custom entry is
  `section="custom"`, whichever section holds it.

Stdlib only, like the renderer: scripts/fetch_tectonic.py renders a fixed
view to warm Tectonic's cache before Vercel's build installs anything. So
`bank` is duck-typed (services/bank.py's Bank, or any object with the same
attributes) and sections travel as their string values.
'''

from __future__ import annotations

import datetime
import itertools
import re
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

# The bank's sections in resume order: models/dto.py's bank_section, whose
# members compare equal to these strings. Skills come last, as their own list.
SECTIONS = ("education", "experience", "projects", "leadership", "awards", "certifications")
# A section the student named (KAN-498): bank_section's `custom`
CUSTOM = "custom"


def custom_key(name: str) -> str:
    """A custom section's key in a view and in `PageSettings.section_order`:
    its name, ignoring case and spacing, so one name is one printed section."""
    return f"{CUSTOM}:{' '.join(name.casefold().split())}"

# The same pattern as the editor's text-marks.ts. A marker needs a letter
# beside it, so "5 * 3" and a lone "*" stay what they are
_MARK = re.compile(
    r"\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*"
    r"|\*\*(?=\S)(.+?)(?<=\S)\*\*"
    r"|\*(?=[^\s*])(.+?)(?<=[^\s*])\*"
)


def runs(text: str, bold: bool = False, italic: bool = False) -> list[tuple[str, bool, bool]]:
    '''A marked wording as (words, bold, italic), in order.'''
    found: list[tuple[str, bool, bool]] = []
    at = 0
    for match in _MARK.finditer(text):
        if match.start() > at:
            found.append((text[at:match.start()], bold, italic))
        group = match.lastindex
        found += runs(match[group], bold or group != 3, italic or group != 2)
        at = match.end()
    if at < len(text):
        found.append((text[at:], bold, italic))
    return found


def unmarked(text: str) -> str:
    return "".join(words for words, _, _ in runs(text))


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
    text: str  # the plain words
    marked: str | None = None  # the wording with its markers, when it has any


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
    section: str  # a fixed section, or a custom one's `custom_key`
    entries: tuple[ViewEntry, ...]
    # A custom section's name as the student typed it, and how it prints;
    # None on the fixed sections, which keeps their content hash as it was
    label: str | None = None
    layout: str | None = None


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


def _bullet(bullet: Any, wording: str | None) -> ViewBullet:
    # Only the resume's own wording is read for markers: the bank's text is
    # what the student or an upload wrote, stars and all
    if not wording:
        return ViewBullet(bullet.id, bullet.text)
    plain = unmarked(wording)
    return ViewBullet(bullet.id, plain, wording if plain != wording else None)


def build_view(bank: Any, choices: Choices) -> ResumeView:
    '''`bank` has `.entries` (each with `.row` and `.bullets`) and `.skills`,
    in the bank's order (services/bank.py's load_bank).'''
    by_id = {entry.row.id: entry for entry in bank.entries}
    # The custom sections, by key, in the bank's order: (name, layout, rows).
    # `sections` is duck-typed too, and absent from an older caller's bank.
    named = {s.id: s for s in getattr(bank, "sections", ())}
    groups: dict[str, tuple[str, str, list[Any]]] = {}
    for custom in named.values():
        groups.setdefault(custom_key(custom.name), (custom.name, custom.layout, []))
    for entry in bank.entries:
        custom = named.get(getattr(entry.row, "custom_section_id", None))
        if _str(entry.row.section) == CUSTOM and custom is not None:
            groups[custom_key(custom.name)][2].append(entry.row)
    sections = []
    every = [
        *((section, [e.row for e in bank.entries if _str(e.row.section) == section], None, None)
          for section in SECTIONS),
        *((key, rows, label, layout) for key, (label, layout, rows) in groups.items()),
    ]
    for section, rows, label, layout in every:
        kind = CUSTOM if label is not None else section
        entries = []
        for row in _ordered(rows, choices.entries):
            choice = choices.entries[row.id]
            bullets = _ordered(by_id[row.id].bullets, choices.bullets)
            entries.append(ViewEntry(
                id=row.id,
                section=kind,
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
                bullets=tuple(_bullet(b, choices.bullets[b.id].text) for b in bullets),
            ))
        if entries:
            sections.append(ViewSection(section, tuple(entries), label, layout))
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


# A sent resume's snapshot (KAN-267, docs/sent_resume.md) keeps a view as
# `dataclasses.asdict(view)` through JSON, which writes dates, decimals and
# ids as strings. These read them back.
_DATES = ("start_month", "end_month", "award_date")
_DECIMALS = ("gpa", "gpa_scale")


def view_from_json(data: Mapping[str, Any]) -> ResumeView:
    '''The inverse of `dataclasses.asdict(view)` after a JSON round trip:
    ISO dates back to `date`, GPA strings to `Decimal`, id strings to
    `UUID`, lists to tuples.'''
    def entry(e: Mapping[str, Any]) -> ViewEntry:
        return ViewEntry(**{
            **e,
            "id": uuid.UUID(e["id"]),
            **{k: datetime.date.fromisoformat(e[k]) if e[k] else None for k in _DATES},
            **{k: Decimal(e[k]) if e[k] is not None else None for k in _DECIMALS},
            "coursework": tuple(e["coursework"]),
            # A snapshot kept before KAN-435 has no "marked"
            "bullets": tuple(ViewBullet(uuid.UUID(b["id"]), b["text"], b.get("marked")) for b in e["bullets"]),
        })

    return ResumeView(
        # A snapshot kept before KAN-498 has no "label" or "layout"
        tuple(ViewSection(s["section"], tuple(entry(e) for e in s["entries"]), s.get("label"), s.get("layout"))
              for s in data["sections"]),
        tuple(ViewSkill(uuid.UUID(k["id"]), k["name"], k["group"]) for k in data["skills"]),
    )


def view_from_reading(entries: Iterable[Any], skills: Iterable[tuple[str, str | None]]) -> ResumeView:
    '''An uploaded resume as the parser read it (`bank_import.read`: draft
    entries and (name, group) skills) as a view, for the snapshot a sent
    resume keeps once its upload is replaced or deleted (KAN-267). Sections
    in resume order, entries and bullets in the file's, everything shown.
    Ids come from positions, as the sample resume's do, so the same text
    always gives the same view.'''
    ids = (uuid.UUID(int=n) for n in itertools.count(1))
    by_section: dict[str, list[ViewEntry]] = {}
    labels: dict[str, str] = {}
    for d in entries:
        section = _str(d.section) or ""
        key = section
        # A heading the bank has no section for (KAN-498): a Lines section
        if section == CUSTOM:
            name = getattr(d, "section_name", None)
            if not name:
                continue
            key = custom_key(name)
            labels.setdefault(key, name)
        by_section.setdefault(key, []).append(ViewEntry(
            id=next(ids), section=section, title=d.title, organization=d.organization, location=d.location,
            start_month=d.start_month, end_month=d.end_month, end_kind=_str(d.end_kind),
            degree=d.degree, field_of_study=d.field_of_study,
            # The draft's GPA is a float; a view's is a Decimal, as the bank's.
            gpa=None if d.gpa is None else Decimal(str(d.gpa)),
            gpa_scale=None if d.gpa_scale is None else Decimal(str(d.gpa_scale)),
            coursework=tuple(d.coursework), honors=d.honors, link=d.link, issuer=d.issuer,
            award_date=d.award_date,
            bullets=tuple(ViewBullet(next(ids), text) for text in d.bullets),
        ))
    return ResumeView(
        (*(ViewSection(s, tuple(by_section[s])) for s in SECTIONS if s in by_section),
         *(ViewSection(key, tuple(by_section[key]), name, "lines") for key, name in labels.items())),
        tuple(ViewSkill(next(ids), name, group) for name, group in skills),
    )
