"""
Answers captured from a form (KAN-369): the student's own words, typed
into a batch tab's field, are saved as they type (KAN-379's PUT
.../answers), and the Written Answers page marks each one New until the
student has seen it. The page tells new from seen by when the answer was
saved, so the page's list carries `answered_at`. Spec seam 2, against
this run's throwaway test database.
"""

import datetime

import pytest

from tests.test_connector import (  # noqa: F401  (fixtures)
    WHY,
    _api,
    _student_queues,
    _tab_asks,
    applicant,
    claude,
    running,
)

pytestmark = pytest.mark.anyio


async def test_an_answer_typed_into_a_form_is_listed_with_when_it_was_saved(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY)
    before = datetime.datetime.now(datetime.UTC)

    async with _api() as extension:
        res = await extension.put(f"{me}/applications/{job}/answers",
                                  json={"name": WHY["name"], "label": WHY["label"], "answer": "My own words.", "own": True})
        assert res.status_code == 200, res.text
        page = await extension.get(f"{me}/written-answers")

    assert page.status_code == 200, page.text
    (posting,) = page.json()
    (question,) = posting["questions"]
    assert question["own"] is True and question["answer"] == "My own words."
    saved = datetime.datetime.fromisoformat(question["answered_at"])
    assert before - datetime.timedelta(minutes=1) < saved < before + datetime.timedelta(minutes=1)
