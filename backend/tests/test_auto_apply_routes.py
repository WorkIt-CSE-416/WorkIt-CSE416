"""
Auto apply's routes (layer 3): each checks the caller owns the applicant,
calls one layer-2 step and maps its errors. The steps are faked: no DB.
"""

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.auto_apply import pipeline
from app.db import get_session
from app.deps import get_current_account
from app.main import app
from app.models.dto import application_stage
from app.routers.jobs import EmptyBank
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.schemas.sent_resume import SentResumeDownload
from app.services.resume_render import TectonicUnavailable
from tests.test_jobs import no_database  # noqa: F401

APPLICANT = uuid.UUID("0b8e8f3c-6a0e-4f43-9d55-6c1d7b0d9a11")
JOB = uuid.UUID("5a1d2c3e-0000-4000-8000-000000000001")
BASE = f"/applicants/{APPLICANT}"


def _account(account_type=AccountType.APPLICANT, id=APPLICANT):
    return AuthenticatedAccount(
        id=id,
        email="seeker@example.com",
        full_name="Sam Seeker",
        account_type=account_type,
        onboarding_completed=True,
    )


@pytest.fixture
def client(no_database):  # noqa: F811
    app.dependency_overrides[get_session] = lambda: None
    app.dependency_overrides[get_current_account] = _account
    yield TestClient(app)
    app.dependency_overrides.clear()


def step(monkeypatch, name, result=None, raises=None):
    """Fakes one layer-2 step; answers the calls it got."""
    calls = []

    async def fake(*args, **kwargs):
        calls.append((args, kwargs))
        if raises:
            raise raises
        return result

    monkeypatch.setattr(pipeline, name, fake)
    return calls


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", "/auto-apply/matches", None),
        ("post", "/auto-apply/batches", {}),
        ("post", "/applications", {"job_id": str(JOB)}),
        ("get", "/applications", None),
        ("get", "/applications/next", None),
        ("get", f"/applications/{JOB}", None),
        ("post", f"/applications/{JOB}/finish", {"outcome": "skipped"}),
        ("post", f"/applications/{JOB}/resume", None),
        ("delete", f"/applications/{JOB}", None),
    ],
)
def test_every_route_is_the_owners_only(client, method, path, body):
    app.dependency_overrides[get_current_account] = lambda: _account(id=uuid.uuid4())
    assert client.request(method, BASE + path, json=body).status_code == 403
    app.dependency_overrides[get_current_account] = lambda: _account(AccountType.COMPANY)
    assert client.request(method, BASE + path, json=body).status_code == 403


def test_batch_answers_the_queued_ids(client, monkeypatch):
    calls = step(monkeypatch, "start_batch", ["a", "b"])
    res = client.post(BASE + "/auto-apply/batches", json={"size": 2})
    assert res.status_code == 200
    assert res.json() == {"queued": ["a", "b"]}
    (args, kwargs) = calls[0]
    assert args[1].id == APPLICANT and kwargs["size"] == 2


def test_batch_size_is_capped(client):
    assert client.post(BASE + "/auto-apply/batches", json={"size": 500}).status_code == 422


@pytest.mark.parametrize("name, method, path, body", [
    ("start_batch", "post", "/auto-apply/batches", {}),
    ("get_matches", "get", "/auto-apply/matches", None),
])
def test_empty_bank_is_404(client, monkeypatch, name, method, path, body):
    step(monkeypatch, name, raises=EmptyBank("Your experience bank is empty"))
    assert client.request(method, BASE + path, json=body).status_code == 404


def test_queue_answers_the_stage(client, monkeypatch):
    step(monkeypatch, "queue_job", application_stage.queued)
    res = client.post(BASE + "/applications", json={"job_id": str(JOB)})
    assert res.json() == {"job_id": str(JOB), "stage": "queued"}


def test_queue_a_closed_job_is_404(client, monkeypatch):
    step(monkeypatch, "queue_job", raises=pipeline.NotFound("closed"))
    assert client.post(BASE + "/applications", json={"job_id": str(JOB)}).status_code == 404


def test_list_reads_the_stages_asked_for(client, monkeypatch):
    calls = step(monkeypatch, "list_applications", [])
    res = client.get(BASE + "/applications?stage=queued&stage=needs_you")
    assert res.status_code == 200
    assert calls[0][0][2] == [application_stage.queued, application_stage.needs_you]
    assert calls[0][1]["score_for"] is None  # the queue's reads never score


def test_list_scores_for_the_signed_in_applicant_on_request(client, monkeypatch):
    calls = step(monkeypatch, "list_applications", [])
    assert client.get(BASE + "/applications?stage=saved&scored=true").status_code == 200
    assert calls[0][1]["score_for"].id == APPLICANT


def test_next_is_null_when_the_queue_is_empty(client, monkeypatch):
    step(monkeypatch, "next_application", None)
    res = client.get(BASE + "/applications/next")
    assert res.status_code == 200
    assert res.json() is None


def test_next_is_not_read_as_a_job_id(client, monkeypatch):
    step(monkeypatch, "next_application", None)
    step(monkeypatch, "get_application", raises=AssertionError("wrong route"))
    assert client.get(BASE + "/applications/next").status_code == 200


def test_one_application_without_one_is_404(client, monkeypatch):
    step(monkeypatch, "get_application", raises=pipeline.NotFound("none"))
    assert client.get(BASE + f"/applications/{JOB}").status_code == 404


def test_finish_a_finished_one_is_409(client, monkeypatch):
    step(monkeypatch, "finish_application", raises=pipeline.WrongStage("applied"))
    res = client.post(BASE + f"/applications/{JOB}/finish", json={"outcome": "submitted"})
    assert res.status_code == 409


def test_finish_reads_only_known_outcomes(client):
    res = client.post(BASE + f"/applications/{JOB}/finish", json={"outcome": "sent"})
    assert res.status_code == 422


@pytest.fixture
def storage(monkeypatch):
    """The Supabase client the resume route hands to its step."""
    client = SimpleNamespace(storage=object())
    monkeypatch.setattr("app.routers.auto_apply.get_supabase", lambda: client)
    return client.storage


def test_resume_answers_the_kept_resume_and_its_link(client, monkeypatch, storage):
    sent = SentResumeDownload(
        id=uuid.uuid4(), name="General SWE", built_resume_id=uuid.uuid4(), uploaded_resume_id=None,
        job_posting_id=JOB, created_at=datetime.now(UTC), format="pdf",
        url="https://storage.test/x.pdf", missing_characters=[],
    )
    calls = step(monkeypatch, "prepare_resume", sent)
    res = client.post(BASE + f"/applications/{JOB}/resume")
    assert res.status_code == 200
    assert (res.json()["url"], res.json()["job_posting_id"]) == (sent.url, str(JOB))
    assert calls[0][0][1:] == (storage, APPLICANT, JOB)


def test_resume_is_null_without_one(client, monkeypatch, storage):
    step(monkeypatch, "prepare_resume", None)
    res = client.post(BASE + f"/applications/{JOB}/resume")
    assert (res.status_code, res.json()) == (200, None)


@pytest.mark.parametrize(
    ("raises", "status"),
    [
        (pipeline.NotFound("none"), 404),
        (pipeline.WrongStage("applied"), 409),
        (TectonicUnavailable("no TeX"), 503),
        (pipeline.FileFailed("bucket"), 502),
    ],
)
def test_resume_errors(client, monkeypatch, storage, raises, status):
    step(monkeypatch, "prepare_resume", raises=raises)
    assert client.post(BASE + f"/applications/{JOB}/resume").status_code == status


def test_dequeue_answers_204(client, monkeypatch):
    calls = step(monkeypatch, "dequeue_job", None)
    res = client.delete(BASE + f"/applications/{JOB}")
    assert (res.status_code, res.content) == (204, b"")
    assert calls[0][0][1:] == (APPLICANT, JOB)


@pytest.mark.parametrize(
    ("raises", "status"), [(pipeline.NotFound("none"), 404), (pipeline.WrongStage("applied"), 409)]
)
def test_dequeue_errors(client, monkeypatch, raises, status):
    step(monkeypatch, "dequeue_job", raises=raises)
    assert client.delete(BASE + f"/applications/{JOB}").status_code == status
