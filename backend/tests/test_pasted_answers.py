"""
Written Answers without Claude (KAN-385), spec seam 2: the webapp's page
lists every question the open batch tabs need written, and the student
pastes an answer to each, driven through the API the page calls, against
this run's throwaway test database. A pasted answer goes through the same
save and checks as the connector's (pipeline.save_answers, checks.py), so a
failing one is refused with its reasons and never reaches the tab, and a
passing one is what the tab reads and fills. The one check a paste skips
is copying the student's own writing samples: the student put the text
there themselves, and that check exists to stop their Claude parroting
the samples.
"""

import pytest
from sqlalchemy import text

from app.auto_apply import pipeline, written
from tests.test_connector import (  # noqa: F401  (fixtures)
    _api,
    _signed_in_as,
    _student_queues,
    _tab_asks,
    applicant,
    claude,
    running,
)
from tests.test_connector_checks import CHECKS, CLEAN, SAMPLE, WHY, _company

pytestmark = pytest.mark.anyio

PROUD = {"name": "question_8", "label": "Tell us about a project you are proud of.", "required": False, "max_length": None}


async def _page(me: str) -> list[dict]:
    """What the Written Answers page lists."""
    async with _api() as webapp:
        res = await webapp.get(f"{me}/written-questions")
    assert res.status_code == 200, res.text
    return res.json()


async def _paste(me: str, job: str, **answers: str):
    async with _api() as webapp:
        return await webapp.put(
            f"{me}/applications/{job}/written-answers",
            json={"answers": [{"name": n, "answer": a} for n, a in answers.items()]},
        )


async def test_the_page_lists_every_unanswered_question_by_posting(running, applicant, database):  # noqa: F811
    me, (first, second, _asked_nothing, gone) = await _student_queues(database, applicant, 4)
    await _company(database, second, "Globex")
    await _tab_asks(me, first, WHY)
    await _tab_asks(me, second, WHY, PROUD)
    await _tab_asks(me, gone, PROUD)
    # Third's form asked nothing written; gone's application was skipped, so its form is closed.
    async with _api() as extension:
        assert (await extension.post(f"{me}/applications/{gone}/finish", json={"outcome": "skipped"})).status_code == 200
    # First's question is answered already.
    assert (await _paste(me, first, question_7=CLEAN)).status_code == 200

    page = await _page(me)

    assert [p["job_id"] for p in page] == [second]
    assert page[0]["company"] == "Globex" and page[0]["title"]
    assert [(q["name"], q["label"], q["max_length"]) for q in page[0]["questions"]] == [
        ("question_7", WHY["label"], 300), ("question_8", PROUD["label"], None),
    ]


# Every check but copying the student's own samples, which a paste skips (below).
PASTE_CHECKS = {name: check for name, check in CHECKS.items() if name != "copied from a writing sample"}


@pytest.mark.parametrize("check", PASTE_CHECKS)
async def test_a_pasted_answer_that_fails_a_check_is_refused_with_its_reason(running, applicant, database, monkeypatch, check):  # noqa: F811
    failing, reason = PASTE_CHECKS[check]

    async def samples(db, applicant_id):
        return [SAMPLE]

    monkeypatch.setattr(written, "writing_samples", samples)
    me, (job, other) = await _student_queues(database, applicant, 2)
    await _company(database, other, "Globex")
    await _tab_asks(me, job, WHY)

    refused = await _paste(me, job, question_7=failing)

    assert refused.status_code == 422, refused.text
    reasons = refused.json()["detail"]["reasons"]
    assert list(reasons) == ["question_7"] and any(reason in r for r in reasons["question_7"]), reasons
    # Nothing reached the tab, and the page still lists the question.
    assert (await _tab_asks(me, job))[0]["answer"] is None
    assert [q["name"] for q in (await _page(me))[0]["questions"]] == ["question_7"]


async def test_a_passing_answer_is_what_the_tab_fills_and_leaves_the_page(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY, PROUD)

    saved = await _paste(me, job, question_7=f"  {CLEAN}\n")

    assert saved.status_code == 200, saved.text
    assert saved.json() == {"saved": 1, "left": 1}
    # The tab's poll (GET .../questions) reads it, trimmed, as it reads the connector's.
    assert [q["answer"] for q in await _tab_asks(me, job)] == [CLEAN, None]
    assert [q["name"] for q in (await _page(me))[0]["questions"]] == ["question_8"]
    # The student's Claude is not asked for it again.
    async with database() as db:
        left = await pipeline.next_to_write(db, applicant)
    assert [q.name for q in left.questions] == ["question_8"]


async def test_a_paste_is_refused_for_a_question_or_application_that_isnt_open(running, applicant, database):  # noqa: F811
    me, (job, closed) = await _student_queues(database, applicant, 2)
    await _tab_asks(me, job, WHY)
    await _tab_asks(me, closed, WHY)
    async with _api() as extension:
        await extension.post(f"{me}/applications/{closed}/finish", json={"outcome": "submitted"})

    unknown = await _paste(me, job, question_9=CLEAN)
    empty = await _paste(me, job, question_7="   ")
    sent = await _paste(me, closed, question_7=CLEAN)

    assert unknown.status_code == 422 and list(unknown.json()["detail"]["reasons"]) == ["question_9"]
    assert empty.status_code == 422 and list(empty.json()["detail"]["reasons"]) == ["question_7"]
    assert sent.status_code == 409, sent.text
    assert [p["job_id"] for p in await _page(me)] == [job]


async def test_only_the_student_reads_or_pastes_their_answers(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY)
    async with database() as session:
        other = (await session.execute(text("SELECT gen_random_uuid()"))).scalar_one()
    _signed_in_as(other)

    assert (await _paste(me, job, question_7=CLEAN)).status_code == 403
    async with _api() as webapp:
        assert (await webapp.get(f"{me}/written-questions")).status_code == 403


async def test_the_student_may_paste_their_own_writing_sample_but_their_claude_may_not(running, applicant, database):  # noqa: F811
    """The 5-word copy check stops the student's Claude parroting their
    samples; a sample the student pastes in themselves is their choice. It
    is saved, stays through the tab's re-check (PUT .../questions with the
    form's limit) and is offered on their next form, while their Claude
    saving the same words is still refused."""
    me, (job, claudes, later) = await _student_queues(database, applicant, 3)
    async with _api() as webapp:
        added = await webapp.post(f"{me}/writing-samples", json={"text": SAMPLE})
    assert added.status_code == 201, added.text
    for each in (job, claudes, later):
        await _tab_asks(me, each, PROUD)

    pasted = await _paste(me, job, question_8=SAMPLE)
    async with claude(applicant) as client:
        parroted = await client.call_tool("save_answers", {"job_id": claudes, "answers": [
            {"name": "question_8", "answer": SAMPLE}]})

    assert pasted.status_code == 200, pasted.text
    assert [q["answer"] for q in await _tab_asks(me, job, PROUD)] == [SAMPLE]
    assert parroted.is_error and "writing samples" in parroted.content[0].text
    assert (await _tab_asks(me, claudes))[0]["answer"] is None
    async with database() as db:
        bank = await pipeline.answer_bank(db, applicant, later)
    assert {q: a.answer for q, a in bank.items()} == {PROUD["label"]: SAMPLE}
