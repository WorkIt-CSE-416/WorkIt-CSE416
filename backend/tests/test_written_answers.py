"""
Written answers (KAN-377) on real Postgres, through the routes batch apply's
tabs call: a tab sends the questions its form needs written, and reads back
the answers the student's Claude saved through the connector
(tests/test_connector.py drives that side).
"""

import pytest

from tests import test_built_resumes
from tests.test_batch_apply import _queue
from tests.test_sent_resumes import _seed_posting

student = test_built_resumes.student

pytestmark = pytest.mark.anyio

WHY = {"name": "question_7", "label": "Why do you want to work at Acme?", "required": True, "max_length": 2000}
PROUD = {"name": "question_8", "label": "Tell us about a project you are proud of.", "required": False, "max_length": None}


async def test_a_tab_sends_its_questions_and_reads_them_back_unanswered(student, database):
    client, me = student
    (job,) = await _queue(client, me, database, 1)

    res = await client.put(f"{me}/applications/{job}/questions", json={"questions": [WHY, PROUD]})

    assert res.status_code == 200, res.text
    back = (await client.get(f"{me}/applications/{job}/questions")).json()
    written = {"kind": None, "options": None, "answer": None}
    assert back == [{**WHY, **written}, {**PROUD, **written}]


async def test_questions_need_an_open_application(student, database):
    client, me = student
    job = await _seed_posting(database, "https://job-boards.greenhouse.io/acme/jobs/9")
    assert (await client.put(f"{me}/applications/{job}/questions", json={"questions": [WHY]})).status_code == 404
    assert (await client.get(f"{me}/applications/{job}/questions")).status_code == 404

    (queued,) = await _queue(client, me, database, 1)
    await client.post(f"{me}/applications/{queued}/finish", json={"outcome": "submitted"})
    assert (await client.put(f"{me}/applications/{queued}/questions", json={"questions": [WHY]})).status_code == 409


async def test_questions_are_capped(student, database):
    client, me = student
    (job,) = await _queue(client, me, database, 1)
    many = [{**WHY, "name": f"q{n}"} for n in range(51)]

    assert (await client.put(f"{me}/applications/{job}/questions", json={"questions": many})).status_code == 422
    assert (await client.put(f"{me}/applications/{job}/questions", json={"questions": [{**WHY, "label": "x" * 2001}]})).status_code == 422
