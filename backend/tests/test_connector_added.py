"""
Whether a student has added WorkIt to their Claude (KAN-387): GET
/applicants/{id}/connector, which the extension asks before it shows the
add-Claude step on a batch's first essay question. Claude signs in over MCP
as it does in tests/test_connector.py, against this run's throwaway database.
"""

import uuid

import pytest

from tests import test_connector
from tests.test_built_resumes import _seed_applicant
from tests.test_connector import _api, _signed_in_as, claude

pytestmark = pytest.mark.anyio

# test_connector's fixtures: the API running, and a student.
running = test_connector.running
applicant = test_connector.applicant


async def _added(student: uuid.UUID) -> dict:
    _signed_in_as(student)
    async with _api() as webapp:
        res = await webapp.get(f"/applicants/{student}/connector")
    assert res.status_code == 200, res.text
    return res.json()


async def test_a_student_who_never_connected_claude_has_not_added_it(running, applicant):
    assert await _added(applicant) == {"added": False}


async def test_a_student_whose_claude_signed_in_has_added_it(running, applicant):
    async with claude(applicant) as client:
        await client.list_tools()

    assert await _added(applicant) == {"added": True}


async def test_another_students_connector_is_not_theirs_to_ask(running, applicant, database):
    async with database() as session:
        other = await _seed_applicant(session)
    _signed_in_as(other)
    async with _api() as webapp:
        res = await webapp.get(f"/applicants/{applicant}/connector")

    assert res.status_code == 403


async def test_a_student_who_disconnects_claude_cuts_off_every_sign_in_at_once(running, applicant):
    """Disconnect from WorkIt (DELETE /applicants/{id}/connector): every
    access and refresh token the student's Claude holds stops working at
    once, on every client they connected, until they connect again."""
    first, second = test_connector._Memory(), test_connector._Memory()
    async with claude(applicant, first):
        pass
    async with claude(applicant, second):
        pass

    _signed_in_as(applicant)
    async with _api() as webapp:
        res = await webapp.delete(f"/applicants/{applicant}/connector")
    assert res.status_code == 204, res.text

    async with _api() as api:
        for memory in (first, second):
            call = await api.post(
                "/mcp", headers={"Authorization": f"Bearer {memory.tokens.access_token}"},
                json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            )
            refresh = await api.post("/token", data={
                "grant_type": "refresh_token", "refresh_token": memory.tokens.refresh_token,
                "client_id": memory.client.client_id, "client_secret": memory.client.client_secret,
            })
            assert call.status_code == 401
            assert refresh.status_code == 400
    assert await _added(applicant) == {"added": False}

    # Connecting again works.
    async with claude(applicant) as client:
        await client.list_tools()
    assert await _added(applicant) == {"added": True}


async def test_a_code_approved_before_disconnecting_is_no_longer_good(running, applicant):
    """A sign-in the student allowed but Claude hadn't traded yet goes too,
    so it can't reconnect Claude after the student disconnected."""
    from urllib.parse import parse_qs, urlparse

    from tests.test_connector import REDIRECT

    async with _api() as api:
        meta = (await api.post("/register", json={
            "client_name": "Claude", "redirect_uris": [REDIRECT], "token_endpoint_auth_method": "client_secret_post",
        })).json()
        res = await api.get("/authorize", params={
            "client_id": meta["client_id"], "redirect_uri": REDIRECT, "response_type": "code",
            "code_challenge": "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "code_challenge_method": "S256",
        })
        request = parse_qs(urlparse(res.headers["location"]).query)["request"][0]
        _signed_in_as(applicant)
        approved = await api.post(f"/connector/requests/{request}/approve")
        code = parse_qs(urlparse(approved.json()["redirect_to"]).query)["code"][0]
        assert (await api.delete(f"/applicants/{applicant}/connector")).status_code == 204
        traded = await api.post("/token", data={
            "grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT,
            "code_verifier": "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
            "client_id": meta["client_id"], "client_secret": meta["client_secret"],
        })

    assert traded.status_code == 400, traded.text


async def test_another_students_connector_is_not_theirs_to_disconnect(running, applicant, database):
    async with claude(applicant) as client:
        await client.list_tools()
    async with database() as session:
        other = await _seed_applicant(session)
    _signed_in_as(other)
    async with _api() as webapp:
        res = await webapp.delete(f"/applicants/{applicant}/connector")

    assert res.status_code == 403
    assert await _added(applicant) == {"added": True}
