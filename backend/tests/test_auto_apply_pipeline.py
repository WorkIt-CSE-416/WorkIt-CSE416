"""Tests for auto apply's layer 2, with its layer-1 calls faked: no DB."""

import asyncio
import uuid
from unittest.mock import AsyncMock

import pytest

from app.auto_apply import pipeline
from app.models.dto import application_stage
from app.queries.jobs.filters import JobFilters
from tests.test_auto_apply_rules import GH, job

APPLICANT = uuid.uuid4()
JOB = uuid.uuid4()


class FakeDB:
    def __init__(self):
        self.commit = AsyncMock()


def fake_recommended(scored, calls):
    async def fetch_recommended(db, applicant_id, **kwargs):
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

    asyncio.run(pipeline.get_matches(None, APPLICANT, filters=JobFilters(visa="sponsors")))

    (kwargs,) = calls
    assert kwargs["filters"].no_application_by == APPLICANT
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

    matches = asyncio.run(pipeline.get_matches(None, APPLICANT, size=2))

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

    queued = asyncio.run(pipeline.start_batch(db, APPLICANT, size=3))

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
