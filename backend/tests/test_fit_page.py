"""Fit to One Page's plan, check and loop (services/fit_page.py, KAN-320,
docs/cut_to_one_page.md). The plan and the check run on a view alone, with
no database and no render; the last tests render real resumes with
Tectonic and skip without it."""

import asyncio
import dataclasses
import uuid

import pytest

from app.services.fit_page import (
    Cut,
    Page,
    Scores,
    apply_cuts,
    fit,
    plan,
    skill_levels,
)
from app.services.resume_render import Box, Rendered, Shrink, TextArea, render, sample
from app.services.resume_view import (
    ResumeView,
    ViewBullet,
    ViewEntry,
    ViewSection,
    ViewSkill,
)
from app.services.tailor import rank_shown
from tests.test_resume_render import _tectonic_or_skip


class _Layout:
    """A stand-in for one render's measure, as `plan` reads it: which skill
    lines and bullets wrap. A wrapped skill line fits on one line once it
    keeps `fits` skills."""

    def __init__(self, view: ResumeView, wrapped_lines=(), wrapped_bullets=(), fits=2):
        groups: dict = {}
        for skill in view.skills:
            groups.setdefault(skill.group, []).append(skill)
        self._rows = [(g or "", tuple(s)) for g, s in groups.items()]
        self._wrapped_lines, self._wrapped_bullets, self._fits = set(wrapped_lines), set(wrapped_bullets), fits

    def rows(self):
        return self._rows

    def row_lines(self, index):
        return 2 if index in self._wrapped_lines else 1

    def fits_one_line(self, index, kept):
        return index not in self._wrapped_lines or len(kept) <= self._fits

    def wrapped(self, bullet_id):
        return bullet_id in self._wrapped_bullets


def _view(skills: dict[str, int] | None = None, **sections: list[int]) -> tuple[ResumeView, dict[uuid.UUID, str]]:
    """Each section's entries by bullet count, top first, and skill lines
    by skill count. Returns the view and a name for every id
    ("experience0", "experience0.b2", "Languages.s1")."""
    names: dict[uuid.UUID, str] = {}
    built = []
    for section, counts in sections.items():
        entries = []
        for k, count in enumerate(counts):
            bullets = tuple(ViewBullet(uuid.uuid4(), f"line {j}") for j in range(count))
            entry = ViewEntry(id=uuid.uuid4(), section=section, title="t", bullets=bullets)
            names[entry.id] = f"{section}{k}"
            names.update((b.id, f"{section}{k}.b{j}") for j, b in enumerate(bullets))
            entries.append(entry)
        built.append(ViewSection(section, tuple(entries)))
    skill_list = []
    for group, count in (skills or {}).items():
        for j in range(count):
            skill = ViewSkill(uuid.uuid4(), f"{group}{j}", group)
            names[skill.id] = f"{group}.s{j}"
            skill_list.append(skill)
    return ResumeView(tuple(built), tuple(skill_list)), names


def _names(steps, names) -> list[str]:
    return ["+".join(f"{c.kind}:{names[c.id]}" for c in step) for step in steps]


def test_bullets_go_to_two_then_one_section_by_section_before_any_entry():
    view, names = _view(experience=[4, 4], projects=[3], leadership=[3], awards=[3])
    order = _names(plan(view, None, _Layout(view)), names)
    to_two = order[:order.index("bullet:experience0.b2") + 1]
    # Awards, then Leadership, then Projects, then Experience, the bottom
    # entry's last bullet first
    assert to_two == ["bullet:awards0.b2", "bullet:leadership0.b2", "bullet:projects0.b2",
                      "bullet:experience1.b3", "bullet:experience1.b2",
                      "bullet:experience0.b3", "bullet:experience0.b2"]
    # Then every entry down to one bullet, in the same order
    assert order[len(to_two)] == "bullet:awards0.b1"
    assert order.index("bullet:experience0.b1") < order.index("entry:leadership0")
    assert not any(o.startswith("entry:") for o in order[:order.index("bullet:experience0.b1")])
    # No entry ever loses its first bullet on its own
    assert not any(o.endswith(".b0") for o in order)


def test_whole_entries_go_leadership_then_projects_then_experience_keeping_one_job_until_the_last_resort():
    view, names = _view(experience=[1, 1, 1], projects=[1, 1], leadership=[1])
    order = [o for o in _names(plan(view, None, _Layout(view)), names) if o.startswith("entry:")]
    assert order[:5] == ["entry:leadership0", "entry:projects1", "entry:projects0",
                         "entry:experience2", "entry:experience1"]
    # Experience's top entry goes only in stage 4, last of all here
    assert order[-1] == "entry:experience0"


def test_a_posting_ranks_bullets_and_entries():
    view, names = _view(experience=[3, 3])
    ids = {v: k for k, v in names.items()}
    ranks = {ids["experience0.b0"]: 0.5, ids["experience0.b1"]: 0.0, ids["experience0.b2"]: 0.9,
             ids["experience1.b0"]: 0.8, ids["experience1.b1"]: 0.1, ids["experience1.b2"]: 0.7}
    order = _names(plan(view, Scores(ranks, {}), _Layout(view)), names)
    # The lowest-ranked bullet first; each entry keeps its best two, then its best one
    assert order[:2] == ["bullet:experience0.b1", "bullet:experience1.b1"]
    assert order[2:4] == ["bullet:experience0.b0", "bullet:experience1.b2"]
    # The job whose best bullet ranks lower (0.8 < 0.9) goes; the other stays
    assert order[4] == "entry:experience1"


def test_the_schedules_open_as_entries_go():
    view, names = _view(skills={"Languages": 6, "Tools": 2, "Other": 2},
                        education=[2, 1], experience=[1] * 10, awards=[0, 0], certifications=[0])
    ids = {v: k for k, v in names.items()}
    layout = _Layout(view, wrapped_lines={0}, wrapped_bullets={ids["education0.b1"]}, fits=4)
    order = _names(plan(view, None, layout), names)

    def at(name: str) -> int:
        return next(i for i, o in enumerate(order) if name in o)

    # 10%: the first job cut opens the wrapped skill trim (the line's last
    # skills, down to what fits), then every award and certification, then
    # Education's wrapped bullet
    assert order[0] == "entry:experience9"
    assert order[1] == "skill:Languages.s5+skill:Languages.s4"
    assert order[2:5] == ["entry:awards1", "entry:awards0", "entry:certifications0"]
    assert order[5] == "bullet:education0.b1"
    # 50% (the fifth job): one skill line goes, the bottom one
    assert at("entry:experience5") < at("skill:Other.s0") < at("entry:experience4")
    # The eighth job (80%) opens 75% (one more skill line) and 80% (a
    # school), in that order; 85% to 95% find one line and one school left
    assert at("entry:experience2") < at("skill:Tools.s0") < at("entry:education1") < at("entry:experience1")


def test_a_small_resume_still_cuts_to_the_header():
    view, names = _view(skills={"Languages": 2, "Tools": 1}, education=[1, 1], experience=[2])
    order = _names(plan(view, None, _Layout(view)), names)
    # Stage 3 has nothing to cut, so the schedules open anyway: skill lines
    # and schools down to one, then the floors go: Skills, Experience, the
    # last school
    assert order == ["bullet:experience0.b1", "skill:Tools.s0", "entry:education1",
                     "skill:Languages.s0+skill:Languages.s1", "entry:experience0", "entry:education0"]
    everything = {c.id for step in plan(view, None, _Layout(view)) for c in step}
    assert apply_cuts(view, [Cut("entry", i) for i in everything]) == ResumeView()


def test_education_bullets_go_only_by_its_schedule():
    view, names = _view(education=[4], experience=[4])
    order = _names(plan(view, None, _Layout(view)), names)
    assert [o for o in order if "education0.b" in o] == []


def test_apply_cuts_drops_an_emptied_section_and_cut_skills():
    view, names = _view(skills={"Languages": 2}, experience=[2], projects=[1])
    ids = {v: k for k, v in names.items()}
    after = apply_cuts(view, [Cut("entry", ids["projects0"]), Cut("bullet", ids["experience0.b1"]),
                              Cut("skill", ids["Languages.s0"])])
    assert [s.section for s in after.sections] == ["experience"]
    assert [b.text for b in after.sections[0].entries[0].bullets] == ["line 0"]
    assert [s.name for s in after.skills] == ["Languages1"]


def test_skill_levels_read_the_posting_then_the_bullets_by_whole_word():
    view = ResumeView(
        (ViewSection("experience", (ViewEntry(uuid.uuid4(), "experience", "Intern", bullets=(
            ViewBullet(uuid.uuid4(), "Built a Django service in Go"),)),)),),
        tuple(ViewSkill(uuid.uuid4(), name, "Languages") for name in ("Python", "Go", "C++", "Rust")),
    )

    def levels(posting: str) -> dict[str, int]:
        found = skill_levels(view, posting)
        return {s.name: found[s.id] for s in view.skills}

    assert levels("Python and C++ wanted") == {"Python": 2, "Go": 1, "C++": 2, "Rust": 0}
    # "C" is not "C++", and "Go" is not in "Django"
    assert levels("We use C and Django") == {"Python": 0, "Go": 1, "C++": 0, "Rust": 0}


def _box(item, kind, top, lines=1, page=1):
    return Box(str(item), kind, page, 50.0, top, 300.0, top + 11 + 12 * (lines - 1))


def test_the_check_subtracts_measured_heights_and_counts_what_the_glue_can_give():
    view, names = _view(experience=[3])
    ids = {v: k for k, v in names.items()}
    entry = ids["experience0"]
    boxes = (_box("header", "full_name", 40), _box(entry, "title", 100),
             _box(ids["experience0.b0"], "bullet", 114), _box(ids["experience0.b1"], "bullet", 128),
             _box(ids["experience0.b2"], "bullet", 142))
    shrinks = (Shrink(f"{entry}.title", 1, 60.0, 4.0), Shrink(f"{ids['experience0.b0']}.bullet", 1, 74.0, 6.0),
               Shrink(f"{ids['experience0.b1']}.bullet", 1, 88.0, 8.0),
               Shrink(f"{ids['experience0.b2']}.bullet", 1, 102.0, 10.0))
    rendered = Rendered(b"", 2, boxes=boxes, area=TextArea(top=36.0, height=100.0, right=576.0), shrinks=shrinks)
    page = Page(rendered, view)
    # Each bullet stands 14 pt to the next one's top; the last, its box and
    # the 3 pt measured between bullets
    assert page.bullet_height(ids["experience0.b0"]) == 14.0
    assert page.bullet_height(ids["experience0.b2"]) == 14.0
    # 64 down to the entry's top, then the entry: 53 of boxes and the usual
    # 7 after it (one entry: nothing to measure the space from)
    assert page.used() == 64 + 53 + 7
    # The title's and each bullet's glue give 2 pt; the last bullet's is not
    # measured, so it is the usual bullet's
    assert page.shrink(set()) == 8
    # 124 - 8 = 116 against 100: one bullet (14, and its 2 of glue) leaves
    # 104, two leave 92
    assert not page.fits(set())
    assert not page.fits({ids["experience0.b2"]})
    assert page.fits({ids["experience0.b1"], ids["experience0.b2"]})


async def _draw(view):
    return await asyncio.to_thread(render, view, sample.IDENTITY, "jakes")


def _long(extra: int) -> ResumeView:
    """Jake's sample with `extra` more bullets on every entry and its jobs
    and projects twice over: two to four pages."""
    sections = []
    for section in sample.VIEW.sections:
        entries = [dataclasses.replace(e, bullets=e.bullets + tuple(
            ViewBullet(uuid.uuid4(), f"Built and shipped feature {i}, used by hundreds of students every week")
            for i in range(extra))) for e in section.entries]
        if section.section in ("experience", "projects"):
            entries += [dataclasses.replace(e, id=uuid.uuid4(), bullets=tuple(
                ViewBullet(uuid.uuid4(), b.text) for b in e.bullets)) for e in entries]
        sections.append(ViewSection(section.section, tuple(entries)))
    return ResumeView(tuple(sections), sample.VIEW.skills)


def test_fit_reaches_one_page_in_two_renders_and_cuts_at_most_one_item_too_many():
    _tectonic_or_skip()
    for extra in (0, 3, 8):
        view = _long(extra)
        renders: list[ResumeView] = []

        async def counted(v, renders=renders):
            renders.append(v)
            return await _draw(v)

        cuts, rendered = asyncio.run(fit(view, None, counted))
        assert rendered.page_count == 1
        assert len(renders) <= 3, extra
        # Showing the last two cuts again runs over: the prediction stopped
        # at most one cut past the page's need
        steps = plan(view, None, Page(render(view, sample.IDENTITY, "jakes"), view))
        made = [c for step in steps for c in step][:len(cuts)]
        assert made == cuts
        back = apply_cuts(view, cuts[:-2])
        assert render(back, sample.IDENTITY, "jakes").page_count == 2, extra


def test_fit_leaves_a_one_page_resume_alone():
    _tectonic_or_skip()
    cuts, rendered = asyncio.run(fit(sample.VIEW, None, _draw))
    assert cuts == [] and rendered.page_count == 1


def test_the_render_reports_its_text_area_and_each_skill_lines_start():
    _tectonic_or_skip()
    rendered = render(sample.VIEW, sample.IDENTITY, "jakes")
    # Jake's preamble: Letter with half-inch margins top and bottom
    assert rendered.area == TextArea(top=36.0, height=720.0, right=576.0)
    rows = [p for p in rendered.points if p.name == "skillrow"]
    assert len(rows) == len({s.group for s in sample.VIEW.skills})
    assert len({p.x for p in rows}) == 1
    assert [s.name.split(".")[1] for s in rendered.shrinks][:1] == ["full_name"]


@pytest.mark.anyio
async def test_bullets_rank_on_the_wording_the_resume_shows(database):
    entry = ViewEntry(uuid.uuid4(), "experience", "Intern", bullets=(
        ViewBullet(uuid.uuid4(), "Built Python services for the billing team"),
        ViewBullet(uuid.uuid4(), "Ran the chess club"),
    ))
    view = ResumeView((ViewSection("experience", (entry,)),))
    async with database() as session:
        ranks = await rank_shown(session, view, "Python developer")
    # The texts are ranked as given: no bank row holds them
    assert ranks[entry.bullets[0].id] > 0
    assert ranks[entry.bullets[1].id] == 0


def test_a_fit_render_that_fails_once_is_tried_again(monkeypatch):
    from fastapi import HTTPException

    from app.routers import built_resumes as route
    from app.services.resume_render import TectonicUnavailable

    calls = []

    def flaky(view, identity, template):
        calls.append(view)
        if len(calls) == 1:
            raise TectonicUnavailable("tectonic timed out")
        return Rendered(b"%PDF", 1)

    monkeypatch.setattr(route, "render", flaky)
    assert asyncio.run(route._render(sample.VIEW, sample.IDENTITY, "jakes", tries=2)).page_count == 1
    assert len(calls) == 2

    # A render that fails twice is a 503
    def broken(view, identity, template):
        calls.append(view)
        raise TectonicUnavailable("tectonic failed")

    calls.clear()
    monkeypatch.setattr(route, "render", broken)
    with pytest.raises(HTTPException) as failed:
        asyncio.run(route._render(sample.VIEW, sample.IDENTITY, "jakes", tries=2))
    assert failed.value.status_code == 503
    assert len(calls) == 2
