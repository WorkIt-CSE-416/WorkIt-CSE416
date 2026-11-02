"""Bold and italic in a resume's own wording (KAN-435): the plain words reach
every reader, and only the PDF sets the marked ones."""

import dataclasses
import json
import uuid
from types import SimpleNamespace

from app.services import sent_resumes
from app.services.resume_render import jakes
from app.services.resume_render.sample import IDENTITY
from app.services.resume_view import (
    BulletChoice,
    Choices,
    EntryChoice,
    ResumeView,
    ViewBullet,
    build_view,
    runs,
    unmarked,
    view_from_json,
)
from app.services.sent_resumes import content_hash


def _view(wording: str | None, text: str = "Built an API") -> ResumeView:
    entry_id, bullet_id = uuid.uuid4(), uuid.uuid4()
    row = SimpleNamespace(
        id=entry_id, section="experience", title="Intern", organization=None, location=None, start_month=None,
        end_month=None, end_kind=None, degree=None, field_of_study=None, gpa=None, gpa_scale=None, coursework=[],
        honors=None, link=None, issuer=None, award_date=None,
    )
    bank = SimpleNamespace(
        entries=[SimpleNamespace(row=row, bullets=[SimpleNamespace(id=bullet_id, text=text)])], skills=[],
    )
    return build_view(bank, Choices(
        entries={entry_id: EntryChoice()}, bullets={bullet_id: BulletChoice(text=wording)},
    ))


def _bullet(view: ResumeView) -> ViewBullet:
    return view.sections[0].entries[0].bullets[0]


def test_runs_reads_each_mark_and_leaves_lone_stars():
    assert runs("a **b** *c* ***d***") == [
        ("a ", False, False), ("b", True, False), (" ", False, False), ("c", False, True),
        (" ", False, False), ("d", True, True),
    ]
    assert unmarked("**a *b* c**") == "a b c"
    assert unmarked("5 * 3 and a lone * here") == "5 * 3 and a lone * here"


def test_the_view_carries_plain_words_and_keeps_the_marks_apart():
    bullet = _bullet(_view("Built a **REST** API"))
    assert bullet.text == "Built a REST API"
    assert bullet.marked == "Built a **REST** API"


def test_the_banks_own_text_is_never_read_for_marks():
    bullet = _bullet(_view(None, text="Rated *five* stars"))
    assert bullet == dataclasses.replace(bullet, text="Rated *five* stars", marked=None)


def test_the_pdf_sets_the_marked_words_and_escapes_them():
    printed: dict[str, str] = {}
    view = _view(r"Cut **costs & time** by *50%*")
    body = jakes.body(view, IDENTITY, printed=printed)
    assert r"\textbf{costs \& time}" in body
    assert r"\textit{50\%}" in body
    # The box keeps the markers: the editor opens the line on them
    assert printed[f"{_bullet(view).id}.bullet"] == "Cut **costs & time** by *50%*"


def test_a_snapshot_keeps_the_marks_and_reads_an_older_one():
    view = _view("Built **APIs**")
    assert view_from_json(_json(view)) == view
    older = _json(view)
    del older["sections"][0]["entries"][0]["bullets"][0]["marked"]
    assert _bullet(view_from_json(older)).marked is None


def test_marks_change_the_sent_hash_and_no_marks_keep_the_old_one(monkeypatch):
    plain = _view("Built APIs")
    marked_plain = dataclasses.replace(
        plain,
        sections=(dataclasses.replace(plain.sections[0], entries=(dataclasses.replace(
            plain.sections[0].entries[0],
            bullets=(dataclasses.replace(_bullet(plain), marked="Built **APIs**"),),
        ),)),),
    )
    assert content_hash(plain, IDENTITY, "jakes") != content_hash(marked_plain, IDENTITY, "jakes")

    hashed: list[str] = []
    dumps = sent_resumes.json.dumps
    monkeypatch.setattr(sent_resumes.json, "dumps", lambda *a, **k: hashed.append(dumps(*a, **k)) or hashed[-1])
    content_hash(plain, IDENTITY, "jakes")
    assert '"marked"' not in hashed[0]


def _json(view: ResumeView) -> dict:
    return json.loads(json.dumps(dataclasses.asdict(view), default=str))
