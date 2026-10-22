"""The applicant profile's contact email and links (KAN-262): the PATCH
body's rules, GET/PATCH /applicants/{id}/profile, and the email employers
see on a resume header."""

import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.db import get_session
from app.deps import get_current_account
from app.main import app
from app.models.autofill_answers import Autofill_Answers
from app.models.profiles import Applicant_Profile
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.schemas.profile import ApplicantProfileUpdate
from app.services.built_resumes import load_header_identity

APPLICANT = uuid.uuid4()
URL = f"/applicants/{APPLICANT}/profile"


def _profile(**fields) -> Applicant_Profile:
    return Applicant_Profile(
        id=APPLICANT, email="signin@example.com", full_name="Jake Ryan", **fields
    )


class FakeSession:
    def __init__(self, profile, answers=None):
        self.profile = profile
        self.answers = answers
        self.commits = 0

    async def get(self, model, _id):
        if model is Autofill_Answers:
            return self.answers and Autofill_Answers(applicant_id=APPLICANT, answers=self.answers)
        return self.profile

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        pass

    async def refresh(self, _row):
        pass


@pytest.fixture
def client():
    session = FakeSession(_profile())
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=APPLICANT,
        email="signin@example.com",
        full_name="Jake Ryan",
        account_type=AccountType.APPLICANT,
        onboarding_completed=True,
    )
    app.dependency_overrides[get_session] = lambda: session
    yield TestClient(app), session
    app.dependency_overrides.clear()


@pytest.mark.parametrize(
    ("typed", "stored"),
    [
        ("linkedin.com/in/jake", "https://linkedin.com/in/jake"),
        ("  https://github.com/jake  ", "https://github.com/jake"),
        ("http://jake.dev", "http://jake.dev"),
        ("", None),
        ("   ", None),
        (None, None),
    ],
)
def test_a_link_is_stored_as_a_web_address(typed, stored):
    assert ApplicantProfileUpdate(other_url=typed).other_url == stored


@pytest.mark.parametrize(
    "bad", ["javascript:alert(1)", "ftp://files.example.com", "http://localhost", "jake ryan"]
)
def test_a_link_that_is_not_a_web_address_is_refused(bad):
    with pytest.raises(ValidationError):
        ApplicantProfileUpdate(linkedin_url=bad)


def test_a_contact_email_must_be_an_email_and_blank_clears_it():
    with pytest.raises(ValidationError):
        ApplicantProfileUpdate(contact_email="not an email")
    body = ApplicantProfileUpdate(contact_email="")
    assert body.contact_email is None
    assert "contact_email" in body.model_fields_set


def test_the_email_employers_see_falls_back_to_the_sign_in_email():
    assert _profile().email_for_employers == "signin@example.com"
    assert _profile(contact_email="jobs@example.com").email_for_employers == "jobs@example.com"


def test_patch_saves_the_contact_email_and_the_links(client):
    http, session = client
    res = http.patch(
        URL,
        json={"contact_email": "jobs@example.com", "github_url": "github.com/jake"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == "signin@example.com"
    assert body["contact_email"] == "jobs@example.com"
    assert body["github_url"] == "https://github.com/jake"
    assert session.commits == 1


def test_patch_with_null_removes_a_link_and_leaves_the_rest(client):
    http, session = client
    session.profile.linkedin_url = "https://linkedin.com/in/jake"
    session.profile.github_url = "https://github.com/jake"
    res = http.patch(URL, json={"linkedin_url": None})
    assert res.status_code == 200
    assert res.json()["linkedin_url"] is None
    assert res.json()["github_url"] == "https://github.com/jake"


def test_patch_refuses_a_bad_link_with_a_plain_message_and_saves_nothing(client):
    http, session = client
    res = http.patch(URL, json={"other_url": "javascript:alert(1)"})
    assert res.status_code == 422
    assert res.json()["detail"][0]["msg"].startswith("Enter a web address")
    assert session.commits == 0


def test_a_resume_header_prints_the_contact_email():
    session = FakeSession(_profile(contact_email="jobs@example.com"))
    header = asyncio.run(load_header_identity(session, APPLICANT))
    assert header.email == "jobs@example.com"

    session = FakeSession(_profile())
    assert asyncio.run(load_header_identity(session, APPLICANT)).email == "signin@example.com"


@pytest.mark.parametrize(
    ("answers", "printed"),
    [
        (None, False),
        ({}, False),
        ({"work_authorization_status": "us_citizen"}, True),
        ({"work_authorization_status": "permanent_resident"}, False),
        # An option the code no longer knows reads as unanswered
        ({"work_authorization_status": "US citizen"}, False),
    ],
)
def test_a_resume_header_says_us_citizen_from_the_citizenship_answer(answers, printed):
    session = FakeSession(_profile(), answers)
    assert asyncio.run(load_header_identity(session, APPLICANT)).us_citizen is printed
