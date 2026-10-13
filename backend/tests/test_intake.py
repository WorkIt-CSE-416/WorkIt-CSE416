"""
Intake's route (KAN-213): one turn of the chat that fills a draft entry card.
Seam 1 (the API on the real-Postgres test database) with ScriptedLLM behind
it (seam 2), so no network or model is needed.
"""

import json
import uuid

import httpx
import pytest
from openai import RateLimitError
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


_REQUEST = httpx.Request("POST", "http://endpoint.test/v1/chat/completions")


def rate_limited() -> RateLimitError:
    return RateLimitError("quota", response=httpx.Response(429, request=_REQUEST), body=None)


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


async def test_the_cards_edits_reach_the_model_with_each_turn(applicant, client):
    model = use_model([reply()])
    edited = {**DRAFT, "title": "Arm Controller v2"}
    body = {**TURN, "draft": edited}
    assert (await client.post("/intake/turn", json=body)).status_code == 200
    sent = json.dumps(model.prompts[0])
    assert "Arm Controller v2" in sent
    assert model.prompts[0][-1] == {"role": "user", "content": SAID}


async def test_the_prompt_is_frozen_and_the_turn_goes_after_it(applicant, client):
    first = use_model([reply()])
    await client.post("/intake/turn", json=TURN)
    second = use_model([reply()])
    await client.post("/intake/turn", json={**TURN, "section": "education", "draft": None})
    assert first.system_prompt == second.system_prompt
    assert "Education" in second.prompts[0][1]["content"]


async def test_the_turn_says_what_title_and_organization_hold_in_the_section(applicant, client):
    model = use_model([reply()])
    await client.post("/intake/turn", json={**TURN, "section": "education", "draft": None})
    context = model.prompts[0][1]["content"]
    assert "title is the school" in context
    assert "organization is a college or department" in context


async def test_a_draft_that_breaks_the_entry_schema_does_not_count(applicant, client, cap):
    # The first JSON route: an invalid reply is an error line and costs nothing.
    cap(1)
    bad = {**DRAFT, "gpa": 3.9}  # a GPA on a project entry
    use_model([reply(draft=bad)])
    res = await client.post("/intake/turn", json=TURN)
    assert res.status_code == 200
    assert [line["type"] for line in lines(res)] == ["error", "usage"]
    assert lines(res)[-1] == {"type": "usage", "uses_left": 1}

    use_model(["not json at all"])
    assert lines(await client.post("/intake/turn", json=TURN))[-1]["uses_left"] == 1

    use_model([reply()])
    assert (await client.post("/intake/turn", json=TURN)).status_code == 200
    assert (await client.post("/intake/turn", json=TURN)).status_code == 429


async def test_a_draft_for_another_section_is_rejected(applicant, client):
    use_model([reply(draft={**DRAFT, "section": "experience"})])
    res = await client.post("/intake/turn", json=TURN)
    assert [line["type"] for line in lines(res)] == ["error", "usage"]


async def test_a_model_that_is_down_does_not_count(applicant, client, cap):
    cap(1)
    use_model(rate_limited())
    res = await client.post("/intake/turn", json=TURN)
    assert lines(res) == [
        {"type": "error", "message": lines(res)[0]["message"]},
        {"type": "usage", "uses_left": 1},
    ]


async def test_intake_asks_at_most_three_follow_ups(applicant, client):
    chat = [{"role": "user", "content": SAID}]
    for question in ("What did the arm do?", "Who was on the team?", "What was the result?"):
        chat += [{"role": "assistant", "content": question}, {"role": "user", "content": "ok"}]
    model = use_model([reply("How long did it take?", done=False)])
    res = await client.post("/intake/turn", json={**TURN, "messages": chat})
    text_line, draft_line, _ = lines(res)
    assert "?" not in text_line["delta"]
    assert draft_line["done"] is True
    assert "may still ask for this entry: 0" in model.prompts[0][1]["content"]


async def test_the_opening_question_is_not_a_follow_up(applicant, client):
    opener = {"role": "assistant", "content": "Tell me about a project you built."}
    chat = [opener, {"role": "user", "content": SAID}]
    for question in ("What did the arm do?", "Who was on the team?"):
        chat += [{"role": "assistant", "content": question}, {"role": "user", "content": "ok"}]
    model = use_model([reply("What was the result?", done=False)])
    res = await client.post("/intake/turn", json={**TURN, "messages": chat})
    text_line, draft_line, _ = lines(res)
    assert text_line["delta"] == "What was the result?"
    assert draft_line["done"] is False
    assert "may still ask for this entry: 1" in model.prompts[0][1]["content"]


async def test_each_turn_counts_against_the_intake_cap(applicant, client, cap):
    cap(2)
    use_model([reply()])
    codes = [(await client.post("/intake/turn", json=TURN)).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


async def test_intake_stops_when_its_share_of_the_pool_is_spent(applicant, client, cap, monkeypatch):
    # A pool of 10 a day gives intake its 30%: three turns across all students.
    cap(15)
    monkeypatch.setattr(get_settings(), "ai_daily_pool", 10)
    use_model([reply()])
    codes = [(await client.post("/intake/turn", json=TURN)).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]


async def test_intake_is_for_applicants_only(applicant, client):
    use_model([reply()])
    app.dependency_overrides[get_current_account] = lambda: _account(AccountType.COMPANY)
    assert (await client.post("/intake/turn", json=TURN)).status_code == 403


async def test_a_card_from_another_section_is_refused(applicant, client):
    use_model([reply()])
    body = {**TURN, "draft": {**DRAFT, "section": "awards"}}
    assert (await client.post("/intake/turn", json=body)).status_code == 422


async def test_the_prompt_sent_holds_no_identity_data(applicant, client):
    model = use_model([reply()])
    said = "I'm Sam Seeker, code at github.com/samseeker/arm, mail sam@example.com"
    body = {**TURN, "messages": [{"role": "user", "content": said}]}
    assert (await client.post("/intake/turn", json=body)).status_code == 200
    sent = json.dumps(model.prompts)
    for value in ("Sam", "Seeker", "sam@example.com", "samseeker"):
        assert value not in sent


async def test_a_link_the_model_saw_as_a_placeholder_keeps_the_cards_value(applicant, client):
    use_model([reply(draft={**DRAFT, "link": "[link]"})])
    card = {**DRAFT, "link": "github.com/samseeker/arm"}
    res = await client.post("/intake/turn", json={**TURN, "draft": card})
    assert lines(res)[1]["draft"]["link"] == "github.com/samseeker/arm"


async def test_nothing_said_is_stored(applicant, client, database):
    use_model([reply()])
    await client.post("/intake/turn", json=TURN)
    async with database() as session:
        tables = (
            await session.execute(
                text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
            )
        ).scalars()
        for table in tables:
            rows = (await session.execute(text(f'SELECT * FROM public."{table}"'))).all()
            assert SAID not in repr(rows) and "Robot Arm Controller" not in repr(rows)
