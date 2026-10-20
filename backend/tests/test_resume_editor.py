"""
Seam-1 tests for the desktop editor (KAN-218): a built resume's choices
read and changed through the API on real Postgres, read back from the Word
download (no Tectonic needed) or the render (skips without Tectonic).
"""

import uuid

import httpx
import pytest

from app.deps import get_current_account
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
