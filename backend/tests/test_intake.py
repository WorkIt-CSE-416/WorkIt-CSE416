"""
Intake's route (KAN-213): one turn of the chat that fills a draft entry card.
Seam 1 (the API on the real-Postgres test database) with ScriptedLLM behind
it (seam 2), so no network or model is needed.
"""

import json
import uuid

import httpx
import pytest
from sqlalchemy import text
from workit_scout.testing import ScriptedLLM

from app.config import get_settings
from app.deps import get_current_account
from app.main import app
from app.routers.scout import get_llm
from app.schemas.auth import AccountType, AuthenticatedAccount

pytestmark = pytest.mark.anyio

SAID = "I built a robot arm controller in Python for my robotics club, Jan to May 2025."
TURN = {"section": "projects", "messages": [{"role": "user", "content": SAID}], "draft": None}
DRAFT = {
    "section": "projects",
    "title": "Robot Arm Controller",
    "organization": "Robotics Club",
    "start_month": "2025-01",
    "end_month": "2025-05",
    "bullets": ["Wrote the arm's controller in Python."],
}


def reply(text: str = "What did the arm do?", draft: dict | None = None, done: bool = False) -> str:
    return json.dumps({"reply": text, "draft": draft or DRAFT, "done": done})


def _account(account_type: AccountType = AccountType.APPLICANT) -> AuthenticatedAccount:
    return AuthenticatedAccount(
        id=uuid.uuid4(),
        email="sam@example.com",
        full_name="Sam Seeker",
        account_type=account_type,
        onboarding_completed=True,
    )


async def _seed(database, account: AuthenticatedAccount) -> None:
    async with database() as session:
        await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": account.id})
        await session.execute(
            text("INSERT INTO applicant_profiles (id, email, full_name) VALUES (:id, :email, :name)"),
            {"id": account.id, "email": account.email, "name": account.full_name},
        )
        await session.commit()


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def applicant(database):
    account = _account()
    await _seed(database, account)
    app.dependency_overrides[get_current_account] = lambda: account
    yield account
    app.dependency_overrides.clear()


def use_model(*scripts) -> ScriptedLLM:
    fake = ScriptedLLM(*scripts)
    app.dependency_overrides[get_llm] = lambda: fake
    return fake


def lines(res: httpx.Response) -> list[dict]:
    return [json.loads(line) for line in res.text.splitlines()]


@pytest.fixture
def cap(monkeypatch):
    def set_cap(n: int):
        monkeypatch.setattr(get_settings(), "ai_intake_cap", n)

    return set_cap


async def test_a_turn_streams_the_reply_the_full_draft_and_the_uses_left(applicant, client, cap):
    cap(15)
    use_model([reply()])
    res = await client.post("/intake/turn", json=TURN)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/x-ndjson")
    text_line, draft_line, usage_line = lines(res)
    assert text_line == {"type": "text", "delta": "What did the arm do?"}
    assert draft_line["type"] == "draft"
    assert draft_line["draft"]["title"] == "Robot Arm Controller"
    assert draft_line["draft"]["start_month"] == "2025-01"
    assert draft_line["draft"]["bullets"] == ["Wrote the arm's controller in Python."]
    assert draft_line["draft"]["gpa"] is None
    assert usage_line == {"type": "usage", "uses_left": 14}
