"""
Fix report alerts (KAN-478): a new report group (a signature no alert has
named yet) emails WorkIt's admins, at most once an hour, through the SES
sender. A report in a group already named sends nothing; a send SES
refuses is tried again next run.
"""

import datetime
import uuid

import pytest
from sqlalchemy import text

from app.config import get_settings
from app.services import fill_report_alerts
from app.services.fill_report_alerts import alert_new_groups

pytestmark = pytest.mark.anyio

NOW = datetime.datetime(2026, 11, 2, 15, 0, tzinfo=datetime.UTC)


@pytest.fixture
def mailbox(monkeypatch):
    sent: list[tuple[str, str, str]] = []
    accept = {"ok": True}

    async def send_email(to: str, subject: str, html: str) -> bool:
        sent.append((to, subject, html))
        return accept["ok"]

    monkeypatch.setattr(fill_report_alerts, "send_email", send_email)
    # Ids name no inbox: only the emails on WORKIT_ADMINS are mailed.
    monkeypatch.setattr(get_settings(), "workit_admins", f"dev@example.com, {uuid.uuid4()}, Lead@Example.com")
    return sent, accept


async def _report(database, signature: str, at: datetime.datetime) -> None:
    job_system = signature.split(":")[0]
    async with database() as s:
        await s.execute(text(
            "INSERT INTO fill_reports (created_at, job_system, posting_url, engine_version, fields, signature) "
            "VALUES (:at, :js, 'https://example.com/jobs/1', '0.3.2', '[]', :sig)"
        ), {"at": at, "js": job_system, "sig": signature})
        await s.commit()


async def _alert(database, now: datetime.datetime) -> int:
    async with database() as s:
        return await alert_new_groups(s, now=now)


async def test_new_groups_email_the_admins_at_most_once_an_hour(database, mailbox):
    sent, _ = mailbox
    await _report(database, "greenhouse:text:Readback", NOW - datetime.timedelta(minutes=20))
    await _report(database, "greenhouse:text:Readback", NOW - datetime.timedelta(minutes=10))
    await _report(database, "workday:select:FillError", NOW - datetime.timedelta(minutes=5))

    assert await _alert(database, NOW) == 2
    assert [to for to, _, _ in sent] == ["dev@example.com", "lead@example.com"]
    _, subject, html = sent[0]
    assert subject == "WorkIt: 2 new fix report groups"
    assert "greenhouse" in html and "text" in html and "Readback" in html and "2 reports" in html
    assert "workday" in html and "1 report" in html
    assert "/admin/fill-reports?signature=greenhouse%3Atext%3AReadback" in html

    # Within the hour: a new group waits, and nothing is sent.
    sent.clear()
    await _report(database, "lever:checkbox:Readback", NOW + datetime.timedelta(minutes=30))
    await _report(database, "greenhouse:text:Readback", NOW + datetime.timedelta(minutes=31))
    assert await _alert(database, NOW + datetime.timedelta(minutes=40)) == 0
    assert sent == []

    # An hour on: only the group no alert has named.
    assert await _alert(database, NOW + datetime.timedelta(minutes=61)) == 1
    assert len(sent) == 2 and "lever" in sent[0][2] and "greenhouse" not in sent[0][2]

    # A new report in a named group is no new group.
    sent.clear()
    await _report(database, "workday:select:FillError", NOW + datetime.timedelta(minutes=90))
    assert await _alert(database, NOW + datetime.timedelta(hours=3)) == 0
    assert sent == []


async def test_a_refused_send_is_tried_again_next_run(database, mailbox):
    sent, accept = mailbox
    await _report(database, "greenhouse:text:Readback", NOW - datetime.timedelta(minutes=5))
    accept["ok"] = False
    assert await _alert(database, NOW) == 0
    assert len(sent) == 2

    accept["ok"] = True
    sent.clear()
    assert await _alert(database, NOW + datetime.timedelta(minutes=5)) == 1
    assert len(sent) == 2
