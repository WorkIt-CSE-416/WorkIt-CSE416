"""Tests for auto apply's layer 2, with fetch_recommended faked: no DB."""

import asyncio
import uuid

from app.auto_apply import pipeline
from app.queries.jobs.filters import JobFilters
from tests.test_auto_apply_rules import GH, job


def fake_recommended(scored, calls):
    async def fetch_recommended(db, applicant_id, **kwargs):
        calls.append(kwargs)
        return scored
    return fetch_recommended


def test_get_matches_leaves_out_applied_jobs_by_the_feeds_filter(monkeypatch):
    calls = []
    monkeypatch.setattr(pipeline, "fetch_recommended", fake_recommended([], calls))
    applicant_id = uuid.uuid4()

    asyncio.run(pipeline.get_matches(None, applicant_id, filters=JobFilters(visa="sponsors")))

    (kwargs,) = calls
    assert kwargs["filters"].applied_by == applicant_id
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

    matches = asyncio.run(pipeline.get_matches(None, uuid.uuid4(), size=2))

    assert [j.id for j in matches] == ["1", "3"]
