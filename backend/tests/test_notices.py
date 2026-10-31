"""
KAN-483's notice emails, against real Postgres and a fake SES: the
broadcast reaches each active account once and a re-run sends nothing new,
a bounced or complaining address is never sent to again, and every link
points at workitjobs.ai. No test reaches AWS.
"""

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
