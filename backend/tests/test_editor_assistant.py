"""
Seam-1 tests for the editor assistant (KAN-221): the docked chat on the
resume editor reads what the student asks and answers with one action (fit,
hide, move up or down, or "Make it shorter"), through the API on real
Postgres, with ScriptedLLM standing in for the model (seam 2). The editor
applies the action through the choices PATCH and Fit; this route saves
nothing but the count. backend/CLAUDE.md's Tests section has the setup.
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
from app.schemas.auth import AccountType, AuthenticatedAccount
from tests import fake_models

pytestmark = pytest.mark.anyio

LONG = "Wrote billing services in Python that handled 1,200 invoices a day for the finance team"


def reply(action: str, text: str | None = None) -> list[str]:
    """A ScriptedLLM script: the model's reading of the student's message."""
    return [json.dumps({"action": action, "text": text})]


def rate_limited() -> RateLimitError:
    request = httpx.Request("POST", "http://endpoint.test/v1/chat/completions")
    return RateLimitError("quota", response=httpx.Response(429, request=request), body=None)


class Student:
    def __init__(self, client: httpx.AsyncClient, applicant_id: uuid.UUID):
        self.client = client
        self.me = f"/applicants/{applicant_id}"

    async def post(self, path: str, body: dict) -> httpx.Response:
        return await self.client.post(f"{self.me}{path}", json=body)

    async def ask(self, message: str, **line) -> httpx.Response:
        return await self.post(f"/built-resumes/{self.resume}/assistant", {"message": message, **line})

    async def choices(self) -> dict:
        return (await self.client.get(f"{self.me}/built-resumes/{self.resume}/choices")).json()


@pytest.fixture
async def student(database):
    """A bank with one Experience entry (one long bullet), the skill Docker,
    and a base resume of it. `bullet` is the bullet's id."""
    applicant_id = uuid.uuid4()
    async with database() as session:
        await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
        await session.execute(
            text(
                "INSERT INTO applicant_profiles (id, email, full_name)"
                " VALUES (:id, :email, 'Sam Seeker')"
            ),
            {"id": applicant_id, "email": f"sam{applicant_id.hex[:6]}@example.com"},
        )
        await session.commit()
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=applicant_id,
        email="sam@example.com",
        full_name="Sam Seeker",
        account_type=AccountType.APPLICANT,
        onboarding_completed=True,
    )
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            me = Student(client, applicant_id)
            res = await me.post("/bank/entries", {
                "section": "experience", "title": "Software Intern", "organization": "Acme",
                "bullets": [LONG],
            })
            assert res.status_code == 201, res.text
            me.entry = res.json()["id"]
            me.bullet = res.json()["bullets"][0]["id"]
            assert (await me.post("/bank/skills", {"name": "Docker"})).status_code == 201
            res = await me.post("/built-resumes", {"name": "Base Resume"})
            me.resume = res.json()["id"]
            yield me
    finally:
        app.dependency_overrides.pop(get_current_account, None)


@pytest.fixture
def use_model():
    def install(*scripts) -> ScriptedLLM:
        fake = ScriptedLLM(*scripts)
        fake_models.use(fake)
        return fake

    yield install
    fake_models.clear()


# --- Make it shorter -------------------------------------------------------


async def test_make_it_shorter_proposes_fewer_words_with_the_same_facts(student, use_model):
    short = "Wrote Python billing services handling 1,200 invoices a day"
    use_model(reply("shorter", short))

    res = await student.ask("Make it shorter", bullet_id=student.bullet)

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["action"] == "shorter"
    assert body["text"] == short
    assert body["original"] == LONG
    assert body["uses_left"] == get_settings().ai_assistant_cap - 1


async def test_a_shorter_wording_with_an_invented_fact_is_kept_back(student, use_model):
    use_model(reply("shorter", "Wrote Python and Kubernetes billing services for 3,000 invoices a day"))

    body = (await student.ask("Make it shorter", bullet_id=student.bullet)).json()

    assert body["action"] == "none"
    assert body["text"] is None
    assert "facts" in body["reply"]


@pytest.mark.parametrize("placeholder", ["[name]", "[email]", "[phone]", "[link]"])
async def test_a_shorter_wording_with_an_identity_placeholder_is_kept_back(student, use_model, placeholder):
    use_model(reply("shorter", f"Wrote Python billing for {placeholder}"))

    body = (await student.ask("Make it shorter", bullet_id=student.bullet)).json()

    assert (body["action"], body["text"]) == ("none", None)


async def test_a_wording_that_is_not_shorter_is_kept_back(student, use_model):
    use_model(reply("shorter", LONG + " every single day"))

    body = (await student.ask("Make it shorter", bullet_id=student.bullet)).json()

    assert (body["action"], body["text"]) == ("none", None)


async def test_shorter_reads_the_resume_s_own_wording(student, use_model):
    mine = "Wrote Docker billing services for the finance team, 1,200 invoices a day, every day of the week"
    res = await student.client.patch(
        f"{student.me}/built-resumes/{student.resume}/choices",
        json={"bullets": [{"bullet_id": student.bullet, "text": mine}]})
    assert res.status_code == 200, res.text
    fake = use_model(reply("shorter", "Wrote Docker billing services for 1,200 invoices a day"))

    body = (await student.ask("shorter please", bullet_id=student.bullet)).json()

    assert (body["action"], body["original"]) == ("shorter", mine)
    assert mine in fake.prompts[0][-1]["content"]


async def test_make_it_shorter_saves_nothing(student, use_model):
    before = await student.choices()
    use_model(reply("shorter", "Wrote Python billing services handling 1,200 invoices a day"))

    await student.ask("Make it shorter", bullet_id=student.bullet)

    assert await student.choices() == before


# --- No other rewording ----------------------------------------------------


async def test_any_other_rewording_is_refused_and_its_text_never_reaches_the_student(student, use_model):
    use_model(reply("none", "Spearheaded mission-critical billing at scale"))

    body = (await student.ask("Make it sound more impressive", bullet_id=student.bullet)).json()

    assert body["action"] == "none"
    assert body["text"] is None
    assert "Spearheaded" not in body["reply"]


async def test_text_on_a_line_action_is_dropped(student, use_model):
    use_model(reply("hide", "Spearheaded mission-critical billing at scale"))

    body = (await student.ask("hide this", bullet_id=student.bullet)).json()

    assert (body["action"], body["text"]) == ("hide", None)


# --- Fit, hide, move -------------------------------------------------------


@pytest.mark.parametrize("action", ["hide", "move_up", "move_down"])
async def test_a_line_action_names_the_action_for_the_selected_line(student, use_model, action):
    use_model(reply(action))

    body = (await student.ask("do it", entry_id=student.entry)).json()

    assert body["action"] == action


async def test_fit_needs_no_selected_line(student, use_model):
    use_model(reply("fit"))
    assert (await student.ask("fit it on one page")).json()["action"] == "fit"


async def test_a_line_action_with_no_line_selected_asks_for_one(student, use_model):
    use_model(reply("hide"))

    body = (await student.ask("hide it")).json()

    assert body["action"] == "none"
    assert "Click a line" in body["reply"]


async def test_another_student_s_line_is_404(student, use_model):
    fake = use_model(reply("hide"))

    res = await student.ask("hide it", bullet_id=str(uuid.uuid4()))

    assert res.status_code == 404
    assert fake.prompts == []


async def test_two_lines_at_once_is_422(student, use_model):
    use_model(reply("hide"))
    res = await student.ask("hide it", bullet_id=student.bullet, entry_id=student.entry)
    assert res.status_code == 422


# --- The cap, the share and the model seam ---------------------------------


async def test_each_message_counts_against_the_assistant_cap(student, use_model, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_assistant_cap", 2)
    use_model(reply("fit"))
    assert (await student.ask("fit")).json()["uses_left"] == 1
    assert (await student.ask("fit")).json()["uses_left"] == 0

    fake = use_model(reply("fit"))
    res = await student.ask("fit")

    assert res.status_code == 429
    assert fake.prompts == []


async def test_the_assistant_stops_when_its_share_of_the_pool_is_spent(student, use_model, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_daily_pool", 10)  # the 10% share: one use for everyone
    use_model(reply("fit"))
    assert (await student.ask("fit")).status_code == 200
    assert (await student.ask("fit")).status_code == 429


async def test_an_invalid_or_failed_reply_answers_503_and_counts_nothing(student, use_model):
    use_model([json.dumps({"action": "rewrite everything"})])
    assert (await student.ask("fit")).status_code == 503

    use_model(rate_limited())
    assert (await student.ask("fit")).status_code == 503

    use_model(reply("fit"))
    assert (await student.ask("fit")).json()["uses_left"] == get_settings().ai_assistant_cap - 1


async def test_the_prompt_holds_the_line_and_no_identity_data(student, use_model):
    fake = use_model(reply("none"))

    await student.ask("Sam Seeker here, mail sam@example.com: make it shorter", bullet_id=student.bullet)

    sent = "\n".join(m["content"] for m in fake.prompts[0])
    assert LONG in sent
    assert "Sam Seeker" not in sent and "sam@example.com" not in sent
