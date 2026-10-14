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


async def test_a_field_the_model_drops_keeps_the_cards_value(applicant, client):
    use_model([reply(draft={"section": "projects", "title": "Robot Arm Controller", "bullets": ["Cut path time by 30%."]})])
    res = await client.post("/intake/turn", json={**TURN, "draft": DRAFT})
    draft = lines(res)[1]["draft"]
    assert draft["organization"] == "Robotics Club"
    assert (draft["start_month"], draft["end_month"]) == ("2025-01", "2025-05")
    assert draft["bullets"] == ["Cut path time by 30%."]


async def test_the_turn_lists_what_the_draft_has_and_what_is_missing(applicant, client):
    model = use_model([reply()])
    await client.post("/intake/turn", json={**TURN, "draft": {**DRAFT, "bullets": []}})
    context = model.prompts[0][1]["content"]
    assert "already has: title. Never ask" in context
    assert "Still missing: bullets." in context


# Intake asks for what application forms take (Greenhouse requires a school's
# degree, discipline and start and end months, and a job's start and end or
# "current") and what a resume line needs. No form asks for a project's,
# club role's or award's dates, so intake does not either.


async def test_a_project_is_complete_without_dates(applicant, client):
    undated = {"section": "projects", "title": "Robot Arm Controller", "bullets": ["Cut path time by 30%."]}
    use_model([reply("When did you build it?", draft=undated)])
    res = await client.post("/intake/turn", json={**TURN, "draft": undated})
    text_line, draft_line, _ = lines(res)
    assert draft_line["done"] is True
    assert "ready to save" in text_line["delta"]


async def test_a_complete_card_asks_for_no_other_field(applicant, client):
    undated = {"section": "projects", "title": "LineBot", "bullets": ["Ran a 10 m track in 14 s."]}
    model = use_model([reply(draft=undated)])
    await client.post("/intake/turn", json={**TURN, "draft": undated})
    system, context = model.prompts[0][0]["content"], model.prompts[0][1]["content"]
    assert "Ask for no other field" in context
    assert "never ask for it" in system


async def test_an_award_needs_only_its_name(applicant, client):
    award = {"section": "awards", "title": "Dean's List"}
    model = use_model([reply("When did you win it?", draft=award)])
    res = await client.post("/intake/turn", json={**TURN, "section": "awards", "draft": award})
    assert lines(res)[1]["done"] is True
    assert "Still missing" not in model.prompts[0][1]["content"]


async def test_a_job_with_only_an_end_month_still_asks_for_its_start(applicant, client):
    job = {
        "section": "experience",
        "title": "Software Engineer Intern",
        "organization": "Clever Devices",
        "end_month": "2025-08",
        "end_kind": "month",
        "bullets": ["Cut latency 85%."],
    }
    model = use_model([reply("When did it start?", draft=job)])
    await client.post("/intake/turn", json={**TURN, "section": "experience", "draft": job})
    assert "Still missing: dates." in model.prompts[0][1]["content"]


async def test_intake_stops_asking_once_the_resume_has_what_it_needs(applicant, client):
    use_model([reply("What's the name of this project?")])
    res = await client.post("/intake/turn", json={**TURN, "draft": DRAFT})
    text_line, draft_line, _ = lines(res)
    assert draft_line["done"] is True
    assert "ready to save" in text_line["delta"]




MOUSE = {
    "section": "projects",
    "title": "Micromouse",
    "organization": "Stony Brook IEEE",
    "start_month": "2024-09",
    "end_kind": "present",
    "bullets": ["Led a team of 6 building a maze-solving robot."],
}
LEAD = {"role": "user", "content": "I was the IEEE Micromouse lead."}
ROLE = {"section": "leadership", "title": "Micromouse Lead"}


def lead_turn(draft: dict | None = None) -> dict:
    return {"section": "leadership", "messages": [LEAD], "draft": draft}


async def save(client, applicant, entry: dict) -> None:
    assert (await client.post(f"/applicants/{applicant.id}/bank/entries", json=entry)).status_code == 201


async def test_naming_a_bank_entry_fills_the_cards_empty_fields_from_it(applicant, client):
    await save(client, applicant, MOUSE)
    use_model([reply("When did you start?", draft=ROLE)])
    text_line, draft_line, _ = lines(await client.post("/intake/turn", json=lead_turn()))
    draft = draft_line["draft"]
    assert draft["title"] == "Micromouse Lead"
    assert draft["organization"] == "Stony Brook IEEE"
    assert (draft["start_month"], draft["end_kind"]) == ("2024-09", "present")
    assert draft["bullets"] == ["Led a team of 6 building a maze-solving robot."]
    # The model asked for the start, which the card now has.
    assert text_line["delta"] == "I filled in what your bank has on Micromouse. It looks ready to save, or tell me more to add."
    assert draft_line["done"] is True


async def test_the_bank_never_overwrites_what_the_card_has(applicant, client):
    await save(client, applicant, MOUSE)
    use_model([reply(draft={**ROLE, "organization": "Robotics Club"})])
    draft = lines(await client.post("/intake/turn", json=lead_turn()))[1]["draft"]
    assert draft["organization"] == "Robotics Club"
    assert draft["start_month"] == "2024-09"


async def test_the_bank_never_reaches_the_model(applicant, client):
    await save(client, applicant, MOUSE)
    model = use_model([reply(draft=ROLE)])
    await client.post("/intake/turn", json=lead_turn())
    assert "maze-solving" not in json.dumps(model.prompts)


async def test_a_line_that_names_no_entry_leaves_the_models_draft(applicant, client):
    await save(client, applicant, {**MOUSE, "section": "experience", "title": "Software Engineer Intern", "organization": "Clever Devices"})
    said = {"role": "user", "content": "I was a software engineer intern at Google."}
    use_model([reply("When was it?", draft={"section": "experience", "title": "Software Engineer Intern", "organization": "Google"})])
    res = await client.post("/intake/turn", json={"section": "experience", "messages": [said], "draft": None})
    text_line, draft_line, _ = lines(res)
    assert draft_line["draft"]["start_month"] is None
    assert text_line["delta"] == "When was it?"


async def test_an_award_lends_nothing_to_a_role(applicant, client):
    award = {"section": "awards", "title": "IEEE Micromouse First Place", "organization": "IEEE Region 1", "award_date": "2025-04"}
    await save(client, applicant, award)
    use_model([reply(draft=ROLE)])
    draft = lines(await client.post("/intake/turn", json=lead_turn()))[1]["draft"]
    assert draft["organization"] is None


async def test_a_null_list_or_blank_text_in_the_reply_is_empty(applicant, client):
    use_model([reply(draft={**DRAFT, "coursework": None, "bullets": None, "organization": ""})])
    res = await client.post("/intake/turn", json=TURN)
    draft = lines(res)[1]["draft"]
    assert (draft["coursework"], draft["bullets"], draft["organization"]) == ([], [], None)


async def test_an_end_kind_with_no_end_month_is_dropped(applicant, client):
    # "Summer 2024": a live model sent end_kind "month" with no end_month.
    use_model([reply(draft={**DRAFT, "start_month": "2024-06", "end_month": None, "end_kind": "month"})])
    res = await client.post("/intake/turn", json=TURN)
    draft = lines(res)[1]["draft"]
    assert (draft["start_month"], draft["end_month"], draft["end_kind"]) == ("2024-06", None, None)


SCHOOL = {
    "section": "education",
    "title": "Stony Brook University",
    "start_month": "2023-08",
    "end_month": "2027-05",
    "end_kind": "expected",
    "degree": "B.S.",
    "field_of_study": "Computer Science",
}


async def test_intake_asks_for_a_gpa_an_imported_school_lacks(applicant, client):
    model = use_model([reply("What's your GPA?", draft=SCHOOL)])
    await client.post(
        "/intake/turn",
        json={"section": "education", "messages": [{"role": "user", "content": "Hi"}], "draft": SCHOOL},
    )
    assert "Still missing: gpa." in model.prompts[0][1]["content"]


async def test_a_declined_gpa_ends_the_visit(applicant, client):
    # A resume can go without a GPA: once the student skips it, the code ends
    # the visit, as for a card with every fact, instead of asking again.
    use_model([reply("What's your GPA?", draft=SCHOOL)])
    said = [{"role": "assistant", "content": "What is your GPA?"}, {"role": "user", "content": "Skip that."}]
    res = await client.post("/intake/turn", json={"section": "education", "messages": said, "draft": SCHOOL})
    text_line, draft_line, _ = lines(res)
    assert draft_line["done"] is True
    assert "ready to save" in text_line["delta"]


async def test_a_blank_bullet_in_the_reply_is_dropped(applicant, client):
    use_model([reply(draft={**DRAFT, "bullets": ["", "Wrote the arm's controller in Python.", " "], "coursework": [""]})])
    draft = lines(await client.post("/intake/turn", json=TURN))[1]["draft"]
    assert (draft["bullets"], draft["coursework"]) == (["Wrote the arm's controller in Python."], [])


async def test_an_entry_with_no_telling_title_never_matches_on_its_organization(applicant, client):
    # A leadership entry titled "hi" at a robotics club: "my robotics team"
    # in a project's visit named no entry, but it lent the club.
    await save(client, applicant, {"section": "leadership", "title": "hi", "organization": "Stony Brook Robotics Club"})
    said = {"role": "user", "content": "Sep 2024 to Dec 2024, for my robotics team."}
    use_model([reply("What did it do?", draft={**DRAFT, "organization": None})])
    res = await client.post("/intake/turn", json={"section": "projects", "messages": [said], "draft": None})
    text_line, draft_line, _ = lines(res)
    assert draft_line["draft"]["organization"] is None
    assert text_line["delta"] == "What did it do?"


async def test_a_job_still_going_has_its_dates(applicant, client):
    job = {
        "section": "experience",
        "title": "Software Engineer Intern",
        "organization": "Clever Devices",
        "start_month": "2025-06",
        "end_kind": "present",
        "bullets": ["Cut latency 85%."],
    }
    model = use_model([reply(draft=job)])
    await client.post("/intake/turn", json={**TURN, "section": "experience", "draft": job})
    assert "already has: title, organization, dates, bullets" in model.prompts[0][1]["content"]


# A smaller model in the chain (gpt-oss-20b) dropped a month the student had
# just said, one turn in three, and asked for it again word for word; the
# fallbacks also asked for an end the card already had. The code reads the
# month from the student's own line and writes the next question itself.

UNSTARTED = {**SCHOOL, "start_month": None, "gpa": 3.81, "gpa_scale": 4.0}
STARTED = [{"role": "user", "content": "I started in August 2023"}]


async def test_a_month_the_model_drops_is_read_from_the_students_line(applicant, client):
    use_model([reply("Great! What month and year did you start?", draft=UNSTARTED)])
    res = await client.post("/intake/turn", json={"section": "education", "messages": STARTED, "draft": UNSTARTED})
    text_line, draft_line, _ = lines(res)
    assert draft_line["draft"]["start_month"] == "2023-08"
    assert draft_line["done"] is True
    assert "ready to save" in text_line["delta"]


async def test_an_end_the_student_says_fills_a_started_job(applicant, client):
    job = {"section": "experience", "title": "Intern", "organization": "Clever Devices", "start_month": "2025-06"}
    said = [{"role": "user", "content": "It ended in Aug 2025."}]
    use_model([reply("When did it end?", draft=job)])
    res = await client.post("/intake/turn", json={"section": "experience", "messages": said, "draft": job})
    text_line, draft_line, _ = lines(res)
    assert (draft_line["draft"]["end_month"], draft_line["draft"]["end_kind"]) == ("2025-08", "month")
    assert text_line["delta"] == "What did you do there, and what came of it?"


async def test_a_job_still_going_is_read_as_present(applicant, client):
    job = {"section": "experience", "title": "Intern", "organization": "Clever Devices", "start_month": "2025-06"}
    said = [{"role": "user", "content": "I still work there."}]
    use_model([reply("When did it end?", draft=job)])
    res = await client.post("/intake/turn", json={"section": "experience", "messages": said, "draft": job})
    assert lines(res)[1]["draft"]["end_kind"] == "present"


async def test_one_month_for_an_entry_with_no_dates_is_left_to_the_model(applicant, client):
    # Start or end? The code cannot tell, so the model's line stands.
    job = {"section": "experience", "title": "Intern", "organization": "Clever Devices"}
    said = [{"role": "user", "content": "May 2025"}]
    use_model([reply("Was that the start or the end?", draft=job)])
    res = await client.post("/intake/turn", json={"section": "experience", "messages": said, "draft": job})
    text_line, draft_line, _ = lines(res)
    assert draft_line["draft"]["start_month"] is None
    assert text_line["delta"] == "Was that the start or the end?"


async def test_the_end_month_said_again_is_not_read_as_the_start(applicant, client):
    said = [{"role": "user", "content": "I graduate in May 2027."}]
    use_model([reply("And when did you start?", draft=UNSTARTED)])
    res = await client.post("/intake/turn", json={"section": "education", "messages": said, "draft": UNSTARTED})
    assert lines(res)[1]["draft"]["start_month"] is None


async def test_a_date_question_the_card_answers_is_replaced(applicant, client):
    job = {"section": "experience", "title": "Intern", "organization": "Clever Devices",
           "start_month": "2025-06", "end_month": "2025-08"}
    said = [{"role": "user", "content": "June to August 2025."}]
    use_model([reply("Got it. When do you expect to finish?", draft=job)])
    res = await client.post("/intake/turn", json={"section": "experience", "messages": said, "draft": None})
    assert lines(res)[0]["delta"] == "What did you do there, and what came of it?"


# A student's bank held "Autonomous Maze Navigation Robot" twice (an import
# saved as new), so "I did the autonomous maze navigation robot project"
# matched two entries and filled nothing. And the turn before, speech input
# heard "Thomas Mays navigation robot": the model wrote a bullet from that,
# which kept the bank's bullets out of the card.

MAZE = {
    "section": "projects",
    "title": "Autonomous Maze Navigation Robot",
    "bullets": ["Engineered a Raspberry Pi to navigate a 16x16 maze."],
}
MAZE_LINE = {"role": "user", "content": "I did the autonomous maze navigation robot project."}


async def save_copy(client, applicant, entry: dict) -> None:
    res = await client.post(f"/applicants/{applicant.id}/bank/entries?allow_duplicate=true", json=entry)
    assert res.status_code == 201


async def test_two_identical_entries_match_as_one(applicant, client):
    await save(client, applicant, MAZE)
    await save_copy(client, applicant, MAZE)
    use_model([reply("What did you do?", draft={**ROLE, "organization": "IEEE"})])
    res = await client.post("/intake/turn", json={"section": "leadership", "messages": [MAZE_LINE], "draft": None})
    assert lines(res)[1]["draft"]["bullets"] == MAZE["bullets"]


async def test_the_banks_bullets_replace_ones_the_model_wrote_this_turn(applicant, client):
    await save(client, applicant, MAZE)
    card = {**ROLE, "organization": "IEEE"}
    misheard = {**card, "bullets": ["Built the Thomas Mays navigation robot."]}
    use_model([reply("What did you accomplish?", draft=misheard)])
    res = await client.post("/intake/turn", json={"section": "leadership", "messages": [MAZE_LINE], "draft": card})
    text_line, draft_line, _ = lines(res)
    assert draft_line["draft"]["bullets"] == MAZE["bullets"]
    assert text_line["delta"].startswith("I filled in what your bank has on Autonomous Maze Navigation Robot.")


async def test_bullets_the_card_had_before_the_turn_stay(applicant, client):
    await save(client, applicant, MAZE)
    card = {**ROLE, "organization": "IEEE", "bullets": ["Led 12 members."]}
    use_model([reply(draft=card)])
    res = await client.post("/intake/turn", json={"section": "leadership", "messages": [MAZE_LINE], "draft": card})
    assert lines(res)[1]["draft"]["bullets"] == ["Led 12 members."]
