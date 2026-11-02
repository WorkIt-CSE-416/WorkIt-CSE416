"""
The uninstall survey (KAN-471): removing the extension opens the webapp's
/uninstalled page, whose one question goes to POST /uninstall-answers with
no sign-in. The row names no account and no address; a per-sender and a
per-day cap keep the open route from filling the table.
"""

import httpx
import pytest
from sqlalchemy import text

from app.main import app
from app.routers import uninstall_answers

pytestmark = pytest.mark.anyio


@pytest.fixture(autouse=True)
def fresh_caps():
    uninstall_answers.reset_sender_counts()
    yield
    uninstall_answers.reset_sender_counts()


async def _send(body: dict, ip: str = "203.0.113.7") -> httpx.Response:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost:8000") as api:
        return await api.post("/uninstall-answers", json=body, headers={"x-workit-client-ip": ip})


async def _rows(database) -> list[tuple]:
    async with database() as session:
        result = await session.execute(text("SELECT reason, detail, extension_version FROM uninstall_answers ORDER BY created_at"))
        return [tuple(row) for row in result.all()]


async def test_an_answer_is_stored_with_no_account_or_address(database):
    response = await _send({"reason": "bad_fills", "detail": "  It left Workday blank.  ", "version": "0.1.0"})
    assert response.status_code == 201
    assert (await _send({"reason": "found_job"})).status_code == 201

    assert await _rows(database) == [("bad_fills", "It left Workday blank.", "0.1.0"), ("found_job", None, None)]
    async with database() as session:
        columns = (await session.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'uninstall_answers'"))).scalars().all()
    assert sorted(columns) == ["created_at", "detail", "extension_version", "id", "reason"]


async def test_anything_but_the_one_question_is_refused(database):
    for refused in (
        {"reason": "not_a_reason"},
        {},
        {"reason": "other", "detail": "x" * 501},
        {"reason": "other", "email": "sam@example.com"},
        {"reason": "other", "version": "<script>"},
    ):
        assert (await _send(refused)).status_code == 422, refused
    assert await _rows(database) == []


async def test_one_sender_is_capped_for_the_day_and_another_is_not(database):
    for _ in range(uninstall_answers.PER_SENDER_PER_DAY):
        assert (await _send({"reason": "other"})).status_code == 201
    assert (await _send({"reason": "other"})).status_code == 429
    assert (await _send({"reason": "other"}, ip="198.51.100.4")).status_code == 201
    assert len(await _rows(database)) == uninstall_answers.PER_SENDER_PER_DAY + 1


async def test_the_day_is_capped_for_everyone(database, monkeypatch):
    monkeypatch.setattr(uninstall_answers, "PER_DAY", 2)
    assert (await _send({"reason": "other"}, ip="198.51.100.1")).status_code == 201
    assert (await _send({"reason": "other"}, ip="198.51.100.2")).status_code == 201
    assert (await _send({"reason": "other"}, ip="198.51.100.3")).status_code == 429
    assert len(await _rows(database)) == 2
