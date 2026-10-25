"""
Write early, reuse saved answers, keep the student's edits (KAN-379), spec
seam 2: the connector driven by the official MCP client as the student's
Claude drives it, and the batch tab's calls as the extension makes them,
against this run's throwaway test database (never Supabase).

Reading a job's questions from its link is the Fill engine's, in the
extension (autofiller_extension/test/write-early.spec.ts); what reaches
WorkIt is the same PUT .../questions a tab sends, only before any tab opens.
Filling a question from a saved answer is the engine's Plan, in the
extension, with GET .../answer-bank (pipeline.answer_bank) as its Answer bank.
"""

import uuid

import pytest

from tests.test_connector import (
    PROUD,
    WHY,
    _api,
    _signed_in_as,
    _student_queues,
    _tab_asks,
    claude,
)
from tests.test_connector_checks import _company

pytestmark = pytest.mark.anyio

GOALS = {"name": "question_9", "label": "What are you looking to gain from an internship?", "required": True, "max_length": None}
ROBOT = "I built a line-following robot with two friends, and it placed second at a regional contest."


@pytest.fixture
async def running():
    """The API with its lifespan running (tests/test_connector.py's)."""
    from app.deps import get_current_account
    from app.main import app

    async with app.router.lifespan_context(app):
        yield
    app.dependency_overrides.pop(get_current_account, None)


@pytest.fixture
async def applicant(database) -> uuid.UUID:
    from tests.test_built_resumes import _seed_applicant

    async with database() as session:
        return await _seed_applicant(session)


async def _bank(me: str, job: str) -> dict:
    """The saved answers a job's form may reuse, as the extension reads them for its Plan."""
    _signed_in_as(uuid.UUID(me.rsplit("/", 1)[1]))
    async with _api() as extension:
        res = await extension.get(f"{me}/applications/{job}/answer-bank")
    assert res.status_code == 200, res.text
    return res.json()


async def _student_answers(me: str, job: str, question: dict, answer: str) -> None:
    """The student's own words in a batch tab's field (the extension's call on their edit)."""
    _signed_in_as(uuid.UUID(me.rsplit("/", 1)[1]))
    async with _api() as extension:
        res = await extension.put(
            f"{me}/applications/{job}/answers",
            json={"name": question["name"], "label": question["label"], "answer": answer},
        )
    assert res.status_code == 200, res.text


async def _save(applicant, job: str, name: str, answer: str) -> None:
    async with claude(applicant) as client:
        result = await client.call_tool("save_answers", {"job_id": job, "answers": [{"name": name, "answer": answer}]})
    assert not result.is_error, result.content


async def _next_job(applicant) -> str | None:
    async with claude(applicant) as client:
        return (await client.call_tool("get_next_application", {})).structured_content["job_id"]


async def test_questions_read_at_queueing_reach_claude_before_any_tab_opens(running, applicant, database):
    # The extension read the third job's questions from its link when it was
    # queued: no tab for it has opened or filled (no PUT .../fill).
    me, (_, _, third) = await _student_queues(database, applicant, 3)
    await _tab_asks(me, third, GOALS)

    async with claude(applicant) as client:
        got = (await client.call_tool("get_next_application", {})).structured_content

    assert got["job_id"] == third
    assert [q["question"] for q in got["questions"]] == [GOALS["label"]]


async def test_an_application_with_no_question_left_unanswered_is_never_offered(running, applicant, database):
    me, (nothing, answered, by_student, left) = await _student_queues(database, applicant, 4)
    # Its form asks nothing written: no questions were sent.
    await _tab_asks(me, nothing)
    await _tab_asks(me, answered, PROUD)
    await _tab_asks(me, by_student, GOALS)
    await _tab_asks(me, left, WHY)
    await _save(applicant, answered, "question_8", ROBOT)
    # The student wrote this one in the tab before their Claude got to it.
    await _student_answers(me, by_student, GOALS, "Work on a team that ships software people use.")

    assert await _next_job(applicant) == left
    await _save(applicant, left, "question_7", "Acme builds the software I want to build.")
    assert await _next_job(applicant) is None


async def test_a_saved_answer_is_offered_to_later_forms_and_never_reaches_claude(running, applicant, database):
    """The next form's tab plans with the answer bank: the engine fills the
    saved question itself, so the tab sends only what is left to write."""
    me, (first, second) = await _student_queues(database, applicant, 2)
    await _company(database, second, "Globex")
    await _tab_asks(me, first, PROUD, WHY)
    async with claude(applicant) as client:
        saved = await client.call_tool("save_answers", {"job_id": first, "answers": [
            {"name": "question_8", "answer": ROBOT}, {"name": "question_7", "answer": "Acme builds the software I want to build."}]})
    assert not saved.is_error, saved.content

    bank = await _bank(me, second)
    # Saved by the question's wording, as the Fill engine's Answer bank takes it; the answer about Acme stays Acme's.
    assert bank == {PROUD["label"]: {"answer": ROBOT, "own": False}}
    # The second form asks the same question in its own case and spacing, and one more.
    same = {**PROUD, "name": "question_3", "label": "  tell us about a project you are PROUD of. "}
    await _tab_asks(me, second, *[q for q in (same, GOALS) if not _engine_banks(bank, q["label"])])

    async with claude(applicant) as client:
        got = (await client.call_tool("get_next_application", {})).structured_content
    assert got["job_id"] == second
    assert [q["question"] for q in got["questions"]] == [GOALS["label"]]


def _engine_banks(bank: dict, label: str) -> bool:
    """Whether the Fill engine's Answer bank lookup finds `label` (its own
    rule: any case or spacing; planner.ts, `banked`)."""
    def norm(text: str) -> str:
        return " ".join(text.lower().split()).strip(" *")

    return any(norm(filed) == norm(label) for filed in bank)


async def test_the_students_edit_replaces_the_answer_and_is_reused_from_then_on(running, applicant, database):
    me, (first, second, third) = await _student_queues(database, applicant, 3)
    for job in (first, second):
        await _tab_asks(me, job, PROUD)
    await _save(applicant, first, "question_8", ROBOT)

    await _student_answers(me, first, PROUD, "My own words about my robot.")

    # Their wording replaces their Claude's in the application, and a later save there never replaces it.
    assert (await _tab_asks(me, first))[0]["answer"] == "My own words about my robot."
    async with claude(applicant) as client:
        again = await client.call_tool("save_answers", {"job_id": first, "answers": [{"name": "question_8", "answer": ROBOT}]})
    assert not again.is_error, again.content
    assert (await _tab_asks(me, first))[0]["answer"] == "My own words about my robot."
    # Their Claude answers the same question on another form, later: the student's words still come first.
    await _save(applicant, second, "question_8", ROBOT)
    assert (await _bank(me, third))[PROUD["label"]] == {"answer": "My own words about my robot.", "own": True}


async def test_an_edit_to_a_field_a_saved_answer_filled_is_kept_for_later_forms(running, applicant, database):
    # The tab sent no question for it (the engine filled it from the bank); the student changed it.
    me, (first, second) = await _student_queues(database, applicant, 2)
    await _student_answers(me, first, GOALS, "To learn how a real team ships.")

    assert await _bank(me, second) == {GOALS["label"]: {"answer": "To learn how a real team ships.", "own": True}}
    # It asks the student's Claude for nothing.
    assert await _next_job(applicant) is None


async def test_an_edit_is_kept_only_for_the_students_own_application(running, applicant, database):
    from tests.test_connector import _another_students_application

    me, (job,) = await _student_queues(database, applicant, 1)
    other, theirs = await _another_students_application(database)
    _signed_in_as(applicant)
    async with _api() as extension:
        not_mine = await extension.put(f"{other}/applications/{theirs}/answers", json={"name": "q", "label": "Why?", "answer": "x"})
        no_application = await extension.put(f"{me}/applications/{uuid.uuid4()}/answers", json={"name": "q", "label": "Why?", "answer": "x"})
        blank = await extension.put(f"{me}/applications/{job}/answers", json={"name": "q", "label": "Why?", "answer": "  "})
        no_bank = await extension.get(f"{me}/applications/{uuid.uuid4()}/answer-bank")

    assert not_mine.status_code == 403
    assert no_application.status_code == 404
    assert blank.status_code == 422
    assert no_bank.status_code == 404
