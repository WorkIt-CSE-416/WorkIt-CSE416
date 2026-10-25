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
    assert shown.json() == {"client_name": "Claude"}


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
