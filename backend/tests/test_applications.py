"""
Applied jobs (KAN-232): GET /jobs hides an applicant's applied jobs only when
their token comes with the request, and the Applied routes are applicants'
only. The queries need Postgres, which tests don't have, so the routes are
tested up to it and the filter by the SQL it writes.
"""

import asyncio
import uuid

import jwt
import pytest
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient

from app.db import get_session
from app.deps import get_current_account, get_signed_in_applicant_id
from app.main import app
from app.queries.jobs.filters import JobFilters, matching
from app.routers import jobs
from app.schemas.auth import AccountType, AuthenticatedAccount
from tests.test_jobs import _sql, no_database  # noqa: F401

APPLICANT = uuid.UUID("0b8e8f3c-6a0e-4f43-9d55-6c1d7b0d9a11")


def _account(account_type: AccountType) -> AuthenticatedAccount:
    return AuthenticatedAccount(
        id=APPLICANT,
        email="seeker@example.com",
        full_name="Sam Seeker",
        account_type=account_type,
        onboarding_completed=True,
    )


def test_applied_jobs_are_left_out_for_their_applicant():
    (clause,) = matching(JobFilters(applied_by=APPLICANT))
    sql = _sql(clause)
    assert sql.startswith("NOT (EXISTS (SELECT")
    assert "job_applications.job_id = job_postings.id" in sql
    assert f"job_applications.applicant_id = '{APPLICANT.hex}'" in sql


def test_signed_out_lists_every_job():
    assert matching(JobFilters(applied_by=None)) == []


def _seen_filters(monkeypatch) -> list[JobFilters]:
    seen: list[JobFilters] = []

    async def fetch(db, limit, filters, offset=0):
        seen.append(filters)
        return []

    monkeypatch.setattr(jobs, "fetch_listings", fetch)
    return seen


def test_feed_without_a_token_filters_nothing(no_database, monkeypatch):  # noqa: F811
    seen = _seen_filters(monkeypatch)
    assert TestClient(app).get("/jobs").status_code == 200
    assert seen[0].applied_by is None


def test_feed_with_a_bad_token_is_still_public(no_database, monkeypatch):  # noqa: F811
    # A stale session must never break a page anyone may read.
    async def reject(token):
        raise jwt.InvalidTokenError("expired")

    monkeypatch.setattr("app.deps.decode_access_token", reject)
    seen = _seen_filters(monkeypatch)
    res = TestClient(app).get("/jobs", headers={"Authorization": "Bearer stale"})
    assert res.status_code == 200
    assert seen[0].applied_by is None


def test_feed_with_an_applicant_token_hides_their_jobs(no_database, monkeypatch):  # noqa: F811
    app.dependency_overrides[get_signed_in_applicant_id] = lambda: APPLICANT
    seen = _seen_filters(monkeypatch)
    assert TestClient(app).get("/jobs").status_code == 200
    assert seen[0].applied_by == APPLICANT


@pytest.mark.parametrize("account_type", ["company", None])
def test_only_an_applicant_token_names_an_applicant(monkeypatch, account_type):
    async def decode(token):
        return {"sub": str(APPLICANT), "app_metadata": {"account_type": account_type}}

    monkeypatch.setattr("app.deps.decode_access_token", decode)
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="t")
    assert asyncio.run(get_signed_in_applicant_id(creds)) is None


@pytest.fixture
def company_account():
    app.dependency_overrides[get_session] = lambda: None
    app.dependency_overrides[get_current_account] = lambda: _account(AccountType.COMPANY)
    yield
    app.dependency_overrides.clear()


def test_a_company_cannot_mark_a_job_applied(company_account):
    client = TestClient(app)
    path = f"/jobs/{uuid.uuid4()}/applied"
    assert client.post(path).status_code == 403
    assert client.get(path).status_code == 403


def test_applied_needs_a_job_uuid(company_account):
    assert TestClient(app).post("/jobs/not-a-uuid/applied").status_code == 422


def test_job_ids_narrows_to_those_postings():
    job = uuid.uuid4()
    (clause,) = matching(JobFilters(job_ids=[job]))
    assert _sql(clause) == f"job_postings.id IN ('{job.hex}')"
