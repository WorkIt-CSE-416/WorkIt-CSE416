"""
The checks on every answer the student's Claude saves (KAN-380), spec seam
2: driven over MCP as Claude drives the connector (test_connector.py's
client), against this run's throwaway test database. Each check refuses a
failing answer with a reason Claude can act on, which never reaches the
tab, and passes a clean one. The checks themselves: test_answer_checks.py.
"""

import pytest
from sqlalchemy import text

from app.auto_apply import briefs, pipeline, written
from app.models.company_briefs import Company_Brief
from tests.test_connector import (  # noqa: F401  (fixtures)
    WRITTEN,
    _student_queues,
    _tab_asks,
    applicant,
    claude,
    running,
)

pytestmark = pytest.mark.anyio

# The student's bank (test_built_resumes._fill_bank): Software Intern at Acme, 2025, "Cut page load time by 30%".
WHY = {"name": "question_7", "label": "Why do you want to work here?", "required": True, "max_length": 300}
CLEAN = "At Acme I cut page load time by 30%, and I want to keep making pages fast on your team."
SAMPLE = "Nothing teaches you a codebase like the night it breaks in production."

CHECKS = {
    "machine-made words": ("I am passionate about this journey and eager to join!", "machine-written"),
    "copied from a writing sample": ("Nothing teaches you a codebase like the night it breaks.", "writing samples"),
    "a number not in the sources": ("At Acme I cut page load time by 45%, and I want that work here.", "45"),
    "another application's company": ("At Acme I cut page load time by 30%, and I want that at Globex.", "Globex"),
    "a long sentence": ("At Acme I " + "made pages load fast and " * 7 + "I want that here.", "split it"),
    "a placeholder": ("At Acme I cut page load time by 30%, see [insert link].", "placeholders"),
    "over the form's own limit": ("At Acme I cut page load time by 30%. " * 9, "at most 300"),
    "how it was written": ("My resume doesn't say why, but at Acme I cut page load time by 30%.", "how it was written"),
}


async def _company(database, job: str, name: str) -> None:
    async with database() as session:
        await session.execute(text("UPDATE job_postings SET company_name = :n WHERE id = :id"), {"n": name, "id": job})
        await session.commit()


@pytest.mark.parametrize("check", CHECKS)
async def test_each_check_refuses_a_failing_answer_and_passes_a_clean_one(running, applicant, database, monkeypatch, check):  # noqa: F811
    failing, reason = CHECKS[check]

    async def samples(db, applicant_id):
        return [SAMPLE]

    monkeypatch.setattr(written, "writing_samples", samples)  # stands in for the samples KAN-384 keeps
    me, (job, other) = await _student_queues(database, applicant, 2)
    await _company(database, other, "Globex")
    await _tab_asks(me, job, WHY)

    async with claude(applicant) as client:
        refused = await client.call_tool("save_answers", {"job_id": job, "answers": [{"name": "question_7", "answer": failing, **WRITTEN}]})
        # Nothing reached the tab.
        assert (await _tab_asks(me, job))[0]["answer"] is None
        saved = await client.call_tool("save_answers", {"job_id": job, "answers": [{"name": "question_7", "answer": CLEAN, **WRITTEN}]})

    assert refused.is_error, check
    message = refused.content[0].text
    assert "question_7" in message and reason in message, message
    assert saved.is_error is False, saved.content
    assert (await _tab_asks(me, job))[0]["answer"] == CLEAN


async def test_an_answer_the_student_reads_first_is_saved_and_named_back(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    proud = {"name": "question_8", "label": "Tell us about a project you are proud of.", "required": False, "max_length": None}
    await _tab_asks(me, job, WHY, proud)

    async with claude(applicant) as client:
        saved = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": CLEAN, **WRITTEN}, {"name": "question_8", "answer": "At Acme I cut page load time by 30%.", **WRITTEN}]})

    assert saved.is_error is False, saved.content
    # Saved and filled like any answer, but "why here" is named for the student to read before Submit.
    assert saved.structured_content["read_first"] == ["question_7"]
    assert [q["answer"] for q in await _tab_asks(me, job)] == [CLEAN, "At Acme I cut page load time by 30%."]


async def test_one_failing_answer_keeps_the_others_from_saving(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    proud = {"name": "question_8", "label": "Tell us about a project you are proud of.", "required": False, "max_length": None}
    await _tab_asks(me, job, WHY, proud)

    async with claude(applicant) as client:
        refused = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": CLEAN, **WRITTEN}, {"name": "question_8", "answer": "A robust tool!", **WRITTEN}]})

    assert refused.is_error
    assert "question_8" in refused.content[0].text and "question_7" not in refused.content[0].text
    assert [q["answer"] for q in await _tab_asks(me, job)] == [None, None]


async def test_an_answer_about_one_company_is_never_offered_on_anothers_form(running, applicant, database):  # noqa: F811
    me, (acme, globex, acme_again) = await _student_queues(database, applicant, 3)
    await _company(database, globex, "Globex")
    proud = {"name": "question_8", "label": "Tell us about a project you are proud of.", "required": False, "max_length": None}
    general = "I built a resume builder with FastAPI, and students used it to make their first resumes."
    for job in (acme, globex, acme_again):
        await _tab_asks(me, job, WHY, proud)

    async with claude(applicant) as client:
        saved = await client.call_tool("save_answers", {"job_id": acme, "answers": [
            {"name": "question_7", "answer": CLEAN, **WRITTEN}, {"name": "question_8", "answer": general, **WRITTEN}]})
    assert saved.is_error is False, saved.content

    async with database() as db:
        on_globex = await pipeline.answer_bank(db, applicant, globex)
        on_acme = await pipeline.answer_bank(db, applicant, acme_again)

    assert {q: a.answer for q, a in on_globex.items()} == {proud["label"]: general}
    assert {q: a.answer for q, a in on_acme.items()} == {WHY["label"]: CLEAN, proud["label"]: general}


async def test_a_written_answer_needs_its_claim_check_and_keeps_it(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY)
    cut = ["I led the whole team"]

    async with claude(applicant) as client:
        unchecked = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": CLEAN}]})
        saved = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": CLEAN, **WRITTEN, "unsupported": cut}]})

    assert unchecked.is_error and "claim check" in unchecked.content[0].text
    assert saved.is_error is False, saved.content
    async with database() as session:
        stored = (await session.execute(text(
            "SELECT review FROM written_answers WHERE job_id = :j AND name = 'question_7'"), {"j": job})).scalar_one()
    assert stored["unsupported"] == cut


async def test_a_claim_the_check_cut_must_be_gone_from_the_answer(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY)

    async with claude(applicant) as client:
        kept = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": CLEAN, **WRITTEN, "unsupported": ["cut page load time by 30%"]}]})

    assert kept.is_error and "still" in kept.content[0].text
    assert (await _tab_asks(me, job))[0]["answer"] is None


async def test_a_number_from_the_companys_checked_brief_is_allowed_and_an_invented_one_refused(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _company(database, job, "Initech")
    async with database() as session:
        session.add(Company_Brief(company_key=briefs.company_key("Initech"), company="Initech", saved_at=text("now()"), facts=[{
            "category": "launches", "fact": "Initech launched Ledger in 37 countries.",
            "url": "https://initech.example/news", "quote": "Ledger is now live in 37 countries", "published": "2026-03",
        }]))
        await session.commit()
    await _tab_asks(me, job, WHY)

    async with claude(applicant) as client:
        invented = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": "Ledger reaching 90 countries is why I want in; at Acme I cut page load time by 30%.", **WRITTEN}]})
        from_brief = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": "Ledger reaching 37 countries is why I want in; at Acme I cut page load time by 30%.", **WRITTEN}]})

    assert invented.is_error and "90" in invented.content[0].text, invented.content
    assert from_brief.is_error is False, from_brief.content


async def test_a_company_named_only_in_skills_or_bullets_is_still_another_applications(running, applicant, database):  # noqa: F811
    me, (job, other) = await _student_queues(database, applicant, 2)
    await _company(database, other, "Globex")
    async with database() as session:  # Globex as a tool and in a bullet, never where the student worked
        await session.execute(text("UPDATE bank_skills SET name = 'Globex' WHERE applicant_id = :a AND name = 'Docker'"),
                              {"a": applicant})
        await session.execute(text("UPDATE bank_bullets SET text = 'Wrote the Globex plugin''s tests' "
                                   "WHERE text = 'Wrote the billing service''s tests'"))
        await session.commit()
    await _tab_asks(me, job, WHY)

    async with claude(applicant) as client:
        refused = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": "At Acme I cut page load time by 30%, and I want that at Globex.", **WRITTEN}]})

    assert refused.is_error and "Globex" in refused.content[0].text, refused.content


@pytest.mark.parametrize("where", ["Acme", "Stony Brook University"])
async def test_where_the_student_worked_or_studied_is_theirs_to_name(running, applicant, database, where):  # noqa: F811
    me, (job, other) = await _student_queues(database, applicant, 2)
    await _company(database, other, where)
    async with database() as session:  # the school only as the education entry's title, not an award's issuer
        await session.execute(text("UPDATE bank_entries SET organization = NULL WHERE applicant_id = :a AND section = 'awards'"),
                              {"a": applicant})
        await session.commit()
    await _tab_asks(me, job, WHY)
    answer = f"At {where} I learned to cut page load time by 30%, and I want to keep making pages fast."

    async with claude(applicant) as client:
        saved = await client.call_tool("save_answers", {"job_id": job, "answers": [{"name": "question_7", "answer": answer, **WRITTEN}]})

    assert saved.is_error is False, saved.content


# --- The Essay plan (KAN-369) ---

def _with(plan_changes: dict) -> dict:
    return {**WRITTEN, "plan": {**WRITTEN["plan"], **plan_changes}}


async def test_a_written_answer_needs_its_plan_and_keeps_it(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY)
    invented = {"slots": [{"slot": "answer", "quotes": ["Cut page load time by 45%"]},
                          {"slot": "episode", "quotes": ["Wrote the billing service's tests"]}]}
    unbacked = {"slots": [{"slot": "answer", "quotes": ["Cut page load time by 30%"]}]}

    async with claude(applicant) as client:
        unplanned = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": CLEAN, "unsupported": []}]})
        made_up = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": CLEAN, **_with(invented)}]})
        bare = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": CLEAN, **_with(unbacked)}]})
        assert (await _tab_asks(me, job))[0]["answer"] is None
        saved = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": CLEAN, **_with({"story": "Cut page load time by 30%"})}]})

    assert unplanned.is_error and "no plan" in unplanned.content[0].text
    assert made_up.is_error and "45%" in made_up.content[0].text
    assert bare.is_error and "episode" in bare.content[0].text
    assert saved.is_error is False, saved.content
    async with database() as session:
        stored = (await session.execute(text(
            "SELECT review FROM written_answers WHERE job_id = :j AND name = 'question_7'"), {"j": job})).scalar_one()
    assert stored["plan"]["story"] == "Cut page load time by 30%"
    assert stored["plan"]["slots"]["episode"] == ["Wrote the billing service's tests"]


async def test_no_story_leads_two_answers_on_one_application(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    proud = {"name": "question_8", "label": "Tell us about a project you are proud of.", "required": False, "max_length": None}
    await _tab_asks(me, job, WHY, proud)
    led = _with({"story": "Cut page load time by 30%"})

    async with claude(applicant) as client:
        together = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": CLEAN, **led}, {"name": "question_8", "answer": "At Acme I cut page load time by 30%.", **led}]})
        first = await client.call_tool("save_answers", {"job_id": job, "answers": [{"name": "question_7", "answer": CLEAN, **led}]})
        again = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_8", "answer": "At Acme I cut page load time by 30%.", **led}]})

    assert together.is_error and "question_7" in together.content[0].text
    assert first.is_error is False, first.content
    assert again.is_error and "already leads" in again.content[0].text


async def test_the_plans_company_fact_is_the_answers_named_fact(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _company(database, job, "Initech")
    fact = "Initech launched Ledger in 37 countries."
    async with database() as session:
        session.add(Company_Brief(company_key=briefs.company_key("Initech"), company="Initech", saved_at=text("now()"), facts=[{
            "category": "launches", "fact": fact, "url": "https://initech.example/news",
            "quote": "Ledger is now live in 37 countries", "published": "2026-03",
        }]))
        await session.commit()
    await _tab_asks(me, job, WHY)
    plan = {"type": "why-company", "company_fact": fact, "slots": [
        {"slot": "company-fact", "quotes": [fact]}, {"slot": "own-match", "quotes": ["Cut page load time by 30%"]}]}

    async with claude(applicant) as client:
        saved = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": "Ledger reaching 37 countries is why I want in; at Acme I cut page load time by 30%.",
             "plan": plan, "unsupported": []}]})

    assert saved.is_error is False, saved.content
    async with database() as session:
        named = (await session.execute(text(
            "SELECT named_fact FROM written_answers WHERE job_id = :j AND name = 'question_7'"), {"j": job})).scalar_one()
    assert named == {"fact": fact, "url": "https://initech.example/news"}
