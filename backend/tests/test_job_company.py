"""The job page's Company tab: the employer's website and its brief's facts."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.routers import jobs

FACT = {
    "category": "products",
    "fact": "Acme Rocket carries small satellites.",
    "url": "https://acme.com/rocket",
    "published": "2026-09",
    "team": None,
}


@pytest.fixture
def client(monkeypatch):
    listed = AsyncMock(return_value=SimpleNamespace(company_name="Acme", company_domain="acme.com"))
    brief = AsyncMock(return_value=[FACT])
    monkeypatch.setattr(jobs.postings, "listed", listed)
    monkeypatch.setattr(jobs.briefs, "brief_for", brief)
    app.dependency_overrides[get_session] = lambda: None
    try:
        with TestClient(app) as http:
            yield http, listed, brief
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_company_has_website_and_facts(client):
    http, _, _ = client
    body = http.get(f"/jobs/{uuid4()}/company").json()
    assert body["company"] == "Acme"
    assert body["website"] == "https://acme.com"
    assert body["facts"] == [{k: FACT[k] for k in ("category", "fact", "url", "published")}]


def test_company_with_no_domain_or_brief_answers_empty(client):
    http, listed, brief = client
    listed.return_value = SimpleNamespace(company_name="Acme", company_domain=None)
    brief.return_value = []
    body = http.get(f"/jobs/{uuid4()}/company").json()
    assert body == {"company": "Acme", "website": None, "facts": []}


def test_closed_job_is_not_found(client):
    http, listed, _ = client
    listed.return_value = None
    assert http.get(f"/jobs/{uuid4()}/company").status_code == 404
