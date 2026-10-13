"""Fit to One Page's order (resume_view.fit_order, KAN-218), on a view
alone: no database, no render."""

import uuid

from app.services.resume_view import (
    ResumeView,
    ViewBullet,
    ViewEntry,
    ViewSection,
    fit_order,
)


def _view(**sections: list[int]) -> tuple[ResumeView, dict[uuid.UUID, str]]:
    """Each section's entries by bullet count, top first. Returns the view
    and a name for every id ("experience0", "experience0.b2")."""
    names: dict[uuid.UUID, str] = {}
    built = []
    for section, counts in sections.items():
        entries = []
        for k, count in enumerate(counts):
            bullets = tuple(ViewBullet(uuid.uuid4(), "line") for _ in range(count))
            entry = ViewEntry(id=uuid.uuid4(), section=section, title="t",
                              coursework=("Algorithms",) if section == "education" else (), bullets=bullets)
            names[entry.id] = f"{section}{k}"
            names.update((b.id, f"{section}{k}.b{j}") for j, b in enumerate(bullets))
            entries.append(entry)
        built.append(ViewSection(section, tuple(entries)))
    return ResumeView(tuple(built)), names


def _order(**sections: list[int]) -> list[str]:
    view, names = _view(**sections)
    return [f"{c.kind}:{names[c.id]}" for c in fit_order(view)]


def test_coursework_goes_first_and_education_and_first_bullets_never_go():
    order = _order(education=[0], experience=[6, 5], projects=[4, 4], leadership=[3, 3])
    assert order[0] == "coursework:education0"
    assert not any("education0" in o and not o.startswith("coursework") for o in order)
    assert not any(o.endswith(".b0") for o in order)
    # The top entry of Experience and of Projects always stays
    assert "entry:experience0" not in order and "entry:projects0" not in order


def test_every_section_gives_a_little_before_any_is_cut_deep():
    order = _order(experience=[8, 8], projects=[8], leadership=[8])
    first_round = order[: order.index("bullet:experience0.b5") + 1]
    # Leadership down to 2, Projects to 3 and the older job to 4 before the
    # newest job loses its 6th bullet, and none is down to 1 yet
    assert "bullet:leadership0.b2" in first_round and "bullet:leadership0.b1" not in first_round
    assert "bullet:projects0.b3" in first_round and "bullet:projects0.b2" not in first_round
    assert "bullet:experience1.b4" in first_round and "bullet:experience1.b3" not in first_round


def test_a_weak_entry_goes_whole_before_the_newest_job_drops_below_three():
    order = _order(experience=[6, 6, 6, 6, 6], projects=[4, 4, 4, 4], leadership=[3, 3, 3])
    assert order.index("entry:leadership2") < order.index("bullet:experience0.b2")
    assert order.index("entry:projects3") < order.index("bullet:experience0.b2")
    # The bottom entry before the one above it
    assert order.index("entry:leadership2") < order.index("entry:leadership1")


def test_coursework_stays_when_there_is_no_experience():
    assert "coursework:education0" not in _order(education=[0], projects=[4, 4], leadership=[3])
