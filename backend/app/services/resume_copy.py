"""
The editor's copy of what its PDF is built from (KAN-391,
`schemas/built_resume.py`'s ResumeCopy), read back into what `build_view`
and `render` take, so an edit's PDF compiles with no database read first.
Pure.

    from_copy(copy) -> (bank, choices, identity)
    identity_copy(identity) -> IdentityCopy, for every render's answer

The bank comes back as plain objects with the attributes `build_view` and
`bank.edit_entry` read (`.entries`, each `.row` and `.bullets`, and
`.skills`), never as rows: nothing here can reach the database.
"""

from decimal import Decimal
from types import SimpleNamespace

from app.schemas.bank import EntryFields
from app.schemas.built_resume import IdentityCopy, ResumeCopy
from app.services.resume_render import HeaderIdentity
from app.services.resume_view import BulletChoice, Choices, EntryChoice, SkillChoice


def _grade(value: float | None) -> Decimal | None:
    # The API sends a GPA as a float; the PDF prints a Decimal's digits
    return None if value is None else Decimal(str(value))


def from_copy(copy: ResumeCopy):
    entries = []
    for entry in copy.entries:
        fields = {name: getattr(entry, name) for name in EntryFields.model_fields}
        fields.update(gpa=_grade(entry.gpa), gpa_scale=_grade(entry.gpa_scale))
        row = SimpleNamespace(id=entry.id, **fields)
        bullets = [SimpleNamespace(id=b.id, text=b.text) for b in sorted(entry.bullets, key=lambda b: b.position)]
        entries.append(SimpleNamespace(row=row, bullets=bullets))
    bank = SimpleNamespace(
        entries=entries,
        skills=[SimpleNamespace(id=s.id, name=s.name, group=s.group) for s in copy.skills],
    )
    c = copy.choices
    choices = Choices(
        entries={e.entry_id: EntryChoice(e.shown, e.position, e.show_gpa, e.show_coursework) for e in c.entries},
        bullets={b.bullet_id: BulletChoice(b.shown, b.position, b.variant_id, b.text) for b in c.bullets},
        skills={s.skill_id: SkillChoice(s.shown, s.position) for s in c.skills},
    )
    i = copy.identity
    identity = HeaderIdentity(
        name=i.name, email=i.email, phone=i.phone, links=tuple(tuple(link) for link in i.links),
        us_citizen=i.us_citizen,
    )
    return bank, choices, identity


def identity_copy(identity: HeaderIdentity) -> IdentityCopy:
    return IdentityCopy(
        name=identity.name, email=identity.email, phone=identity.phone,
        links=[tuple(link) for link in identity.links], us_citizen=identity.us_citizen,
    )
