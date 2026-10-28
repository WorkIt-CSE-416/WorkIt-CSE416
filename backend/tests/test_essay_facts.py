"""
Essay facts (KAN-369, Apply's Missing fact): a required slot of an Essay
plan that nothing of the student's states is asked of the student, never
invented. Their Claude saves the question through the connector, the
student sees it on the Written Answers page and in the batch tab, and
their answer joins the experience entry it is about, so the next plan can
quote it. Driven over MCP and the webapp's API, against this run's
throwaway test database.
"""

import uuid

import pytest

from tests.test_connector import (  # noqa: F401  (fixtures)
    WHY,
    WRITTEN,
    _api,
    _signed_in_as,
    _student_queues,
    _tab_asks,
    applicant,
    claude,
    running,
)

pytestmark = pytest.mark.anyio

FAILED = {"name": "question_8", "label": "Tell us about a time you failed.", "required": True, "max_length": None}
ASKED = "What do you do differently since the billing tests slipped?"
HABIT = "I write the test plan before I write any code."


async def _ask(client, job: str, about: str = "Software Intern, Acme"):
    return await client.call_tool("save_fact_question", {"job_id": job, "name": "question_8", "question": ASKED,
                                                         "about": about})


async def _answer_fact(me: str, job: str, answer: str = HABIT):
    _signed_in_as(uuid.UUID(me.rsplit("/", 1)[1]))
    async with _api() as webapp:
        return await webapp.put(f"{me}/applications/{job}/essay-facts", json={"name": "question_8", "answer": answer})


async def test_a_fact_asked_waits_for_the_student_and_joins_their_experience(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY, FAILED)

    async with claude(applicant) as client:
        asked = await _ask(client, job)
        saved = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": "At Acme I cut page load time by 30%, and I want to keep making pages fast.",
             **WRITTEN}]})
        # Nothing is left for their Claude until the student answers.
        waiting = (await client.call_tool("get_next_application", {})).structured_content

    assert asked.is_error is False, asked.content
    assert saved.is_error is False, saved.content
    assert waiting["job_id"] is None
    row = (await _tab_asks(me, job))[1]
    assert (row["answer"], row["ask"], row["ask_about"]) == (None, f"Essay fact: {ASKED}", "Software Intern, Acme")
    _signed_in_as(applicant)
    async with _api() as webapp:
        listed = (await webapp.get(f"{me}/written-questions")).json()
    assert [(q["name"], q["ask"]) for q in listed[0]["questions"]] == [("question_8", f"Essay fact: {ASKED}")]

    answered = await _answer_fact(me, job)

    assert answered.status_code == 200, answered.text
    assert answered.json() == {"entry": "Software Intern, Acme", "bullet": HABIT}
    async with claude(applicant) as client:
        again = (await client.call_tool("get_next_application", {})).structured_content
    assert again["job_id"] == job
    assert [q["name"] for q in again["questions"]] == ["question_8"]
    assert f"- {HABIT}" in again["experience"]
    assert (await _tab_asks(me, job))[1]["ask"] is None


async def test_a_fact_about_no_entry_or_an_answered_question_is_refused(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY, FAILED)

    async with claude(applicant) as client:
        nowhere = await _ask(client, job, about="Astronaut, NASA")
        await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_8", "answer": "At Acme I cut page load time by 30%.", **WRITTEN}]})
        answered = await _ask(client, job)

    assert nowhere.is_error and "heading" in nowhere.content[0].text
    assert answered.is_error and "answered already" in answered.content[0].text


async def test_an_answer_to_a_question_that_asked_nothing_is_refused(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, FAILED)

    res = await _answer_fact(me, job)

    assert res.status_code == 422
    assert res.json()["detail"]["reasons"] == {"question_8": ["It waits on no fact."]}
