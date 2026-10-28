"""
The connector's chats (KAN-381), spec seam 2: a chat writes a few
applications and then asks for a new one, and a new chat picks up where
the last one stopped, as after a Claude usage limit. Driven by the MCP
client as Claude drives it, on this run's throwaway test database.
"""

import pytest

from app.config import get_settings
from tests import test_connector
from tests.test_connector import (
    PROUD,
    WHY,
    WRITTEN,
    _student_queues,
    _tab_asks,
    claude,
)

pytestmark = pytest.mark.anyio

# test_connector's fixtures: the API running, and a student.
running = test_connector.running
applicant = test_connector.applicant


@pytest.fixture
def cap_of(monkeypatch):
    def set_cap(n: int) -> None:
        monkeypatch.setattr(get_settings(), "connector_chat_cap", n)
    return set_cap


async def _next(client, chat: str = "") -> dict:
    result = await client.call_tool("get_next_application", {"chat": chat} if chat else {})
    assert not result.is_error, result.content
    return result.structured_content


async def _save(client, job: str, *names: str) -> None:
    answers = [{"name": name, "answer": "I built a tool that cut page load time by 30%.", **WRITTEN} for name in names]
    result = await client.call_tool("save_answers", {"job_id": job, "answers": answers})
    assert not result.is_error, result.content


async def test_after_the_cap_a_chat_is_told_to_start_a_new_one(running, applicant, database, cap_of):
    cap_of(2)
    me, jobs = await _student_queues(database, applicant, 3)
    for job in jobs:
        await _tab_asks(me, job, WHY)

    async with claude(applicant) as client:
        first = await _next(client)
        await _save(client, first["job_id"], "question_7")
        second = await _next(client, first["chat"])
        await _save(client, second["job_id"], "question_7")
        third = await _next(client, second["chat"])

    assert [first["job_id"], second["job_id"]] == jobs[:2]
    assert not first["start_new_chat"] and not second["start_new_chat"]
    # The cap: no third application in this chat, and a line for the student.
    assert third["start_new_chat"] is True
    assert third["job_id"] is None
    assert "new chat" in third["message"]


async def test_a_new_chat_resumes_at_the_first_application_without_answers(running, applicant, database, cap_of):
    cap_of(5)
    me, jobs = await _student_queues(database, applicant, 3)
    for job in jobs:
        await _tab_asks(me, job, WHY, PROUD)

    async with claude(applicant) as client:
        first = await _next(client)
        await _save(client, first["job_id"], "question_7", "question_8")
        # The second application is handed out, then the chat hits a usage
        # limit before anything is saved.
        await _next(client, first["chat"])

    async with claude(applicant) as client:
        resumed = await _next(client)

    assert resumed["job_id"] == jobs[1]
    assert resumed["start_new_chat"] is False


async def test_a_chat_never_gets_back_an_application_it_left_a_question_of(running, applicant, database, cap_of):
    cap_of(5)
    me, jobs = await _student_queues(database, applicant, 2)
    for job in jobs:
        await _tab_asks(me, job, WHY, PROUD)

    async with claude(applicant) as client:
        first = await _next(client)
        # Claude has no fact for the second question: it saves the first only.
        await _save(client, first["job_id"], "question_7")
        second = await _next(client, first["chat"])
        done = await _next(client, second["chat"])

    assert second["job_id"] == jobs[1]
    # Every application is handed out once in this chat.
    assert (done["job_id"], done["start_new_chat"]) == (None, False)


async def test_a_chat_value_from_nowhere_starts_a_new_chat(running, applicant, database, cap_of):
    cap_of(1)
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY)

    async with claude(applicant) as client:
        got = await _next(client, "not a chat value")

    assert got["job_id"] == job
