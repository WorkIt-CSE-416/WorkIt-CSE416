"""Add Bullet in the resume editor (KAN-435), as far as it needs no database:
the change the editor sends after the bank takes the new bullet, made to the
editor's copy. A row-less bullet gets its row, its place among its siblings
and any bold or italic, and the bank keeps the plain words."""

import uuid
from types import SimpleNamespace

from app.services.built_resumes import apply_choices
from app.services.resume_view import BulletChoice, Choices, EntryChoice, build_view

ENTRY = uuid.uuid4()
FIRST, SECOND, NEW = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def _bank() -> SimpleNamespace:
    row = SimpleNamespace(
        id=ENTRY, section="experience", title="Intern", organization=None, location=None, start_month=None,
        end_month=None, end_kind=None, degree=None, field_of_study=None, gpa=None, gpa_scale=None, coursework=[],
        honors=None, link=None, issuer=None, award_date=None,
    )
    bullets = [SimpleNamespace(id=b, text=t) for b, t in ((FIRST, "First"), (SECOND, "Second"), (NEW, "Led a team"))]
    return SimpleNamespace(entries=[SimpleNamespace(row=row, bullets=bullets)], skills=[])


def _shown(choices: Choices) -> list:
    return build_view(_bank(), choices).sections[0].entries[0].bullets


# The new bullet has no row yet: it joined the bank a moment ago
BEFORE = Choices(
    entries={ENTRY: EntryChoice()},
    bullets={FIRST: BulletChoice(position=0), SECOND: BulletChoice(position=1)},
)


def test_a_new_bullet_lands_after_the_open_one():
    changes = [
        {"bullet_id": FIRST, "position": 0},
        {"bullet_id": NEW, "position": 1, "shown": True},
        {"bullet_id": SECOND, "position": 2},
    ]
    assert [b.text for b in _shown(apply_choices(_bank(), BEFORE, bullets=changes))] == [
        "First", "Led a team", "Second",
    ]


def test_a_new_bullet_keeps_its_bold_on_this_resume_alone():
    changes = [{"bullet_id": NEW, "position": 2, "shown": True, "text": "Led **a team**"}]
    bullet = _shown(apply_choices(_bank(), BEFORE, bullets=changes))[2]
    assert bullet.text == "Led a team"
    assert bullet.marked == "Led **a team**"


def test_undo_hides_it_and_redo_shows_it():
    made = apply_choices(_bank(), BEFORE, bullets=[{"bullet_id": NEW, "position": 2, "shown": True}])
    hidden = apply_choices(_bank(), made, bullets=[{"bullet_id": NEW, "shown": False}])
    assert [b.id for b in _shown(hidden)] == [FIRST, SECOND]
    shown = apply_choices(_bank(), hidden, bullets=[{"bullet_id": NEW, "position": 2, "shown": True}])
    assert [b.id for b in _shown(shown)] == [FIRST, SECOND, NEW]
