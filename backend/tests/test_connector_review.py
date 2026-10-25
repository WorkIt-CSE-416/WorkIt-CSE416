"""
The pre-submit review (KAN-369): once an application's written questions are
all answered, the connector offers its answers to the student's Claude for a
re-read (get_review_task), and the answers Claude reports (save_review) show
in the batch tab as needing the student. Spec seam 2: driven over MCP as
Claude drives the connector, against this run's throwaway test database.
"""

import pytest

from tests.test_connector import (  # noqa: F401  (fixtures)
    _student_queues,
    _tab_asks,
    applicant,
    claude,
    running,
)

pytestmark = pytest.mark.anyio

WHY = {"name": "question_7", "label": "Why do you want to work here?", "required": True, "max_length": None}
PROUD = {"name": "question_8", "label": "Tell us about a project you are proud of.", "required": False, "max_length": None}
WHY_ACME = "At Acme I cut page load time by 30%, and I want to keep making pages fast on your team."
PROJECT = "I built a resume builder with FastAPI, and students used it to make their first resumes."


async def test_a_flagged_answer_shows_in_the_tab_until_it_changes(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY, PROUD)

    async with claude(applicant) as client:
        await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": WHY_ACME}, {"name": "question_8", "answer": PROJECT}]})
        task = (await client.call_tool("get_review_task", {})).structured_content
        saved = await client.call_tool("save_review", {"job_id": job, "problems": [
            {"name": "question_8", "reason": "It says students used the tool; the experience doesn't."}]})
        after = (await client.call_tool("get_review_task", {})).structured_content
        unknown = await client.call_tool("save_review", {"job_id": job, "problems": [{"name": "nope", "reason": "x"}]})

    assert task["job_id"] == job and task["company"] == "Acme"
    assert [(a["name"], a["answer"]) for a in task["answers"]] == [("question_7", WHY_ACME), ("question_8", PROJECT)]
    assert saved.is_error is False, saved.content
    assert after["job_id"] is None
    assert unknown.is_error
    rows = await _tab_asks(me, job)
    assert [(r["reviewed"], r["flag"]) for r in rows] == [
        (True, None), (True, "It says students used the tool; the experience doesn't.")]

    # Saved again (the student's edit of it, or Claude's fix): its flag is gone and it is offered again.
    async with claude(applicant) as client:
        await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_8", "answer": "I built a resume builder with FastAPI for students."}]})
        again = (await client.call_tool("get_review_task", {})).structured_content
    assert again["job_id"] == job
    assert [(r["reviewed"], r["flag"]) for r in await _tab_asks(me, job)] == [(True, None), (False, None)]


async def test_an_application_with_a_question_unanswered_is_not_reviewed(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY, PROUD)

    async with claude(applicant) as client:
        await client.call_tool("save_answers", {"job_id": job, "answers": [{"name": "question_7", "answer": WHY_ACME}]})
        task = (await client.call_tool("get_review_task", {})).structured_content

    assert task["job_id"] is None
