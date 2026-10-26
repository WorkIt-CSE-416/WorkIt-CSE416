"""
The connector (KAN-377), spec seam 2: the MCP server the student adds to
their own Claude, driven by the official MCP Python client as Claude drives
it, against this run's throwaway test database (never Supabase).

The client signs in the way Claude does: it finds WorkIt's authorization
server from the 401 at /mcp, registers itself, sends the student to
/authorize with PKCE, and trades the code for a token. The one step a test
stands in for is the student's click on the webapp's consent page, which
calls POST /connector/requests/{id}/approve with their Supabase session.
"""

import uuid
from urllib.parse import parse_qs, urlparse

import httpx
import httpx2
import pytest
from mcp import Client
from mcp.client.auth import AuthorizationCodeResult, OAuthClientProvider
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.auth import OAuthClientInformationFull, OAuthClientMetadata, OAuthToken

from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount
from tests.test_built_resumes import _seed_applicant

pytestmark = pytest.mark.anyio

API = "http://localhost:8000"
WEB = "http://localhost:3000"
REDIRECT = "https://claude.ai/api/mcp/auth_callback"


@pytest.fixture
async def running():
    """The API with its lifespan running, as uvicorn runs it: the MCP
    server's session manager lives there."""
    async with app.router.lifespan_context(app):
        yield
    app.dependency_overrides.pop(get_current_account, None)


@pytest.fixture
async def applicant(database) -> uuid.UUID:
    async with database() as session:
        return await _seed_applicant(session)


def _signed_in_as(account_id: uuid.UUID, account_type: AccountType = AccountType.APPLICANT) -> None:
    """The webapp's Supabase session, for the consent page's call."""
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=account_id, email="sam@example.com", full_name="Sam Seeker",
        account_type=account_type, onboarding_completed=True,
    )


def _api() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=API)


class _Memory:
    """Where Claude keeps its registration and tokens."""

    def __init__(self) -> None:
        self.tokens: OAuthToken | None = None
        self.client: OAuthClientInformationFull | None = None

    async def get_tokens(self):
        return self.tokens

    async def set_tokens(self, tokens):
        self.tokens = tokens

    async def get_client_info(self):
        return self.client

    async def set_client_info(self, client_info):
        self.client = client_info


async def _consent_request(authorize_url: str) -> str:
    """Opens /authorize as the student's browser does; answers the request
    id of the webapp's consent page it is sent to."""
    async with _api() as browser:
        res = await browser.get(authorize_url)
    assert res.status_code == 302, res.text
    page = urlparse(res.headers["location"])
    assert f"{page.scheme}://{page.netloc}{page.path}" == f"{WEB}/connect/claude"
    return parse_qs(page.query)["request"][0]


def claude(applicant_id: uuid.UUID, memory: _Memory | None = None) -> Client:
    """An MCP client that signs in as Claude does, the student approving on
    the consent page."""
    redirect: dict = {}

    async def open_browser(url: str) -> None:
        request = await _consent_request(url)
        _signed_in_as(applicant_id)
        async with _api() as webapp:
            res = await webapp.post(f"/connector/requests/{request}/approve")
        assert res.status_code == 200, res.text
        redirect["to"] = urlparse(res.json()["redirect_to"])

    async def come_back() -> AuthorizationCodeResult:
        to = redirect["to"]
        assert f"{to.scheme}://{to.netloc}{to.path}" == REDIRECT
        query = parse_qs(to.query)
        return AuthorizationCodeResult(code=query["code"][0], state=query["state"][0])

    auth = OAuthClientProvider(
        server_url=f"{API}/mcp",
        client_metadata=OAuthClientMetadata(
            client_name="Claude", redirect_uris=[REDIRECT],
            grant_types=["authorization_code", "refresh_token"], response_types=["code"],
            token_endpoint_auth_method="client_secret_post",
        ),
        storage=memory or _Memory(),
        redirect_handler=open_browser,
        callback_handler=come_back,
    )
    http = httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), auth=auth)
    return Client(streamable_http_client(f"{API}/mcp", http_client=http))


async def test_claude_signs_in_to_workit_and_reaches_the_connector(running, applicant):
    async with claude(applicant) as client:
        assert client.server_info.name == "WorkIt"
        # A call the token carries: the server answers it.
        assert (await client.list_tools()).tools is not None


async def test_the_connector_refuses_a_call_without_a_workit_token(running, applicant):
    async with _api() as anyone:
        res = await anyone.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        # A Supabase session token is not a connector token either.
        supabase = await anyone.post("/mcp", headers={"Authorization": "Bearer eyJhbGciOiJFUzI1NiJ9.e30.x"}, json={})

    assert res.status_code == 401
    # Where Claude finds WorkIt's sign-in.
    assert "resource_metadata=" in res.headers["www-authenticate"]
    assert supabase.status_code == 401


async def test_a_denied_consent_sends_claude_back_with_access_denied(running, applicant):
    async with _api() as api:
        meta = (await api.post("/register", json={"client_name": "Claude", "redirect_uris": [REDIRECT]})).json()
        res = await api.get("/authorize", params={
            "client_id": meta["client_id"], "redirect_uri": REDIRECT, "response_type": "code", "state": "s1",
            "code_challenge": "x" * 43, "code_challenge_method": "S256",
        })
        request = parse_qs(urlparse(res.headers["location"]).query)["request"][0]
        _signed_in_as(applicant)
        denied = await api.post(f"/connector/requests/{request}/deny")
        again = await api.post(f"/connector/requests/{request}/approve")

    back = urlparse(denied.json()["redirect_to"])
    assert parse_qs(back.query) == {"error": ["access_denied"], "state": ["s1"]}
    # A request is answered once.
    assert again.status_code == 404


async def test_only_claudes_own_callback_can_register(running, database, monkeypatch):
    """A page that registers its own redirect would get the student's code
    from WorkIt's consent page: only Claude's callbacks register, and the
    loopback ones (Claude Code) only where a setting allows them."""
    from app.config import Settings
    from app.connector import oauth

    async def register(*uris: str) -> int:
        async with _api() as api:
            return (await api.post("/register", json={"client_name": "Claude", "redirect_uris": list(uris)})).status_code

    assert await register(REDIRECT) == 201
    assert await register("https://claude.com/api/mcp/auth_callback") == 201
    assert await register("https://evil.example/api/mcp/auth_callback") == 400
    assert await register(REDIRECT, "https://claude.ai.evil.example/api/mcp/auth_callback") == 400
    assert await register("https://claude.ai/somewhere/else") == 400
    assert await register("http://localhost:3118/callback") == 400

    monkeypatch.setattr(oauth, "get_settings", lambda: Settings(_env_file=None, connector_loopback_redirects=True))
    assert await register("http://localhost:3118/callback", "http://127.0.0.1:50000/callback") == 201
    assert await register("http://localhost.evil.example/callback") == 400


async def test_only_a_student_can_connect_claude(running, applicant):
    async with _api() as api:
        meta = (await api.post("/register", json={"client_name": "Claude", "redirect_uris": [REDIRECT]})).json()
        res = await api.get("/authorize", params={
            "client_id": meta["client_id"], "redirect_uri": REDIRECT, "response_type": "code",
            "code_challenge": "x" * 43, "code_challenge_method": "S256",
        })
        request = parse_qs(urlparse(res.headers["location"]).query)["request"][0]
        _signed_in_as(uuid.uuid4(), AccountType.COMPANY)

        assert (await api.post(f"/connector/requests/{request}/approve")).status_code == 403
        # The consent page names who is asking.
        _signed_in_as(applicant)
        shown = await api.get(f"/connector/requests/{request}")
    # Where the code goes, shown on the page (MCP authorization spec).
    assert shown.json() == {"client_name": "Claude", "redirect_host": "claude.ai"}


async def test_claude_refreshes_its_token_and_the_old_one_stops_working(running, applicant):
    memory = _Memory()
    async with claude(applicant, memory):
        pass
    first = memory.tokens
    refresh = {
        "grant_type": "refresh_token", "refresh_token": first.refresh_token,
        "client_id": memory.client.client_id, "client_secret": memory.client.client_secret,
    }
    async with _api() as api:
        res = await api.post("/token", data=refresh)
        again = await api.post("/token", data=refresh)
        old = await api.post("/mcp", headers={"Authorization": f"Bearer {first.access_token}"}, json={})

    assert res.status_code == 200, res.text
    assert res.json()["access_token"] != first.access_token
    # Both tokens rotate: the used refresh token and the old access token are dead.
    assert again.status_code == 400
    assert old.status_code == 401


async def test_a_refresh_token_used_twice_at_once_gives_one_pair(running, applicant):
    """Two refreshes racing with one refresh token: only one gets tokens,
    as with a code, so a stolen copy can't keep a second sign-in alive."""
    import anyio

    memory = _Memory()
    async with claude(applicant, memory):
        pass
    refresh = {
        "grant_type": "refresh_token", "refresh_token": memory.tokens.refresh_token,
        "client_id": memory.client.client_id, "client_secret": memory.client.client_secret,
    }
    answers = []

    async def use() -> None:
        async with _api() as api:
            answers.append(await api.post("/token", data=refresh))

    async with anyio.create_task_group() as both:
        for _ in range(4):
            both.start_soon(use)

    assert sorted(res.status_code for res in answers) == [200, 400, 400, 400]


# --- The tools and the prompt ---

WHY = {"name": "question_7", "label": "Why do you want to work at Acme?", "required": True, "max_length": 600}
# The passes Claude ran on a written answer, which save_answers takes with it (KAN-369).
REVIEWED = {"rating": 8, "unsupported": []}
PROUD = {"name": "question_8", "label": "Tell us about a project you are proud of.", "required": False, "max_length": None}


async def _student_queues(database, applicant: uuid.UUID, count: int) -> tuple[str, list[str]]:
    """The student's bank and `count` queued applications, through the API
    the webapp calls. Answers the applicant URL and the job ids, oldest first."""
    from tests.test_batch_apply import _queue
    from tests.test_built_resumes import _fill_bank

    me = f"/applicants/{applicant}"
    _signed_in_as(applicant)
    async with _api() as webapp:
        await _fill_bank(webapp, me)
        jobs = await _queue(webapp, me, database, count)
    return me, jobs


async def _tab_asks(me: str, job: str, *questions: dict) -> list[dict]:
    """A batch tab sends its form's questions (the extension's call), and
    reads back what is saved."""
    _signed_in_as(uuid.UUID(me.rsplit("/", 1)[1]))
    async with _api() as extension:
        res = await extension.put(f"{me}/applications/{job}/questions", json={"questions": list(questions)})
        assert res.status_code == 200, res.text
        return (await extension.get(f"{me}/applications/{job}/questions")).json()


async def _describe(database, job: str, text: str) -> None:
    from sqlalchemy import text as sql

    async with database() as session:
        await session.execute(sql("UPDATE job_postings SET description = :d, company_name = 'Acme' WHERE id = :id"), {"d": text, "id": job})
        await session.commit()


async def test_the_next_application_is_read_only_and_holds_only_that_application(running, applicant, database):
    me, (first, second) = await _student_queues(database, applicant, 2)
    await _describe(database, second, "Acme builds rockets. You will write flight software.")
    await _describe(database, first, "Another company's posting.")
    # The first tab's form asked nothing written; the second asked two.
    await _tab_asks(me, second, WHY, PROUD)

    async with claude(applicant) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
        result = await client.call_tool("get_next_application", {})

    assert tools["get_next_application"].annotations.read_only_hint is True
    assert tools["save_answers"].annotations.read_only_hint is False
    got = result.structured_content
    assert got["job_id"] == second
    assert (got["company"], got["title"]) == ("Acme", "Intern")
    assert got["posting"] == "Acme builds rockets. You will write flight software."
    assert got["questions"] == [
        {"name": "question_7", "question": WHY["label"], "required": True, "max_length": 600, "kind": "text", "options": None, "rewrite": None},
        {"name": "question_8", "question": PROUD["label"], "required": False, "max_length": None, "kind": "text", "options": None, "rewrite": None},
    ]
    # The student's experience bank, to write from.
    assert "Software Intern, Acme" in got["experience"]
    assert "- Cut page load time by 30%" in got["experience"]
    assert "Python" in got["skills"]
    # Nothing from the other application.
    assert "Another company" not in str(got)


async def test_saved_answers_reach_the_tab_and_the_next_application_moves_on(running, applicant, database):
    me, (first, second) = await _student_queues(database, applicant, 2)
    await _tab_asks(me, first, WHY)
    await _tab_asks(me, second, PROUD)
    answer = "I want to build flight software at Acme, and my internship there taught me the codebase."

    async with claude(applicant) as client:
        saved = await client.call_tool("save_answers", {"job_id": first, "answers": [{"name": "question_7", "answer": answer, "review": REVIEWED}]})
        after = await client.call_tool("get_next_application", {})

    assert saved.is_error is False, saved.content
    assert saved.structured_content == {"saved": 1, "left": 0, "read_first": ["question_7"]}
    # The open tab reads it back, to fill it.
    assert (await _tab_asks(me, first))[0]["answer"] == answer
    assert after.structured_content["job_id"] == second


async def test_nothing_left_to_write_says_so(running, applicant, database):
    await _student_queues(database, applicant, 1)

    async with claude(applicant) as client:
        result = await client.call_tool("get_next_application", {})

    assert result.structured_content["job_id"] is None


async def test_a_bad_save_is_refused_and_nothing_is_kept(running, applicant, database):
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY)
    other, theirs = await _another_students_application(database)
    await _tab_asks(other, theirs, WHY)

    async with claude(applicant) as client:
        too_long = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": "x" * 601, "review": REVIEWED}]})
        unknown = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": "Fine.", "review": REVIEWED}, {"name": "question_99", "answer": "No such question.", "review": REVIEWED}]})
        not_mine = await client.call_tool("save_answers", {"job_id": theirs, "answers": [
            {"name": "question_7", "answer": "Not my application.", "review": REVIEWED}]})

    assert too_long.is_error and unknown.is_error and not_mine.is_error
    assert (await _tab_asks(me, job))[0]["answer"] is None
    assert (await _tab_asks(other, theirs))[0]["answer"] is None


async def _another_students_application(database) -> tuple[str, str]:
    """Another student with one queued application: their URL and its job id."""
    from tests.test_sent_resumes import _seed_posting

    async with database() as session:
        them = await _seed_applicant(session)
    job = await _seed_posting(database, "https://job-boards.greenhouse.io/other/jobs/1")
    _signed_in_as(them)
    async with _api() as webapp:
        assert (await webapp.post(f"/applicants/{them}/applications", json={"job_id": job})).status_code == 200
    return f"/applicants/{them}", job


async def test_the_writing_rules_are_a_prompt(running, applicant):
    async with claude(applicant) as client:
        prompts = (await client.list_prompts()).prompts
        got = await client.get_prompt(prompts[0].name)

    # One titled prompt with a message; its wording is a person's read, not a test's.
    assert len(prompts) == 1 and prompts[0].title
    assert got.messages and got.messages[0].content.text


async def test_the_connector_calls_no_model(running, applicant, database, monkeypatch):
    """Every model WorkIt calls is made through workit_scout's LLM (Scout,
    intake, Tailor, the essay-answer route): none may be made."""
    from workit_scout.llm import LLM

    me, (job,) = await _student_queues(database, applicant, 1)

    def no_model(*args, **kwargs):
        raise AssertionError("The connector called a model")

    monkeypatch.setattr(LLM, "__init__", no_model)
    await _tab_asks(me, job, WHY)

    async with claude(applicant) as client:
        assert not (await client.call_tool("get_next_application", {})).is_error
        assert not (await client.call_tool("save_answers", {"job_id": job, "answers": [{"name": "question_7", "answer": "Yes.", "review": REVIEWED}]})).is_error


async def test_every_tool_carries_the_annotations_anthropics_directory_asks_for(running, applicant):
    """Anthropic's connector directory (KAN-383) refuses a tool without a
    title and an explicit read-only or destructive hint, and Claude runs a
    read-only tool without asking each time. Only the save tools write."""
    async with claude(applicant) as client:
        tools = (await client.list_tools()).tools

    assert tools
    for tool in tools:
        hints = tool.annotations
        assert tool.title, f"{tool.name} has no title"
        assert len(tool.name) <= 64, f"{tool.name} is over 64 characters"
        assert hints is not None and hints.read_only_hint is not None, f"{tool.name} doesn't say if it writes"
        writes = not hints.read_only_hint
        assert writes == tool.name.startswith("save_"), f"{tool.name}: only the save tools write"
        if writes:
            assert hints.destructive_hint is not None, f"{tool.name} doesn't say if it destroys data"
        assert hints.open_world_hint is False, f"{tool.name} reaches past WorkIt"


# --- Choice questions (one-off questions nothing else fills) ---

SIZE = {"name": "question_9", "label": "Which team size do you prefer?", "required": True, "max_length": None,
        "kind": "choice", "options": ["Small", "Large"]}
AREAS = {"name": "question_10", "label": "Which areas interest you?", "required": False, "max_length": None,
         "kind": "choices", "options": ["Backend", "Frontend", "Data"]}


async def test_a_choice_question_reaches_claude_with_its_options_and_takes_only_them(running, applicant, database):
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, SIZE, AREAS)

    async with claude(applicant) as client:
        got = (await client.call_tool("get_next_application", {})).structured_content
        not_offered = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_9", "answer": "Medium"}, {"name": "question_10", "answer": "Backend"}]})
        one_of_two = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_9", "answer": "small"}, {"name": "question_10", "answer": "Backend; Mobile"}]})
        saved = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_9", "answer": " small "}, {"name": "question_10", "answer": "data; Backend"}]})

    assert [(q["kind"], q["options"]) for q in got["questions"]] == [
        ("choice", ["Small", "Large"]), ("choices", ["Backend", "Frontend", "Data"])]
    assert not_offered.is_error and "Medium" in not_offered.content[0].text
    assert one_of_two.is_error and "Mobile" in one_of_two.content[0].text
    assert saved.is_error is False, saved.content
    # Kept in the form's own wording, as the tab fills it.
    assert [q["answer"] for q in await _tab_asks(me, job)] == ["Small", "Data; Backend"]


def test_a_choices_option_with_a_semicolon_in_it_is_one_pick():
    from app.auto_apply.written import picked
    from app.schemas.applications import WrittenAnswer

    question = WrittenAnswer(name="q", label="Which areas?", required=True, max_length=None, kind="choices",
                             options=["Backend; APIs", "Backend", "Data"], answer=None)

    assert picked(question, "backend; apis; Data") == ("Backend; APIs; Data", [])
    assert picked(question, "Backend; Data") == ("Backend; Data", [])
    assert picked(question, "Backend; APIs") == ("Backend; APIs", [])
    assert picked(question, "APIs; Data")[1]  # "APIs" alone is no option
