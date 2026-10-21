"""
KAN-298's digest: build_digest reuses fetch_recommended and pick_batch
exactly as auto apply's own _matches does (tests/test_auto_apply_pipeline.py
is the pattern mirrored here -- fetch_recommended faked, no real database),
and send_job_alert writes the one notification and sends the one email from
it. backend/CLAUDE.md's Tests section: test behaviour, never a prompt.
"""

import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.auto_apply.pipeline import BATCH_SIZE, MIN_MATCH
from app.services import job_alerts
from tests.test_auto_apply_rules import GH, job

APPLICANT = uuid.uuid4()
ACCOUNT = SimpleNamespace(id=APPLICANT, email="sam@example.com")


def fake_recommended(scored, calls):
    async def fetch_recommended(db, account, **kwargs):
        calls.append(kwargs)
        return scored
    return fetch_recommended


class FakeDB:
    def __init__(self):
        self.added = []
        self.commit = AsyncMock()

    def add(self, row):
        self.added.append(row)


# --- build_digest ---


def test_build_digest_leaves_out_every_job_with_an_application(monkeypatch):
    calls = []
    monkeypatch.setattr(job_alerts, "fetch_recommended", fake_recommended([], calls))

    asyncio.run(job_alerts.build_digest(None, ACCOUNT))

    (kwargs,) = calls
    assert kwargs["filters"].no_application_by == APPLICANT
    # Never Greenhouse-only, unlike auto apply's own batch: a digest links
    # to WorkIt's own job page, not apply_url.
    assert not kwargs["filters"].auto_apply_only
    assert kwargs["min_match"] == MIN_MATCH


def test_build_digest_drops_repeats_then_takes_batch_size(monkeypatch):
    scored = [job(str(i), GH + str(i), title="A" if i < 2 else str(i)) for i in range(15)]
    monkeypatch.setattr(job_alerts, "fetch_recommended", fake_recommended(scored, []))

    digest = asyncio.run(job_alerts.build_digest(None, ACCOUNT))

    assert len(digest) == BATCH_SIZE
    assert digest[0].id == "0"
    assert digest[1].id == "2"  # "1" was the same company+title as "0"


# --- send_job_alert ---


def test_send_job_alert_writes_a_notification_and_sends_an_email(monkeypatch):
    scored = [job(str(i), GH + str(i), company="Acme", title=str(i), match=90 - i) for i in range(3)]
    monkeypatch.setattr(job_alerts, "fetch_recommended", fake_recommended(scored, []))
    sent = []
    monkeypatch.setattr(job_alerts, "send_email", AsyncMock(side_effect=lambda *a: sent.append(a) or True))
    db = FakeDB()

    result = asyncio.run(job_alerts.send_job_alert(db, ACCOUNT))

    assert result is True
    assert len(db.added) == 1
    notification = db.added[0]
    assert notification.applicant_id == APPLICANT
    assert notification.type == "job_alert"
    assert len(notification.data) == 3
    assert notification.data[0]["job_id"] == "0"
    db.commit.assert_awaited_once()
    assert sent  # one email call, to the account's address
    assert sent[0][0] == ACCOUNT.email


def test_send_job_alert_writes_nothing_for_an_empty_digest(monkeypatch):
    monkeypatch.setattr(job_alerts, "fetch_recommended", fake_recommended([], []))
    monkeypatch.setattr(job_alerts, "send_email", AsyncMock())
    db = FakeDB()

    result = asyncio.run(job_alerts.send_job_alert(db, ACCOUNT))

    assert result is False
    assert db.added == []
    db.commit.assert_not_called()
    job_alerts.send_email.assert_not_called()


def test_send_job_alert_keeps_the_notification_when_the_email_fails(monkeypatch):
    scored = [job("1", GH + "1")]
    monkeypatch.setattr(job_alerts, "fetch_recommended", fake_recommended(scored, []))
    monkeypatch.setattr(job_alerts, "send_email", AsyncMock(return_value=False))
    db = FakeDB()

    result = asyncio.run(job_alerts.send_job_alert(db, ACCOUNT))

    # Best-effort: a bounced or unconfigured email never undoes the bell
    # notification that was already committed.
    assert result is True
    assert len(db.added) == 1
    db.commit.assert_awaited_once()
