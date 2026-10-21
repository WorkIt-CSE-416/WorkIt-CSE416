"""Tests for auto apply's layer 2, with its layer-1 calls faked: no DB."""

import asyncio
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.auto_apply import pipeline
from app.auto_apply.queries import ResumeChoice
from app.models.dto import application_stage
from app.queries.jobs.filters import JobFilters
from app.routers.jobs import EmptyBank
from app.schemas.applications import Application
from app.schemas.jobs import Highlight
from app.services.bank import NotFound as ResumeNotFound
from app.services.sent_resumes import Sent
from tests.test_auto_apply_rules import GH, job

APPLICANT = uuid.uuid4()
ACCOUNT = SimpleNamespace(id=APPLICANT)
JOB = uuid.uuid4()


class FakeDB:
    def __init__(self):
        self.commit = AsyncMock()


def fake_recommended(scored, calls):
    async def fetch_recommended(db, account, **kwargs):
        calls.append(kwargs)
        return scored
    return fetch_recommended


def fake_stage(monkeypatch, stage):
    async def fetch_stage(db, applicant_id, job_id):
        return stage
    monkeypatch.setattr(pipeline, "fetch_stage", fetch_stage)


# --- get_matches ---

def test_get_matches_leaves_out_every_job_with_an_application(monkeypatch):
    calls = []
    monkeypatch.setattr(pipeline, "fetch_recommended", fake_recommended([], calls))

    asyncio.run(pipeline.get_matches(None, ACCOUNT, filters=JobFilters(visa="sponsors")))

    (kwargs,) = calls
    assert kwargs["filters"].no_application_by == APPLICANT
    assert kwargs["filters"].auto_apply_only  # Greenhouse only
    assert kwargs["filters"].visa == "sponsors"  # the caller's filters still apply
    assert kwargs["min_match"] == pipeline.MIN_MATCH


def test_get_matches_drops_repeats_then_takes_size(monkeypatch):
    scored = [
        job("1", GH + "1", title="A"),
        job("2", GH + "2", title="A"),  # the same role at another office
        job("3", GH + "3", title="B"),
        job("4", GH + "4", title="C"),
    ]
    monkeypatch.setattr(pipeline, "fetch_recommended", fake_recommended(scored, []))

    matches = asyncio.run(pipeline.get_matches(None, ACCOUNT, size=2))

    assert [j.id for j in matches] == ["1", "3"]


# --- start_batch ---

def test_start_batch_queues_the_matches_in_one_commit_best_first(monkeypatch):
    ids = [str(uuid.uuid4()) for _ in range(3)]
    scored = [job(i, GH + i, title=i) for i in ids]
    monkeypatch.setattr(pipeline, "fetch_recommended", fake_recommended(scored, []))
    asked = []

    async def queue_applications(db, applicant_id, job_ids):
        asked.append(job_ids)
        return {uuid.UUID(ids[2]), uuid.UUID(ids[0])}  # one was queued meanwhile

    monkeypatch.setattr(pipeline, "queue_applications", queue_applications)
    db = FakeDB()

    queued = asyncio.run(pipeline.start_batch(db, ACCOUNT, size=3))

    assert asked == [[uuid.UUID(i) for i in ids]]
    assert queued == [ids[0], ids[2]]  # in match order, not the set's
    db.commit.assert_awaited_once()


# --- queue_job ---

def test_queue_job_queues_and_commits(monkeypatch):
    async def queue_applications(db, applicant_id, job_ids):
        return set(job_ids)

    monkeypatch.setattr(pipeline, "queue_applications", queue_applications)
    db = FakeDB()

    assert asyncio.run(pipeline.queue_job(db, APPLICANT, JOB)) == application_stage.queued
    db.commit.assert_awaited_once()


def test_queue_job_keeps_an_existing_application(monkeypatch):
    monkeypatch.setattr(pipeline, "queue_applications", AsyncMock(return_value=set()))
    fake_stage(monkeypatch, application_stage.skipped)
    db = FakeDB()

    assert asyncio.run(pipeline.queue_job(db, APPLICANT, JOB)) == application_stage.skipped
    db.commit.assert_not_awaited()


def test_queue_job_refuses_a_job_that_isnt_open(monkeypatch):
    monkeypatch.setattr(pipeline, "queue_applications", AsyncMock(return_value=set()))
    fake_stage(monkeypatch, None)

    with pytest.raises(pipeline.NotFound):
        asyncio.run(pipeline.queue_job(FakeDB(), APPLICANT, JOB))


# --- finish_application ---

@pytest.mark.parametrize(
    ("before", "outcome", "after"),
    [
        (application_stage.queued, "submitted", application_stage.applied),
        (application_stage.queued, "skipped", application_stage.skipped),
        (application_stage.queued, "failed", application_stage.needs_you),
        (application_stage.needs_you, "submitted", application_stage.applied),
    ],
)
def test_finish_application_moves_the_stage(monkeypatch, before, outcome, after):
    fake_stage(monkeypatch, before)
    set_stage = AsyncMock()
    monkeypatch.setattr(pipeline, "set_stage", set_stage)
    db = FakeDB()

    assert asyncio.run(pipeline.finish_application(db, APPLICANT, JOB, outcome)) == after
    set_stage.assert_awaited_once_with(db, APPLICANT, JOB, after)
    db.commit.assert_awaited_once()


@pytest.mark.parametrize("stage", [application_stage.applied, application_stage.skipped])
def test_finish_application_refuses_a_finished_one(monkeypatch, stage):
    fake_stage(monkeypatch, stage)
    set_stage = AsyncMock()
    monkeypatch.setattr(pipeline, "set_stage", set_stage)

    with pytest.raises(pipeline.WrongStage, match="Queue a new job"):
        asyncio.run(pipeline.finish_application(FakeDB(), APPLICANT, JOB, "submitted"))
    set_stage.assert_not_awaited()


def test_get_application_without_one_is_not_found(monkeypatch):
    async def fetch_application(db, applicant_id, job_id):
        return None

    monkeypatch.setattr(pipeline, "fetch_application", fetch_application)
    with pytest.raises(pipeline.NotFound):
        asyncio.run(pipeline.get_application(None, APPLICANT, JOB))


def test_finish_application_needs_an_application(monkeypatch):
    fake_stage(monkeypatch, None)

    with pytest.raises(pipeline.NotFound):
        asyncio.run(pipeline.finish_application(FakeDB(), APPLICANT, JOB, "skipped"))


# --- prepare_resume ---

class FakeStorage:
    """The bucket: signs any path, records removals."""

    def __init__(self):
        self.removed = []

    def from_(self, bucket):
        assert bucket == "Resume"
        return self

    def create_signed_url(self, path, ttl, options=None):
        return {"signedUrl": f"https://storage.test/{path}"}

    def remove(self, paths):
        self.removed.extend(paths)


def sent_row(**kwargs):
    """A Sent_Resume row as the sent resume service returns it."""
    row = {
        "id": uuid.uuid4(), "name": "General SWE", "built_resume_id": uuid.uuid4(),
        "uploaded_resume_id": None, "job_posting_id": JOB, "created_at": datetime.now(UTC),
        "storage_path": f"{APPLICANT}/sent/x.pdf", "snapshot_id": None, "content_hash": "abc",
    }
    return SimpleNamespace(**{**row, **kwargs})


def fake_pick(monkeypatch, choice):
    """Fakes pick_resume, and link_resume after it (the application names
    the sent resume, KAN-267). Answers the links made."""
    async def pick_resume(db, applicant_id, job_id):
        return choice
    monkeypatch.setattr(pipeline, "pick_resume", pick_resume)
    links = AsyncMock()
    monkeypatch.setattr(pipeline, "link_resume", links)
    return links


def fake_send(monkeypatch, name, sent=None, raises=None):
    """Fakes sent_resumes.send_built or send_uploaded; answers its calls."""
    calls = []

    async def send(*args, **kwargs):
        calls.append((args, kwargs))
        if raises:
            raise raises
        return sent

    monkeypatch.setattr(pipeline.sent_resumes, name, send)
    return calls


def test_prepare_resume_keeps_the_pick_for_the_job_and_answers_its_pdf(monkeypatch):
    fake_stage(monkeypatch, application_stage.queued)
    built = uuid.uuid4()
    fake_pick(monkeypatch, ResumeChoice(built_resume_id=built))
    # A built resume's send is a snapshot (KAN-267): no stored file, and the
    # PDF it just rendered comes back as the file.
    row = sent_row(built_resume_id=built, storage_path=None, snapshot_id=uuid.uuid4())
    calls = fake_send(monkeypatch, "send_built", Sent(row, created=True, missing_characters=("П",), pdf=b"%PDF"))
    db, storage = FakeDB(), FakeStorage()

    resume = asyncio.run(pipeline.prepare_resume(db, storage, APPLICANT, JOB))

    ((args, kwargs),) = calls
    assert args[1:] == (APPLICANT, built) and kwargs == {"job_posting_id": JOB}
    db.commit.assert_awaited_once()
    assert (resume.id, resume.built_resume_id, resume.job_posting_id) == (row.id, built, JOB)
    assert (resume.url, resume.data, resume.file_name) == (None, "JVBERg==", "General SWE.pdf")
    assert (resume.format, resume.missing_characters) == ("pdf", ["П"])


def test_prepare_resume_sends_an_uploaded_default_as_its_own_file(monkeypatch):
    fake_stage(monkeypatch, application_stage.needs_you)
    uploaded = uuid.uuid4()
    fake_pick(monkeypatch, ResumeChoice(uploaded_resume_id=uploaded))
    row = sent_row(built_resume_id=None, uploaded_resume_id=uploaded, content_hash=None)
    calls = fake_send(monkeypatch, "send_uploaded", Sent(row, created=True))
    fake_send(monkeypatch, "send_built", raises=AssertionError("not a built resume"))

    resume = asyncio.run(pipeline.prepare_resume(FakeDB(), FakeStorage(), APPLICANT, JOB))

    ((args, kwargs),) = calls
    assert args[1:] == (APPLICANT, uploaded) and kwargs == {"job_posting_id": JOB}
    assert resume.uploaded_resume_id == uploaded
    assert (resume.url, resume.data) == (f"https://storage.test/{row.storage_path}", None)


def test_prepare_resume_again_keeps_nothing_new_and_links_the_same_one(monkeypatch):
    fake_stage(monkeypatch, application_stage.queued)
    links = fake_pick(monkeypatch, ResumeChoice(built_resume_id=uuid.uuid4()))
    row = sent_row()
    fake_send(monkeypatch, "send_built", Sent(row, created=False))
    db = FakeDB()

    assert asyncio.run(pipeline.prepare_resume(db, FakeStorage(), APPLICANT, JOB)) is not None
    links.assert_awaited_once_with(db, APPLICANT, JOB, row.id)
    db.commit.assert_awaited_once()


def test_prepare_resume_without_a_resume_is_none(monkeypatch):
    fake_stage(monkeypatch, application_stage.queued)
    fake_pick(monkeypatch, None)
    fake_send(monkeypatch, "send_built", raises=AssertionError("nothing to send"))
    db = FakeDB()

    assert asyncio.run(pipeline.prepare_resume(db, FakeStorage(), APPLICANT, JOB)) is None
    db.commit.assert_not_awaited()


@pytest.mark.parametrize(
    ("stage", "error"),
    [
        (None, pipeline.NotFound),
        (application_stage.applied, pipeline.WrongStage),
        (application_stage.skipped, pipeline.WrongStage),
    ],
)
def test_prepare_resume_needs_an_open_application(monkeypatch, stage, error):
    fake_stage(monkeypatch, stage)
    monkeypatch.setattr(pipeline, "pick_resume", AsyncMock(side_effect=AssertionError("picked first")))

    with pytest.raises(error):
        asyncio.run(pipeline.prepare_resume(FakeDB(), FakeStorage(), APPLICANT, JOB))


def test_prepare_resume_for_a_closed_job_is_not_found(monkeypatch):
    fake_stage(monkeypatch, application_stage.queued)
    fake_pick(monkeypatch, ResumeChoice(built_resume_id=uuid.uuid4()))
    fake_send(monkeypatch, "send_built", raises=ResumeNotFound())

    with pytest.raises(pipeline.NotFound, match="isn't open"):
        asyncio.run(pipeline.prepare_resume(FakeDB(), FakeStorage(), APPLICANT, JOB))


def test_prepare_resume_storage_refusing_the_link_is_file_failed(monkeypatch):
    fake_stage(monkeypatch, application_stage.queued)
    uploaded = uuid.uuid4()
    fake_pick(monkeypatch, ResumeChoice(uploaded_resume_id=uploaded))
    row = sent_row(built_resume_id=None, uploaded_resume_id=uploaded, content_hash=None)
    fake_send(monkeypatch, "send_uploaded", Sent(row, created=False))
    storage = FakeStorage()
    storage.create_signed_url = MagicMock(side_effect=RuntimeError("bucket said no"))

    with pytest.raises(pipeline.FileFailed):
        asyncio.run(pipeline.prepare_resume(FakeDB(), storage, APPLICANT, JOB))


@pytest.mark.parametrize("uploaded", [False, True])
def test_a_failed_commit_rolls_back_and_removes_no_file(monkeypatch, uploaded):
    # A send stores no file (KAN-267): a built resume's is a snapshot row,
    # an uploaded resume's is its own. Nothing to clean up either way.
    fake_stage(monkeypatch, application_stage.queued)
    row = sent_row(uploaded_resume_id=uuid.uuid4() if uploaded else None)
    if uploaded:
        fake_pick(monkeypatch, ResumeChoice(uploaded_resume_id=row.uploaded_resume_id))
        fake_send(monkeypatch, "send_uploaded", Sent(row, created=True))
    else:
        fake_pick(monkeypatch, ResumeChoice(built_resume_id=row.built_resume_id))
        fake_send(monkeypatch, "send_built", Sent(row, created=True))
    db, storage = FakeDB(), FakeStorage()
    db.commit.side_effect = SQLAlchemyError("lost the connection")
    db.rollback = AsyncMock()

    with pytest.raises(SQLAlchemyError):
        asyncio.run(pipeline.prepare_resume(db, storage, APPLICANT, JOB))
    db.rollback.assert_awaited_once()
    assert storage.removed == []


# --- dequeue_job ---

def test_dequeue_job_removes_a_queued_one_and_commits(monkeypatch):
    monkeypatch.setattr(pipeline, "remove_queued", AsyncMock(return_value=True))
    db = FakeDB()

    asyncio.run(pipeline.dequeue_job(db, APPLICANT, JOB))
    db.commit.assert_awaited_once()


@pytest.mark.parametrize(
    ("stage", "error"),
    [
        (None, pipeline.NotFound),
        (application_stage.needs_you, pipeline.WrongStage),
        (application_stage.applied, pipeline.WrongStage),
    ],
)
def test_dequeue_job_leaves_anything_past_queued(monkeypatch, stage, error):
    monkeypatch.setattr(pipeline, "remove_queued", AsyncMock(return_value=False))
    fake_stage(monkeypatch, stage)
    db = FakeDB()

    with pytest.raises(error):
        asyncio.run(pipeline.dequeue_job(db, APPLICANT, JOB))
    db.commit.assert_not_awaited()


# --- list_applications ---

def tracked(open: bool = True) -> Application:
    """A saved application, as fetch_applications reads it."""
    id = str(uuid.uuid4())
    return Application(
        job=job(id, GH + id).model_dump(), stage=application_stage.saved,
        added_at=datetime.now(UTC), applied_at=None, open=open,
    )


def fake_applications(monkeypatch, applications):
    async def fetch_applications(db, applicant_id, stages):
        return applications
    monkeypatch.setattr(pipeline, "fetch_applications", fetch_applications)


def test_list_applications_scores_only_on_request(monkeypatch):
    fake_applications(monkeypatch, [tracked()])
    calls = []
    monkeypatch.setattr(pipeline, "fetch_recommended", fake_recommended([], calls))

    (app,) = asyncio.run(pipeline.list_applications(None, APPLICANT))

    assert calls == []  # never embeds the bank for the queue's reads
    assert app.match is None


def test_list_applications_takes_the_jobs_page_score_for_open_postings(monkeypatch):
    scored, unscored, closed = tracked(), tracked(), tracked(open=False)
    fake_applications(monkeypatch, [scored, unscored, closed])
    calls = []
    monkeypatch.setattr(
        pipeline,
        "fetch_recommended",
        fake_recommended(
            [
                job(scored.job.id, GH, match=73).model_copy(
                    update={"highlights": [Highlight(text="Python", met=True)]}
                )
            ],
            calls,
        ),
    )

    apps = asyncio.run(pipeline.list_applications(None, APPLICANT, score_for=ACCOUNT))

    (kwargs,) = calls
    # The open postings only: a closed one is no longer on the Jobs page.
    assert kwargs["filters"].job_ids == [uuid.UUID(scored.job.id), uuid.UUID(unscored.job.id)]
    assert [a.match for a in apps] == [73, None, None]
    assert [h.text for h in apps[0].highlights] == ["Python"]
    assert apps[1].highlights == []


def test_list_applications_with_an_empty_bank_has_no_scores(monkeypatch):
    fake_applications(monkeypatch, [tracked()])

    async def empty_bank(db, account, **kwargs):
        raise EmptyBank("Your experience bank is empty")

    monkeypatch.setattr(pipeline, "fetch_recommended", empty_bank)

    (app,) = asyncio.run(pipeline.list_applications(None, APPLICANT, score_for=ACCOUNT))

    assert app.match is None
