"""
KAN-483's notice emails, against real Postgres and a fake SES: the
broadcast reaches each active account once and a re-run sends nothing new,
a bounced or complaining address is never sent to again, and every link
points at workitjobs.ai. No test reaches AWS.
"""

import asyncio
import uuid

import pytest
from sqlalchemy import text

from app.services import notices

pytestmark = pytest.mark.anyio


class FakeSes:
    """SES (send_email) and SES v2 (list_suppressed_destinations) in one."""

    def __init__(self, *, suppressed=(), refuse=()):
        self.sent = []
        self.suppressed = list(suppressed)
        self.refuse = set(refuse)

    def send_email(self, **kwargs):
        (to,) = kwargs["Destination"]["ToAddresses"]
        if to in self.refuse:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "MessageRejected", "Message": "no"}}, "SendEmail")
        self.sent.append(kwargs)
        return {"MessageId": f"fake-{len(self.sent)}"}

    def list_suppressed_destinations(self, **kwargs):
        # One summary per page, so the caller must follow NextToken.
        start = int(kwargs.get("NextToken", 0))
        page = {"SuppressedDestinationSummaries": self.suppressed[start : start + 1]}
        if start + 1 < len(self.suppressed):
            page["NextToken"] = str(start + 1)
        return page

    def recipients(self):
        return [call["Destination"]["ToAddresses"][0] for call in self.sent]


@pytest.fixture
def ses(monkeypatch):
    fake = FakeSes()
    from app.services import email

    monkeypatch.setattr(email, "_client", lambda: fake)
    monkeypatch.setattr(notices, "_suppression_client", lambda: fake)
    return fake


async def _applicant(session, address: str) -> None:
    account_id = uuid.uuid4()
    await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": account_id})
    await session.execute(
        text("INSERT INTO applicant_profiles (id, email, full_name) VALUES (:id, :email, 'Sam')"),
        {"id": account_id, "email": address},
    )


# --- suppressions ---


async def test_bounces_and_complaints_from_ses_are_suppressed(database, ses):
    ses.suppressed = [
        {"EmailAddress": "Bounced@Example.com", "Reason": "BOUNCE"},
        {"EmailAddress": "angry@example.com", "Reason": "COMPLAINT"},
    ]
    async with database() as session:
        assert await notices.sync_suppressions(session) == 2
        # A second sync adds nothing and does not fail on the repeats.
        assert await notices.sync_suppressions(session) == 0
        assert await notices.is_suppressed(session, "bounced@example.com")
        assert await notices.is_suppressed(session, "ANGRY@example.com")
        assert not await notices.is_suppressed(session, "fine@example.com")


async def _member(session, address: str, status: str) -> None:
    account_id = uuid.uuid4()
    company_id = uuid.uuid4()
    await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": account_id})
    await session.execute(
        text(
            "INSERT INTO company_profiles (id, company_name, contact_email, size_range)"
            " VALUES (:id, 'Acme', :contact, 'ONE_TO_FIFTY')"
        ),
        {"id": company_id, "contact": f"hr-{company_id}@example.com"},
    )
    await session.execute(
        text(
            "INSERT INTO company_memberships (id, email, full_name, company_id, role, status)"
            " VALUES (:id, :email, 'Rae', :company, 'owner', :status)"
        ),
        {"id": account_id, "email": address, "company": company_id, "status": status},
    )


NOTICE = notices.Notice(
    subject="We updated our privacy policy",
    body="We changed how long we keep fill reports.\n\nNothing else changed.",
    link="https://workitjobs.ai/privacy",
    link_text="Read the policy",
)


async def no_wait(seconds):
    pass


async def _everyone(database):
    async with database() as session:
        await _applicant(session, "sam@example.com")
        await _applicant(session, "Lee@Example.com")
        await _member(session, "rae@example.com", "active")
        await _member(session, "gone@example.com", "disabled")
        await session.commit()


# --- the broadcast ---


async def test_a_dry_run_counts_every_active_account_and_sends_nothing(database, ses):
    await _everyone(database)

    async with database() as session:
        report = await notices.broadcast(session, "privacy-2026-11", NOTICE, commit=session.commit, dry_run=True, sleep=no_wait)

    assert report.recipients == 3  # the disabled membership is left out
    assert report.sent == 0
    assert ses.sent == []
    async with database() as session:
        assert (await session.scalar(text("SELECT count(*) FROM email_sends"))) == 0


async def test_a_run_reaches_each_account_once_and_a_rerun_sends_nothing(database, ses):
    await _everyone(database)

    async with database() as session:
        first = await notices.broadcast(session, "privacy-2026-11", NOTICE, commit=session.commit, sleep=no_wait)
    async with database() as session:
        again = await notices.broadcast(session, "privacy-2026-11", NOTICE, commit=session.commit, sleep=no_wait)

    assert first.sent == 3
    assert sorted(ses.recipients()) == ["lee@example.com", "rae@example.com", "sam@example.com"]
    assert again.sent == 0
    assert again.already_sent == 3
    assert len(ses.sent) == 3


async def test_a_test_list_replaces_the_accounts(database, ses):
    await _everyone(database)

    async with database() as session:
        report = await notices.broadcast(
            session, "privacy-test", NOTICE, commit=session.commit, to=["me@example.com", "ME@example.com"], sleep=no_wait
        )

    assert report.sent == 1
    assert ses.recipients() == ["me@example.com"]


async def test_a_bounced_or_complaining_account_is_skipped(database, ses):
    await _everyone(database)
    ses.suppressed = [{"EmailAddress": "sam@example.com", "Reason": "BOUNCE"}]

    async with database() as session:
        report = await notices.broadcast(session, "privacy-2026-11", NOTICE, commit=session.commit, sleep=no_wait)

    assert report.suppressed == 1
    assert "sam@example.com" not in ses.recipients()
    assert report.sent == 2


async def test_a_refused_send_is_tried_again_on_the_next_run(database, ses):
    ses.refuse = {"me@example.com"}
    async with database() as session:
        first = await notices.broadcast(session, "privacy-test", NOTICE, commit=session.commit, to=["me@example.com"], sleep=no_wait)
    ses.refuse = set()
    async with database() as session:
        again = await notices.broadcast(session, "privacy-test", NOTICE, commit=session.commit, to=["me@example.com"], sleep=no_wait)

    assert first.failed == 1
    assert again.sent == 1
    assert ses.recipients() == ["me@example.com"]


async def test_sends_are_paced_to_the_rate_limit(database, ses):
    waits = []

    async def sleep(seconds):
        waits.append(seconds)

    async with database() as session:
        await notices.broadcast(session, "c", NOTICE, commit=session.commit, to=["a@example.com", "b@example.com"], rate=4, sleep=sleep)

    assert waits == [0.25, 0.25]


@pytest.mark.parametrize(
    "link",
    ["https://workit-web-gamma.vercel.app/privacy", "http://workitjobs.ai/privacy", "https://workitjobs.ai.evil.com/x"],
)
async def test_a_link_off_workitjobs_ai_is_refused(link):
    with pytest.raises(ValueError):
        notices.notice_html(notices.Notice("Subject", "Body", link, "Open"))


async def test_a_notice_links_only_to_workitjobs_ai():
    body = notices.notice_html(NOTICE)

    assert 'href="https://workitjobs.ai/privacy"' in body
    assert "vercel.app" not in body


# --- the script ---


def test_a_real_run_must_name_its_recipients(tmp_path):
    from app.scripts import send_notice

    body = tmp_path / "notice.txt"
    body.write_text("Hello")
    args = ["--campaign", "c", "--subject", "S", "--body-file", str(body),
            "--link", "https://workitjobs.ai/privacy", "--link-text", "Open"]

    with pytest.raises(SystemExit):
        send_notice.main(args)
    with pytest.raises(SystemExit):
        send_notice.main([*args[:-4], "--link", "https://workit-web-gamma.vercel.app/x", "--link-text", "Open", "--dry-run"])


async def test_the_scripts_dry_run_prints_the_count(database, ses, tmp_path, capsys):
    await _everyone(database)
    body = tmp_path / "notice.txt"
    body.write_text("Hello")
    from app.scripts import send_notice

    await asyncio.to_thread(send_notice.main, [
        "--campaign", "c", "--subject", "S", "--body-file", str(body),
        "--link", "https://workitjobs.ai/privacy", "--link-text", "Open", "--dry-run",
    ])

    out = capsys.readouterr().out
    assert "[dry run] 3 recipients" in out
    assert ses.sent == []


# --- the account-closure email ---


def test_the_closure_notice_names_the_date_and_the_reason():
    import datetime

    notice = notices.closure_notice(datetime.date(2026, 12, 1), "it has been inactive for two years")

    assert notice.subject == "Your WorkIt account will be closed on December 1, 2026"
    body = notices.notice_html(notice)
    assert "December 1, 2026 because it has been inactive for two years" in body
    assert notice.link.startswith("https://workitjobs.ai/")


async def test_a_closure_notice_goes_out_once(database, ses):
    import datetime

    async with database() as session:
        first = await notices.send_closure_notice(session, "Sam@example.com", datetime.date(2026, 12, 1), "inactive", commit=session.commit)
        again = await notices.send_closure_notice(session, "sam@example.com", datetime.date(2026, 12, 1), "inactive", commit=session.commit)

    assert (first, again) == ("sent", "already_sent")
    assert ses.recipients() == ["sam@example.com"]
