"""
Seam-1 tests for the desktop editor (KAN-218): a built resume's choices
read and changed through the API on real Postgres, read back from the Word
download (no Tectonic needed) or the render (skips without Tectonic).
"""

import uuid

import httpx
import pytest

from app.deps import get_current_account, token_applicant
from app.main import app
from tests.test_built_resumes import (
    _another,
    _docx_lines,
    _fill_bank,
    _generate,
    _seed_applicant,
    _sign_in,
    _tectonic_or_skip,
)

pytestmark = pytest.mark.anyio


@pytest.fixture
async def student(database):
    """A signed-in applicant and an API client: (client, applicant URL)."""
    async with database() as session:
        applicant_id = await _seed_applicant(session)
    _sign_in(applicant_id)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            yield client, f"/applicants/{applicant_id}"
    finally:
        app.dependency_overrides.pop(get_current_account, None)
        app.dependency_overrides.pop(token_applicant, None)


async def _bank(client, me):
    return (await client.get(f"{me}/bank")).json()


def _entry(bank, title):
    return next(e for e in bank["entries"] if e["title"] == title)


async def _lines(client, me, resume_id):
    return _docx_lines((await client.get(f"{me}/built-resumes/{resume_id}/docx")).content)


async def test_choices_read_back_every_item_generate_put_on_the_resume(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    bank = await _bank(client, me)
    intern = _entry(bank, "Software Intern")

    res = await client.get(f"{me}/built-resumes/{resume_id}/choices")
    assert res.status_code == 200
    choices = res.json()
    assert {c["entry_id"] for c in choices["entries"]} == {e["id"] for e in bank["entries"]}
    assert {c["skill_id"] for c in choices["skills"]} == {s["id"] for s in bank["skills"]}
    bullets = {c["bullet_id"]: c for c in choices["bullets"]}
    assert [bullets[b["id"]]["position"] for b in intern["bullets"]] == [0, 1]
    assert all(c["shown"] for c in choices["entries"] + choices["bullets"] + choices["skills"])
    school = next(c for c in choices["entries"] if c["entry_id"] == _entry(bank, "Stony Brook University")["id"])
    assert (school["show_gpa"], school["show_coursework"]) == (True, True)


async def test_hiding_a_bullet_drops_it_from_the_resume_and_showing_it_puts_it_back(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    cut = _entry(await _bank(client, me), "Software Intern")["bullets"][0]["id"]

    res = await client.patch(f"{me}/built-resumes/{resume_id}/choices",
                             json={"bullets": [{"bullet_id": cut, "shown": False}]})
    assert res.status_code == 200
    assert next(c for c in res.json()["bullets"] if c["bullet_id"] == cut)["shown"] is False
    assert "Cut page load time by 30%" not in await _lines(client, me, resume_id)

    await client.patch(f"{me}/built-resumes/{resume_id}/choices",
                       json={"bullets": [{"bullet_id": cut, "shown": True}]})
    assert "Cut page load time by 30%" in await _lines(client, me, resume_id)


async def test_an_entry_from_the_tray_joins_the_end_of_its_section_with_its_bullets(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    res = await client.post(f"{me}/bank/entries", json={
        "section": "experience", "title": "Barista", "organization": "Cafe",
        "start_month": "2026-06", "end_kind": "present", "bullets": ["Served 200 customers a day"]})
    barista = res.json()["id"]
    assert "Barista" not in " ".join(await _lines(client, me, resume_id))

    res = await client.patch(f"{me}/built-resumes/{resume_id}/choices", json={"entries": [{"entry_id": barista}]})
    assert res.status_code == 200
    lines = await _lines(client, me, resume_id)
    # Newest in the bank, but put back after the entries already on the resume
    assert lines.index("Tutored 40 students in calculus") < lines.index("Barista\tJune 2026 – Present")
    assert "Served 200 customers a day" in lines


async def test_moving_entries_and_bullets_reorders_this_resume_only(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    other = await _another(client, me)
    bank = await _bank(client, me)
    intern, tutor = _entry(bank, "Software Intern"), _entry(bank, "Tutor")
    first, second = (b["id"] for b in intern["bullets"])

    res = await client.patch(f"{me}/built-resumes/{resume_id}/choices", json={
        "entries": [{"entry_id": tutor["id"], "position": 0}, {"entry_id": intern["id"], "position": 1}],
        "bullets": [{"bullet_id": second, "position": 0}, {"bullet_id": first, "position": 1}],
    })
    assert res.status_code == 200
    lines = await _lines(client, me, resume_id)
    assert lines.index("Tutor\tSep. 2023 – May 2024") < lines.index("Software Intern\tJune 2025 – Aug. 2025")
    assert lines.index("Wrote the billing service's tests") < lines.index("Cut page load time by 30%")
    untouched = await _lines(client, me, other)
    assert untouched.index("Software Intern\tJune 2025 – Aug. 2025") < untouched.index("Tutor\tSep. 2023 – May 2024")


async def test_gpa_and_coursework_toggles_hide_those_lines(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    school = _entry(await _bank(client, me), "Stony Brook University")["id"]

    await client.patch(f"{me}/built-resumes/{resume_id}/choices",
                       json={"entries": [{"entry_id": school, "show_gpa": False}]})
    lines = await _lines(client, me, resume_id)
    assert "GPA: 3.8/4.0" not in lines
    assert "Relevant Coursework: Data Structures, Algorithms" in lines

    await client.patch(f"{me}/built-resumes/{resume_id}/choices",
                       json={"entries": [{"entry_id": school, "show_gpa": True, "show_coursework": False}]})
    lines = await _lines(client, me, resume_id)
    assert "GPA: 3.8/4.0" in lines
    assert "Relevant Coursework: Data Structures, Algorithms" not in lines


async def test_another_students_items_and_resumes_are_out_of_reach(student, database):
    client, me = student
    mine = await _generate(client, me)
    async with database() as session:
        other = await _seed_applicant(session)
    _sign_in(other)
    theirs_resume = await _generate(client, f"/applicants/{other}")
    theirs_entry = (await client.post(f"/applicants/{other}/bank/entries",
                                      json={"section": "projects", "title": "Secret"})).json()["id"]
    _sign_in(uuid.UUID(me.split("/")[2]))

    assert (await client.get(f"{me}/built-resumes/{theirs_resume}/choices")).status_code == 404
    assert (await client.patch(f"{me}/built-resumes/{theirs_resume}/choices", json={})).status_code == 404
    res = await client.patch(f"{me}/built-resumes/{mine}/choices", json={"entries": [{"entry_id": theirs_entry}]})
    assert res.status_code == 404
    assert "Secret" not in " ".join(await _lines(client, me, mine))


async def _long_bank(client, me) -> dict[str, list[str]]:
    """Four entries with four bullets each: a little over one page. Returns
    each entry's title and its bullet ids, in bank order."""
    bullet = "Led a team of five students to build and ship a web application used by three hundred people"
    made = {}
    for section, title, start in (("experience", "Newer Job", "2025-06"), ("experience", "Older Job", "2023-06"),
                                  ("projects", "Big Project", "2024-01"), ("leadership", "Club Lead", "2022-09")):
        res = await client.post(f"{me}/bank/entries", json={
            "section": section, "title": title, "organization": "Somewhere", "start_month": start,
            "end_month": "2025-12" if start < "2025" else None, "end_kind": "month" if start < "2025" else "present",
            "bullets": [f"{bullet} ({title} {i})" for i in range(9)]})
        assert res.status_code == 201, res.text
        made[title] = [b["id"] for b in res.json()["bullets"]]
    return made


async def test_render_says_how_many_lines_run_past_one_page(student):
    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    short = await _generate(client, me)
    assert (await client.get(f"{me}/built-resumes/{short}/render")).json()["lines_over"] == 0

    await _long_bank(client, me)
    body = (await client.get(f"{me}/built-resumes/{await _generate(client, me)}/render")).json()
    assert body["page_count"] == 2
    assert body["lines_over"] > 0


async def test_fit_to_one_page_trims_every_entry_before_gutting_one_and_undo_brings_it_all_back(student):
    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    made = await _long_bank(client, me)
    resume_id = await _generate(client, me)
    assert (await client.get(f"{me}/built-resumes/{resume_id}/render")).json()["page_count"] == 2

    res = await client.post(f"{me}/built-resumes/{resume_id}/fit")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["render"]["page_count"] == 1
    hidden = body["hidden"]
    # Coursework goes first, then each entry's last bullets; every entry
    # keeps its first bullets, and more of them the more useful it is.
    assert body["undo"]["entries"][0]["show_coursework"] is True
    kept = {}
    for title, ids in made.items():
        gone = [b for b in ids if b in hidden]
        assert gone == ids[len(ids) - len(gone):]
        kept[title] = len(ids) - len(gone)
    assert kept["Newer Job"] >= kept["Older Job"] >= kept["Big Project"] >= kept["Club Lead"] >= 1
    assert kept["Newer Job"] >= 3
    shown = {c["bullet_id"]: c["shown"] for c in (await client.get(f"{me}/built-resumes/{resume_id}/choices")).json()["bullets"]}
    assert all(shown[b] is False for b in hidden)

    # Undo is the editor's PATCH with the response's `undo` body
    await client.patch(f"{me}/built-resumes/{resume_id}/choices", json=body["undo"])
    assert (await client.get(f"{me}/built-resumes/{resume_id}/render")).json()["page_count"] == 2
    assert "Relevant Coursework: Data Structures, Algorithms" in await _lines(client, me, resume_id)


async def test_fit_on_a_one_page_resume_hides_nothing(student):
    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    body = (await client.post(f"{me}/built-resumes/{resume_id}/fit")).json()
    assert body["hidden"] == []
    assert body["render"]["page_count"] == 1


async def _bullet_choice(client, me, resume_id, bullet_id):
    choices = (await client.get(f"{me}/built-resumes/{resume_id}/choices")).json()
    return next(c for c in choices["bullets"] if c["bullet_id"] == bullet_id)


async def test_typing_on_a_bullet_changes_this_resume_only_and_the_bank_keeps_the_original(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    other = await _another(client, me)
    bullet = _entry(await _bank(client, me), "Software Intern")["bullets"][0]["id"]

    res = await client.patch(f"{me}/built-resumes/{resume_id}/choices",
                             json={"bullets": [{"bullet_id": bullet, "text": "Cut page load time by 35%"}]})
    assert res.status_code == 200
    assert "Cut page load time by 35%" in await _lines(client, me, resume_id)
    assert "Cut page load time by 30%" in await _lines(client, me, other)
    assert _entry(await _bank(client, me), "Software Intern")["bullets"][0]["text"] == "Cut page load time by 30%"
    choice = await _bullet_choice(client, me, resume_id, bullet)
    assert choice["text"] == "Cut page load time by 35%"
    assert choice["variant_id"] is not None

    # Typing again updates the same local variant: at most one per bullet
    await client.patch(f"{me}/built-resumes/{resume_id}/choices",
                       json={"bullets": [{"bullet_id": bullet, "text": "Cut page load time by 40%"}]})
    again = await _bullet_choice(client, me, resume_id, bullet)
    assert (again["variant_id"], again["text"]) == (choice["variant_id"], "Cut page load time by 40%")
    variants = (await client.get(f"{me}/built-resumes/{resume_id}/choices")).json()["variants"]
    assert [(v["bullet_id"], v["text"], v["local"]) for v in variants] == [
        (bullet, "Cut page load time by 40%", True)]


async def test_typing_the_original_back_drops_the_local_variant(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    bullet = _entry(await _bank(client, me), "Software Intern")["bullets"][0]["id"]
    await client.patch(f"{me}/built-resumes/{resume_id}/choices",
                       json={"bullets": [{"bullet_id": bullet, "text": "Cut load time by 30%"}]})

    await client.patch(f"{me}/built-resumes/{resume_id}/choices",
                       json={"bullets": [{"bullet_id": bullet, "text": " Cut page load time by 30% "}]})
    choice = await _bullet_choice(client, me, resume_id, bullet)
    assert (choice["variant_id"], choice["text"]) == (None, None)
    assert (await client.get(f"{me}/built-resumes/{resume_id}/choices")).json()["variants"] == []
    # A fix in the bank shows again, since the resume shows the original
    await client.patch(f"{me}/bank/bullets/{bullet}", json={"text": "Cut page load time by 31%"})
    assert "Cut page load time by 31%" in await _lines(client, me, resume_id)


async def test_switching_wording_picks_a_variant_of_that_bullet_or_the_original(student, database):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    intern = _entry(await _bank(client, me), "Software Intern")
    bullet, sibling = (b["id"] for b in intern["bullets"])
    async with database() as session:
        from sqlalchemy import text as sql

        tailored = await session.scalar(sql(
            "INSERT INTO bank_bullet_variants (bullet_id, text) VALUES (:b, 'Made pages load 30% faster')"
            " RETURNING id"), {"b": bullet})
        await session.commit()
    tailored = str(tailored)

    listed = (await client.get(f"{me}/built-resumes/{resume_id}/choices")).json()["variants"]
    assert [(v["id"], v["local"]) for v in listed] == [(tailored, False)]
    await client.patch(f"{me}/built-resumes/{resume_id}/choices",
                       json={"bullets": [{"bullet_id": bullet, "variant_id": tailored}]})
    assert "Made pages load 30% faster" in await _lines(client, me, resume_id)

    # Another bullet's variant is refused
    res = await client.patch(f"{me}/built-resumes/{resume_id}/choices",
                             json={"bullets": [{"bullet_id": sibling, "variant_id": tailored}]})
    assert res.status_code == 404

    await client.patch(f"{me}/built-resumes/{resume_id}/choices",
                       json={"bullets": [{"bullet_id": bullet, "variant_id": None}]})
    assert "Cut page load time by 30%" in await _lines(client, me, resume_id)


async def test_another_resumes_local_wording_is_not_offered(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    other = await _another(client, me)
    bullet = _entry(await _bank(client, me), "Software Intern")["bullets"][0]["id"]
    await client.patch(f"{me}/built-resumes/{other}/choices",
                       json={"bullets": [{"bullet_id": bullet, "text": "Other resume's words"}]})
    assert (await client.get(f"{me}/built-resumes/{resume_id}/choices")).json()["variants"] == []
    local = (await client.get(f"{me}/built-resumes/{other}/choices")).json()["variants"][0]["id"]
    res = await client.patch(f"{me}/built-resumes/{resume_id}/choices",
                             json={"bullets": [{"bullet_id": bullet, "variant_id": local}]})
    assert res.status_code == 404


# An edit through POST .../render (rendered, never saved) and PUT .../lines
# (saved, never rendered), KAN-391

def _box(render, kind, item_id=None):
    return next(b for b in render["boxes"] if b["kind"] == kind and item_id in (None, b["item_id"]))


async def _type(client, me, resume_id, item_id, kind, text, source=None):
    return await client.put(f"{me}/built-resumes/{resume_id}/lines",
                            json={"item_id": item_id, "kind": kind, "text": text, "source": source})


async def _render_line(client, me, resume_id, item_id, kind, text, source=None):
    # A render always sends a copy: it reads no database
    source = source or await _copy(client, me, resume_id)
    return await client.post(f"{me}/built-resumes/{resume_id}/render", json={
        "line": {"item_id": item_id, "kind": kind, "text": text}, "source": source})


async def _render_changes(client, me, resume_id, changes, source=None):
    source = source or await _copy(client, me, resume_id)
    return await client.post(f"{me}/built-resumes/{resume_id}/render",
                             json={"changes": changes, "source": source})


async def test_a_typed_bullet_saves_this_resumes_wording(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    bullet = _entry(await _bank(client, me), "Software Intern")["bullets"][0]["id"]

    res = await _type(client, me, resume_id, bullet, "bullet", "Cut page load time by 35%")
    assert res.status_code == 200, res.text
    variant = res.json()["variant_id"]
    choices = (await client.get(f"{me}/built-resumes/{resume_id}/choices")).json()
    assert next(c for c in choices["bullets"] if c["bullet_id"] == bullet)["variant_id"] == variant
    assert [(v["id"], v["text"], v["local"]) for v in choices["variants"]] == [
        (variant, "Cut page load time by 35%", True)]
    assert "Cut page load time by 35%" in await _lines(client, me, resume_id)
    # The bank keeps the original: the wording is this resume's own
    assert _entry(await _bank(client, me), "Software Intern")["bullets"][0]["text"] == "Cut page load time by 30%"

    # Typed again, the same variant takes the new words
    res = await _type(client, me, resume_id, bullet, "bullet", "Cut page load time by 40%")
    assert res.json()["variant_id"] == variant
    assert "Cut page load time by 40%" in await _lines(client, me, resume_id)


async def test_the_original_typed_back_drops_the_resumes_wording(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    bullet = _entry(await _bank(client, me), "Software Intern")["bullets"][0]["id"]
    await _type(client, me, resume_id, bullet, "bullet", "Cut page load time by 35%")

    res = await _type(client, me, resume_id, bullet, "bullet", "Cut page load time by 30%")
    assert res.status_code == 200, res.text
    assert res.json()["variant_id"] is None
    choices = (await client.get(f"{me}/built-resumes/{resume_id}/choices")).json()
    assert next(c for c in choices["bullets"] if c["bullet_id"] == bullet)["variant_id"] is None
    assert choices["variants"] == []
    assert "Cut page load time by 30%" in await _lines(client, me, resume_id)


async def test_a_typed_bullet_renders_without_being_saved(student):
    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    bullet = _entry(await _bank(client, me), "Software Intern")["bullets"][0]["id"]

    res = await _render_line(client, me, resume_id, bullet, "bullet", "Cut page load time by 35%")
    assert res.status_code == 200, res.text
    body = res.json()
    assert _box(body["render"], "bullet", bullet)["text"] == "Cut page load time by 35%"
    assert next(c for c in body["choices"]["bullets"] if c["bullet_id"] == bullet)["text"] == "Cut page load time by 35%"
    assert body["entry"] is None
    assert "Cut page load time by 30%" in await _lines(client, me, resume_id)


async def test_every_box_carries_the_words_it_prints(student):
    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    school = _entry(await _bank(client, me), "Stony Brook University")["id"]

    render = (await client.get(f"{me}/built-resumes/{resume_id}/render")).json()
    assert _box(render, "gpa", school)["text"] == "GPA: 3.8/4.0"
    assert _box(render, "coursework", school)["text"] == "Relevant Coursework: Data Structures, Algorithms"
    assert _box(render, "dates", school)["text"] == "Aug. 2023 – Expected May 2027"
    assert _box(render, "full_name")["text"] == "Sam Seeker"
    assert _box(render, "github_url")["text"] == "github.com/samseeker"
    # A skill's box covers its comma too
    assert [b["text"] for b in render["boxes"] if b["kind"] == "skill"] == ["Python", "Docker"]


async def test_a_typed_gpa_drops_its_label_and_saves_the_number_to_the_bank(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    school = _entry(await _bank(client, me), "Stony Brook University")["id"]

    res = await _type(client, me, resume_id, school, "gpa", "GPA: 3.9 / 4")
    assert res.status_code == 200, res.text
    saved = _entry(await _bank(client, me), "Stony Brook University")
    assert (saved["gpa"], saved["gpa_scale"]) == (3.9, 4.0)


async def test_a_typed_gpa_renders_with_the_entry_it_makes(student):
    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    school = _entry(await _bank(client, me), "Stony Brook University")["id"]

    res = await _render_line(client, me, resume_id, school, "gpa", "GPA: 3.9 / 4")
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["entry"]["gpa"], body["entry"]["gpa_scale"]) == (3.9, 4.0)
    assert _box(body["render"], "gpa", school)["text"] == "GPA: 3.9/4.0"


async def test_text_the_api_cannot_save_answers_422_and_changes_nothing(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    bank = await _bank(client, me)
    school, intern = _entry(bank, "Stony Brook University")["id"], _entry(bank, "Software Intern")

    for item_id, kind, text in (
        (school, "gpa", "about 3.8"),
        (school, "gpa", "5.0/4.0"),
        (intern["id"], "title", "  "),
        (intern["bullets"][0]["id"], "bullet", ""),
        (intern["id"], "dates", "June 2025"),  # dates are not typed in the editor
        ("header", "email", "me@example.com"),  # My Profile sets it
        ("header", "title", "Intern"),  # an entry's field under the header's id
    ):
        res = await _type(client, me, resume_id, item_id, kind, text)
        assert res.status_code == 422, (kind, res.text)
        res = await _render_line(client, me, resume_id, item_id, kind, text)
        assert res.status_code == 422, (kind, res.text)
    assert await _bank(client, me) == bank


async def test_a_typed_link_without_a_scheme_saves_as_https_to_the_profile(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)

    res = await _type(client, me, resume_id, "header", "linkedin_url", "linkedin.com/in/sam")
    assert res.status_code == 200, res.text
    assert res.json()["profile"]["linkedin_url"] == "https://linkedin.com/in/sam"


async def test_another_students_items_cannot_be_typed(student, database):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    for kind in ("bullet", "title"):
        res = await _type(client, me, resume_id, str(uuid.uuid4()), kind, "Anything")
        assert res.status_code == 404, kind
    # The student's own bullet on a resume that is not theirs
    bullet = _entry(await _bank(client, me), "Software Intern")["bullets"][0]["id"]
    res = await _type(client, me, str(uuid.uuid4()), bullet, "bullet", "Anything")
    assert res.status_code == 404


async def test_a_typed_title_saves_to_the_bank(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    intern = _entry(await _bank(client, me), "Software Intern")["id"]

    res = await _type(client, me, resume_id, intern, "title", "Software Engineering Intern")
    assert res.status_code == 200, res.text
    assert _entry(await _bank(client, me), "Software Engineering Intern")["id"] == intern


async def test_a_typed_name_splits_into_its_parts(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)

    res = await _type(client, me, resume_id, "header", "full_name", "Samantha J Seeker")
    assert res.status_code == 200, res.text
    profile = res.json()["profile"]
    assert (profile["first_name"], profile["middle_name"], profile["last_name"]) == ("Samantha", "J", "Seeker")


async def test_a_save_never_compiles(student, monkeypatch):
    from app.routers import built_resumes
    from app.services.resume_render import TectonicUnavailable

    def broken(*args):
        raise TectonicUnavailable("no tectonic")

    monkeypatch.setattr(built_resumes, "render", broken)
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    intern = _entry(await _bank(client, me), "Software Intern")["id"]

    res = await _type(client, me, resume_id, intern, "location", "Boston, MA")
    assert res.status_code == 200, res.text
    assert _entry(await _bank(client, me), "Software Intern")["location"] == "Boston, MA"
    res = await _render_line(client, me, resume_id, intern, "location", "Boston, MA")
    assert res.status_code == 503


# The editor's copy (`source`, KAN-391): the PDF compiles from it, no read first

async def _copy(client, me, resume_id):
    bank = (await client.get(f"{me}/bank", params={"built_resume_id": resume_id})).json()
    choices = (await client.get(f"{me}/built-resumes/{resume_id}/choices")).json()
    # The header the last render printed; a plain one where Tectonic is
    # missing, for the tests whose edits are refused before any compile
    rendered = await client.get(f"{me}/built-resumes/{resume_id}/render")
    identity = rendered.json()["identity"] if rendered.status_code == 200 else {"name": "Sam Seeker"}
    return {"entries": bank["entries"], "skills": bank["skills"], "choices": choices, "identity": identity}


def _order(render, kind):
    return [b["text"] for b in render["boxes"] if b["kind"] == kind]


async def test_every_render_says_what_header_it_printed(student):
    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    identity = (await client.get(f"{me}/built-resumes/{resume_id}/render")).json()["identity"]
    assert identity["name"] == "Sam Seeker"
    assert identity["phone"] == "555-010-2030"
    assert identity["links"] == [["github_url", "https://github.com/samseeker"]]


async def test_a_typed_line_with_a_copy_renders_from_the_copy(student):
    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    copy = await _copy(client, me, resume_id)
    # The copy says the tutor job is at a center the database does not know:
    # the PDF prints the copy, so no read came first
    tutor = next(e for e in copy["entries"] if e["title"] == "Tutor")
    tutor["organization"] = "Copy Center"
    intern = _entry(await _bank(client, me), "Software Intern")["id"]

    res = await _render_line(client, me, resume_id, intern, "title", "Engineering Intern", copy)
    assert res.status_code == 200, res.text
    body = res.json()
    assert _box(body["render"], "title", intern)["text"] == "Engineering Intern"
    assert _box(body["render"], "organization", tutor["id"])["text"] == "Copy Center"
    assert body["entry"]["title"] == "Engineering Intern"
    assert _entry(await _bank(client, me), "Software Intern")["id"] == intern


async def test_a_save_with_a_stale_copy_writes_only_the_typed_field(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    copy = await _copy(client, me, resume_id)
    tutor = next(e for e in copy["entries"] if e["title"] == "Tutor")
    tutor["organization"] = "Copy Center"

    res = await _type(client, me, resume_id, tutor["id"], "title", "Math Tutor", copy)
    assert res.status_code == 200, res.text
    saved = _entry(await _bank(client, me), "Math Tutor")
    assert saved["organization"] == "Campus Center"


async def test_a_typed_header_field_with_a_copy_prints_at_once(student):
    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    copy = await _copy(client, me, resume_id)

    res = await _render_line(client, me, resume_id, "header", "linkedin_url", "linkedin.com/in/sam", copy)
    assert res.status_code == 200, res.text
    render = res.json()["render"]
    assert _box(render, "linkedin_url")["text"] == "linkedin.com/in/sam"
    assert render["identity"]["links"][0] == ["linkedin_url", "https://linkedin.com/in/sam"]


async def test_moving_bullets_renders_from_the_copy(student):
    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    first, second = (b["id"] for b in _entry(await _bank(client, me), "Software Intern")["bullets"])
    move = {"bullets": [{"bullet_id": second, "position": 0}, {"bullet_id": first, "position": 1}]}

    for source in (await _copy(client, me, resume_id),):
        res = await _render_changes(client, me, resume_id, move, source)
        assert res.status_code == 200, res.text
        body = res.json()
        bullets = _order(body["render"], "bullet")
        assert bullets.index("Wrote the billing service's tests") < bullets.index("Cut page load time by 30%")
        assert {c["bullet_id"]: c["position"] for c in body["choices"]["bullets"]}[second] == 0
    # Rendered, never saved
    lines = await _lines(client, me, resume_id)
    assert lines.index("Cut page load time by 30%") < lines.index("Wrote the billing service's tests")


async def test_hiding_and_switching_wording_with_a_copy_print_at_once(student):
    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    bullet = _entry(await _bank(client, me), "Software Intern")["bullets"][0]["id"]
    await _type(client, me, resume_id, bullet, "bullet", "Cut page load time by 35%")
    copy = await _copy(client, me, resume_id)

    res = await _render_changes(client, me, resume_id, {"bullets": [{"bullet_id": bullet, "variant_id": None}]}, copy)
    assert res.status_code == 200, res.text
    assert _box(res.json()["render"], "bullet", bullet)["text"] == "Cut page load time by 30%"

    copy["choices"] = res.json()["choices"]
    res = await _render_changes(client, me, resume_id, {"bullets": [{"bullet_id": bullet, "shown": False}]}, copy)
    assert res.status_code == 200, res.text
    assert bullet not in {b["item_id"] for b in res.json()["render"]["boxes"]}


async def test_a_render_takes_one_edit(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    res = await client.post(f"{me}/built-resumes/{resume_id}/render", json={})
    assert res.status_code == 422
    # A copy is required: the render reads no database
    line = {"item_id": str(uuid.uuid4()), "kind": "title", "text": "Intern"}
    res = await client.post(f"{me}/built-resumes/{resume_id}/render", json={"line": line})
    assert res.status_code == 422


async def test_a_choice_for_an_item_outside_the_bank_answers_404(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    res = await _render_changes(client, me, resume_id, {"bullets": [{"bullet_id": str(uuid.uuid4()), "shown": False}]})
    assert res.status_code == 404


async def test_the_pdf_built_in_memory_matches_the_saved_resume(student):
    # apply_choices mirrors update_choices: the render's PDF, made from the
    # copy, prints what a render read from the database prints after the save
    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    res = await client.post(f"{me}/bank/entries", json={
        "section": "experience", "title": "Barista", "organization": "Cafe",
        "start_month": "2026-06", "end_kind": "present", "bullets": ["Served 200 customers a day"]})
    barista = res.json()["id"]
    bank = await _bank(client, me)
    tutor, intern = _entry(bank, "Tutor")["id"], _entry(bank, "Software Intern")["id"]
    school = _entry(bank, "Stony Brook University")["id"]
    docker = next(s["id"] for s in bank["skills"] if s["name"] == "Docker")
    changes = {
        "entries": [{"entry_id": tutor, "position": 0}, {"entry_id": intern, "position": 1},
                    {"entry_id": barista}, {"entry_id": school, "show_gpa": False}],
        "skills": [{"skill_id": docker, "shown": False}],
    }

    res = await _render_changes(client, me, resume_id, changes, await _copy(client, me, resume_id))
    assert res.status_code == 200, res.text
    assert (await client.patch(f"{me}/built-resumes/{resume_id}/choices", json=changes)).status_code == 200
    after = (await client.get(f"{me}/built-resumes/{resume_id}/render")).json()
    assert [(b["item_id"], b["kind"], b["text"]) for b in res.json()["render"]["boxes"]] == [
        (b["item_id"], b["kind"], b["text"]) for b in after["boxes"]]
    assert "Served 200 customers a day" in _order(after, "bullet")


# The choices save with no read first (KAN-391, `save_choices`)

async def test_a_choices_save_without_read_back_answers_nothing_and_saves(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    first, second = (b["id"] for b in _entry(await _bank(client, me), "Software Intern")["bullets"])
    move = {"bullets": [{"bullet_id": second, "position": 0}, {"bullet_id": first, "position": 1}]}

    res = await client.patch(f"{me}/built-resumes/{resume_id}/choices", params={"read_back": "false"}, json=move)
    assert res.status_code == 204, res.text
    lines = await _lines(client, me, resume_id)
    assert lines.index("Wrote the billing service's tests") < lines.index("Cut page load time by 30%")


async def test_a_changed_entry_brings_its_new_bullets_as_the_render_does(student):
    # A bullet added to the bank after Generate has no row; changing its
    # entry brings it, last in the entry, in the statement and in memory alike
    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    intern = _entry(await _bank(client, me), "Software Intern")["id"]
    res = await client.post(f"{me}/bank/entries/{intern}/bullets", json={"text": "Paired with designers weekly"})
    assert res.status_code in (200, 201), res.text
    changes = {"entries": [{"entry_id": intern, "show_gpa": True}]}

    rendered = await _render_changes(client, me, resume_id, changes, await _copy(client, me, resume_id))
    assert rendered.status_code == 200, rendered.text
    res = await client.patch(f"{me}/built-resumes/{resume_id}/choices", params={"read_back": "false"}, json=changes)
    assert res.status_code == 204, res.text
    after = (await client.get(f"{me}/built-resumes/{resume_id}/render")).json()
    assert _order(rendered.json()["render"], "bullet") == _order(after, "bullet")
    assert _order(after, "bullet")[2] == "Paired with designers weekly"


async def test_a_choices_save_that_finds_no_row_is_refused_whole(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    first = _entry(await _bank(client, me), "Software Intern")["bullets"][0]["id"]
    before = (await client.get(f"{me}/built-resumes/{resume_id}/choices")).json()
    res = await client.patch(f"{me}/built-resumes/{resume_id}/choices", params={"read_back": "false"}, json={
        "bullets": [{"bullet_id": first, "shown": False}, {"bullet_id": str(uuid.uuid4()), "shown": False}]})
    assert res.status_code == 404
    assert (await client.get(f"{me}/built-resumes/{resume_id}/choices")).json() == before


async def test_a_render_reads_no_database(student):
    # With every database session refused, the render of a copy still answers
    _tectonic_or_skip()
    from app.db import get_session

    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    copy = await _copy(client, me, resume_id)
    intern = _entry(await _bank(client, me), "Software Intern")["id"]

    async def no_database():
        raise AssertionError("the render opened a database session")
        yield

    app.dependency_overrides[get_session] = no_database
    try:
        res = await _render_line(client, me, resume_id, intern, "title", "Engineering Intern", copy)
    finally:
        app.dependency_overrides.pop(get_session, None)
    assert res.status_code == 200, res.text
    assert _box(res.json()["render"], "title", intern)["text"] == "Engineering Intern"
    assert res.json()["render"]["template"] == "jakes"


async def test_a_render_of_an_unknown_template_answers_422(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    copy = await _copy(client, me, resume_id)
    copy["template"] = "nope"
    intern = _entry(await _bank(client, me), "Software Intern")["id"]
    res = await _render_line(client, me, resume_id, intern, "title", "Engineering Intern", copy)
    assert res.status_code == 422


async def test_a_render_takes_the_token_of_the_paths_applicant_only(student, database):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    copy = await _copy(client, me, resume_id)
    other = f"/applicants/{uuid.uuid4()}"
    res = await client.post(f"{other}/built-resumes/{resume_id}/render", json={
        "changes": {"bullets": []}, "source": copy})
    assert res.status_code == 403
