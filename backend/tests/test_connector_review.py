"""
The pre-submit review (KAN-369): once an application's written questions are
all answered, the connector offers its answers to the student's Claude for a
re-read (get_review_task), and the answers Claude reports (save_review) show
in the batch tab as needing the student. Spec seam 2: driven over MCP as
Claude drives the connector, against this run's throwaway test database.
"""

import uuid

import pytest

from tests.test_connector import (  # noqa: F401  (fixtures)
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

WHY = {"name": "question_7", "label": "Why do you want to work here?", "required": True, "max_length": None}
PROUD = {"name": "question_8", "label": "Tell us about a project you are proud of.", "required": False, "max_length": None}
WHY_ACME = "At Acme I cut page load time by 30%, and I want to keep making pages fast on your team."
PROJECT = "I built a resume builder with FastAPI, and students used it to make their first resumes."


def _versions(task: dict) -> dict[str, str]:
    return {a["name"]: a["version"] for a in task["answers"]}


async def test_a_flagged_answer_shows_in_the_tab_until_it_changes(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY, PROUD)

    async with claude(applicant) as client:
        await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": WHY_ACME, **WRITTEN}, {"name": "question_8", "answer": PROJECT, **WRITTEN}]})
        task = (await client.call_tool("get_review_task", {})).structured_content
        saved = await client.call_tool("save_review", {"job_id": job, "versions": _versions(task), "problems": [
            {"name": "question_8", "reason": "It says students used the tool; the experience doesn't."}]})
        after = (await client.call_tool("get_review_task", {})).structured_content
        unknown = await client.call_tool("save_review", {"job_id": job, "versions": {}, "problems": [{"name": "nope", "reason": "x"}]})

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
            {"name": "question_8", "answer": "I built a resume builder with FastAPI for students.", **WRITTEN}]})
        again = (await client.call_tool("get_review_task", {})).structured_content
    assert again["job_id"] == job
    assert [(r["reviewed"], r["flag"]) for r in await _tab_asks(me, job)] == [(True, None), (False, None)]


async def test_an_application_with_a_question_unanswered_is_not_reviewed(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY, PROUD)

    async with claude(applicant) as client:
        await client.call_tool("save_answers", {"job_id": job, "answers": [{"name": "question_7", "answer": WHY_ACME, **WRITTEN}]})
        task = (await client.call_tool("get_review_task", {})).structured_content

    assert task["job_id"] is None


async def test_an_answer_edited_during_the_review_stays_due(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY, PROUD)
    edited = "I built a resume builder with FastAPI for students."

    async with claude(applicant) as client:
        await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": WHY_ACME, **WRITTEN}, {"name": "question_8", "answer": PROJECT, **WRITTEN}]})
        task = (await client.call_tool("get_review_task", {})).structured_content
        # The student edits question_8 while their Claude re-reads the old text.
        await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_8", "answer": edited, **WRITTEN}]})
        saved = await client.call_tool("save_review", {"job_id": job, "versions": _versions(task), "problems": [
            {"name": "question_8", "reason": "It says students used the tool; the experience doesn't."}]})
        again = (await client.call_tool("get_review_task", {})).structured_content

    assert saved.is_error is False, saved.content
    assert saved.structured_content == {"flagged": 0, "changed": ["question_8"]}
    assert [(r["reviewed"], r["flag"]) for r in await _tab_asks(me, job)] == [(True, None), (False, None)]
    assert again["job_id"] == job
    assert [a["answer"] for a in again["answers"]] == [WHY_ACME, edited]


WHY_STRIPE = "At Stripe I want to keep making pages fast, as I did when I cut page load time by 30%."
STRIPE = "At Stripe I want to keep making pages fast"


async def _tab_posts(me: str, job: str, path: str, body: dict):
    """The batch tab's flag card (the extension's call): Keep or Rewrite with Claude."""
    _signed_in_as(uuid.UUID(me.rsplit("/", 1)[1]))
    async with _api() as extension:
        return await extension.post(f"{me}/applications/{job}/review/{path}", json=body)


async def _flag_why(student, job: str) -> None:
    async with claude(student) as client:
        await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": WHY_STRIPE, **WRITTEN}, {"name": "question_8", "answer": PROJECT, **WRITTEN}]})
        task = (await client.call_tool("get_review_task", {})).structured_content
        saved = await client.call_tool("save_review", {"job_id": job, "versions": _versions(task), "problems": [
            {"name": "question_7", "reason": "Names Stripe; this job is at Acme.", "quote": STRIPE, "wrong_company": True}]})
    assert saved.is_error is False, saved.content


async def test_a_flag_carries_its_sentence_and_whether_it_names_the_wrong_company(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY, PROUD)
    await _flag_why(applicant, job)

    rows = await _tab_asks(me, job)
    assert [(r["flag"], r["flag_quote"], r["flag_hard"]) for r in rows] == [
        ("Names Stripe; this job is at Acme.", STRIPE, True), (None, None, False)]

    # A sentence that isn't in the answer is refused: the tab couldn't show it.
    async with claude(applicant) as client:
        task = (await client.call_tool("get_review_task", {})).structured_content
        refused = await client.call_tool("save_review", {"job_id": job, "versions": _versions(task) or {}, "problems": [
            {"name": "question_7", "reason": "Names Stripe.", "quote": "Not in the answer"}]})
    assert task["job_id"] is None and refused.is_error


async def test_a_kept_flag_clears_and_a_later_review_does_not_flag_that_text_again(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY, PROUD)
    await _flag_why(applicant, job)

    kept = await _tab_posts(me, job, "keep", {"name": "question_7"})
    assert kept.status_code == 204, kept.text
    assert [r["flag"] for r in await _tab_asks(me, job)] == [None, None]

    # Another answer changes, so the application is reviewed again; the same flag on the kept text doesn't show.
    async with claude(applicant) as client:
        await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_8", "answer": "I built a resume builder with FastAPI for students.", **WRITTEN}]})
        task = (await client.call_tool("get_review_task", {})).structured_content
        saved = await client.call_tool("save_review", {"job_id": job, "versions": _versions(task), "problems": [
            {"name": "question_7", "reason": "Names Stripe; this job is at Acme.", "quote": STRIPE, "wrong_company": True}]})
    assert saved.structured_content["flagged"] == 0
    assert [(r["reviewed"], r["flag"]) for r in await _tab_asks(me, job)] == [(True, None), (True, None)]
    assert (await _tab_posts(me, job, "keep", {"name": "question_8"})).status_code == 422  # not flagged


async def test_rewrite_with_claude_hands_the_answer_back_with_the_reason(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY, PROUD)
    await _flag_why(applicant, job)

    sent = await _tab_posts(me, job, "rewrite", {"name": "question_7"})
    assert sent.status_code == 204, sent.text
    assert [(r["answer"], r["flag"]) for r in await _tab_asks(me, job)] == [(None, None), (PROJECT, None)]

    async with claude(applicant) as client:
        nxt = (await client.call_tool("get_next_application", {})).structured_content
    assert nxt["job_id"] == job
    assert [(q["name"], q["rewrite"]) for q in nxt["questions"]] == [
        ("question_7", {"reason": "Names Stripe; this job is at Acme.", "quote": STRIPE, "answer": WHY_STRIPE})]

    # Claude's new answer is reviewed as any other; the rewrite's reason is no longer handed out.
    async with claude(applicant) as client:
        await client.call_tool("save_answers", {"job_id": job, "answers": [{"name": "question_7", "answer": WHY_ACME, **WRITTEN}]})
        task = (await client.call_tool("get_review_task", {})).structured_content
    assert task["job_id"] == job
    assert (await _tab_posts(me, job, "rewrite", {"name": "question_8"})).status_code == 422  # not flagged
