"""
The checks on every answer the student's Claude saves (KAN-380), spec seam
2: driven over MCP as Claude drives the connector (test_connector.py's
client), against this run's throwaway test database. Each check refuses a
failing answer with a reason Claude can act on, which never reaches the
tab, and passes a clean one. The checks themselves: test_answer_checks.py.
"""

import pytest
from sqlalchemy import text

from app.auto_apply import pipeline, written
from tests.test_connector import (  # noqa: F401  (fixtures)
    REVIEWED,
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
        refused = await client.call_tool("save_answers", {"job_id": job, "answers": [{"name": "question_7", "answer": failing, "review": REVIEWED}]})
        # Nothing reached the tab.
        assert (await _tab_asks(me, job))[0]["answer"] is None
        saved = await client.call_tool("save_answers", {"job_id": job, "answers": [{"name": "question_7", "answer": CLEAN, "review": REVIEWED}]})

    assert refused.is_error, check
    message = refused.content[0].text
    assert "question_7" in message and reason in message, message
    assert saved.is_error is False, saved.content
    assert (await _tab_asks(me, job))[0]["answer"] == CLEAN


async def test_one_failing_answer_keeps_the_others_from_saving(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    proud = {"name": "question_8", "label": "Tell us about a project you are proud of.", "required": False, "max_length": None}
    await _tab_asks(me, job, WHY, proud)

    async with claude(applicant) as client:
        refused = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": CLEAN, "review": REVIEWED}, {"name": "question_8", "answer": "A robust tool!", "review": REVIEWED}]})

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
            {"name": "question_7", "answer": CLEAN, "review": REVIEWED}, {"name": "question_8", "answer": general, "review": REVIEWED}]})
    assert saved.is_error is False, saved.content

    async with database() as db:
        on_globex = await pipeline.answer_bank(db, applicant, globex)
        on_acme = await pipeline.answer_bank(db, applicant, acme_again)

    assert {q: a.answer for q, a in on_globex.items()} == {proud["label"]: general}
    assert {q: a.answer for q, a in on_acme.items()} == {WHY["label"]: CLEAN, proud["label"]: general}


async def test_a_written_answer_needs_its_review_at_the_bar_and_keeps_it(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY)
    cut = ["I led the whole team"]

    async with claude(applicant) as client:
        unreviewed = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": CLEAN}]})
        weak = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": CLEAN, "review": {"rating": 7, "unsupported": []}}]})
        saved = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": CLEAN, "review": {"rating": 8, "unsupported": cut}}]})

    assert unreviewed.is_error and "review" in unreviewed.content[0].text
    assert weak.is_error and "7" in weak.content[0].text
    assert saved.is_error is False, saved.content
    async with database() as session:
        stored = (await session.execute(text(
            "SELECT review FROM written_answers WHERE job_id = :j AND name = 'question_7'"), {"j": job})).scalar_one()
    assert stored == {"rating": 8, "unsupported": cut}


async def test_a_claim_the_check_cut_must_be_gone_from_the_answer(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY)

    async with claude(applicant) as client:
        kept = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": CLEAN, "review": {"rating": 9, "unsupported": ["cut page load time by 30%"]}}]})

    assert kept.is_error and "still" in kept.content[0].text
    assert (await _tab_asks(me, job))[0]["answer"] is None
