"""Eligibility is informational: missing or ambiguous facts cannot fail a student."""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.deps import get_current_account
from app.main import app
from app.models.dto import bank_section
from app.routers import jobs
from app.schemas.auth import AccountType
from app.schemas.eligibility import Education
from app.services.eligibility import checklist, extract

WINDOW = "Must graduate between December 2026 and June 2027."


def result(description=WINDOW, education=None):
    return checklist(
        extract(description), education or [], description_available=bool(description)
    ).items[0]


@pytest.mark.parametrize("month,status", [
    (date(2026, 12, 1), "matches"),
    (date(2027, 6, 30), "matches"),
    (date(2027, 7, 1), "potential_mismatch"),
])
def test_graduation_window_is_inclusive_by_month(month, status):
    assert result(education=[Education(end_month=month, end_kind="expected")]).status == status


@pytest.mark.parametrize("education", [
    [], [Education()], [Education(end_kind="present")],
    [Education(end_month=date(2027, 5, 1), end_kind="expected"), Education()],
])
def test_missing_or_ambiguous_education_needs_confirmation(education):
    assert result(education=education).status == "needs_confirmation"


def test_heading_context_and_full_degree_evidence_survive():
    text = "Preferred Qualifications\nPh.D. in physics.\nRequirements\nBachelor's degree."
    requirements = extract(text)
    assert [(r.evidence, r.importance) for r in requirements] == [
        ("Ph.D. in physics.", "preferred"),
        ("Bachelor's degree.", "required"),
    ]
    assert all(r.evidence in text for r in requirements)


def test_negative_degree_statement_is_not_a_required_degree():
    item = result("Requirements\nNo bachelor's degree required.")
    assert item.status == "needs_confirmation"
    assert item.importance == "stated"


def test_sponsorship_never_infers_personal_authorization():
    assert result("Visa sponsorship is not available.").status == "needs_confirmation"


@pytest.mark.parametrize("text", [
    "Must not graduate between December 2026 and June 2027.",
    WINDOW + "\nAlternatively, graduate between December 2027 and June 2028.",
])
def test_negated_or_multiple_windows_need_confirmation(text):
    education = [Education(end_month=date(2027, 5, 1), end_kind="expected")]
    assert result(text, education).status == "needs_confirmation"


def test_repeated_window_is_deduplicated():
    assert len(extract(WINDOW + "\n" + WINDOW)) == 1


def test_empty_description_does_not_invent_requirements():
    response = checklist(extract(None), [], description_available=False)
    assert not response.description_available
    assert len(response.items) == 3
    assert all(i.status == "not_stated" and i.evidence is None for i in response.items)


@pytest.fixture
def client(monkeypatch):
    account = SimpleNamespace(id=uuid4(), account_type=AccountType.APPLICANT)
    listed = AsyncMock(return_value=SimpleNamespace(description=WINDOW))
    row = SimpleNamespace(
        section=bank_section.education, degree="Bachelor's", field_of_study="CS",
        end_month=date(2027, 5, 1), end_kind="expected",
    )
    bank = AsyncMock(return_value=SimpleNamespace(entries=[SimpleNamespace(row=row)]))
    monkeypatch.setattr(jobs.postings, "listed", listed)
    monkeypatch.setattr(jobs, "load_bank", bank)
    app.dependency_overrides[get_session] = lambda: None
    app.dependency_overrides[get_current_account] = lambda: account
    with TestClient(app) as http:
        yield http, account, listed, bank
    app.dependency_overrides.pop(get_session, None)
    app.dependency_overrides.pop(get_current_account, None)


def test_route_uses_authenticated_applicants_bank(client):
    http, account, listed, bank = client
    job_id = uuid4()
    response = http.get(f"/jobs/{job_id}/eligibility")
    assert response.status_code == 200
    assert response.json()["items"][0]["status"] == "matches"
    bank.assert_awaited_once_with(None, account.id)
    listed.assert_awaited_once_with(None, job_id)


def test_route_rejects_company_accounts_before_loading_data(client):
    http, account, listed, bank = client
    account.account_type = AccountType.COMPANY
    assert http.get(f"/jobs/{uuid4()}/eligibility").status_code == 403
    listed.assert_not_awaited()
    bank.assert_not_awaited()


def test_route_requires_sign_in(client):
    http, _, listed, bank = client
    app.dependency_overrides.pop(get_current_account)
    assert http.get(f"/jobs/{uuid4()}/eligibility").status_code == 401
    listed.assert_not_awaited()
    bank.assert_not_awaited()


def test_unlisted_job_is_not_accessible(client):
    http, _, listed, bank = client
    listed.return_value = None
    assert http.get(f"/jobs/{uuid4()}/eligibility").status_code == 404
    bank.assert_not_awaited()


def test_route_accepts_empty_bank(client):
    http, _, _, bank = client
    bank.return_value = SimpleNamespace(entries=[])
    response = http.get(f"/jobs/{uuid4()}/eligibility")
    assert response.status_code == 200
    assert response.json()["items"][0]["status"] == "needs_confirmation"
