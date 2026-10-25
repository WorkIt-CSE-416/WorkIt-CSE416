"""
A student's writing samples (KAN-384): GET, POST, PUT and DELETE under
/applicants/{id}/writing-samples. A student keeps up to three samples of
their own writing; their Claude builds a style card from them through the
connector (tests/test_connector_style_card.py). Real Postgres, since a
change to the samples drops the card in the same transaction.
"""

import uuid

import httpx
import pytest

from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount
from tests.test_built_resumes import _seed_applicant

pytestmark = pytest.mark.anyio

ESSAY = "I rebuilt our club's sign-up sheet as a small web app, and dues collection went from weeks to a day."
COVER = "Last spring I tutored three classmates in data structures, and all three passed the final."


def _sign_in(applicant_id: uuid.UUID) -> None:
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=applicant_id, email="sam@example.com", full_name="Sam Seeker",
        account_type=AccountType.APPLICANT, onboarding_completed=True,
    )


@pytest.fixture
async def student(database):
    async with database() as session:
        applicant_id = await _seed_applicant(session)
    _sign_in(applicant_id)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            c.url_for = f"/applicants/{applicant_id}/writing-samples"
            yield c
    finally:
        app.dependency_overrides.pop(get_current_account, None)


async def test_no_samples_reads_as_an_empty_list_and_no_style_card(student):
    res = await student.get(student.url_for)
    assert res.status_code == 200
    assert res.json() == {"samples": [], "style_card": None}


async def test_a_student_adds_samples_and_reads_them_back_in_order(student):
    first = await student.post(student.url_for, json={"text": ESSAY})
    second = await student.post(student.url_for, json={"text": COVER})

    assert first.status_code == 201, first.text
    assert second.status_code == 201
    got = (await student.get(student.url_for)).json()
    assert [s["text"] for s in got["samples"]] == [ESSAY, COVER]
    assert got["samples"][0]["id"] == first.json()["id"]


async def test_a_student_replaces_and_removes_a_sample(student):
    added = (await student.post(student.url_for, json={"text": ESSAY})).json()
    kept = (await student.post(student.url_for, json={"text": COVER})).json()

    replaced = await student.put(f"{student.url_for}/{added['id']}", json={"text": "A new essay of mine."})
    removed = await student.delete(f"{student.url_for}/{kept['id']}")

    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["text"] == "A new essay of mine."
    assert removed.status_code == 204
    assert [s["text"] for s in (await student.get(student.url_for)).json()["samples"]] == ["A new essay of mine."]


async def test_a_fourth_sample_is_refused(student):
    for _ in range(3):
        assert (await student.post(student.url_for, json={"text": ESSAY})).status_code == 201

    res = await student.post(student.url_for, json={"text": COVER})

    assert res.status_code == 409
    assert len((await student.get(student.url_for)).json()["samples"]) == 3


@pytest.mark.parametrize("text", ["", "   ", "x" * 10_001], ids=["empty", "blank", "oversized"])
async def test_an_empty_or_oversized_sample_is_refused(student, text):
    res = await student.post(student.url_for, json={"text": text})
    assert res.status_code == 422


async def test_another_students_sample_is_not_found(student, database):
    async with database() as session:
        them = await _seed_applicant(session)
    _sign_in(them)
    theirs = (await student.post(f"/applicants/{them}/writing-samples", json={"text": ESSAY})).json()
    _sign_in(uuid.UUID(student.url_for.split("/")[2]))

    replaced = await student.put(f"{student.url_for}/{theirs['id']}", json={"text": "Mine now."})
    removed = await student.delete(f"{student.url_for}/{theirs['id']}")
    peeked = await student.get(f"/applicants/{them}/writing-samples")

    assert replaced.status_code == 404
    assert removed.status_code == 404
    assert peeked.status_code == 403
