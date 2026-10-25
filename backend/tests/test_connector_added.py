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
