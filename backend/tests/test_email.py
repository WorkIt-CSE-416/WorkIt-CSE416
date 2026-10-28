"""send_email's one contract (KAN-298): returns True once SES accepts the
send, False on any failure, and never raises -- job_alerts.py relies on
this to still write the bell notification when the email didn't go out."""

import pytest
from botocore.exceptions import ClientError, NoCredentialsError

from app.services import email

pytestmark = pytest.mark.anyio


class FakeSesClient:
    def __init__(self, *, error=None):
        self.error = error
        self.calls = []

    def send_email(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return {"MessageId": "fake"}


async def test_a_successful_send_returns_true(monkeypatch):
    client = FakeSesClient()
    monkeypatch.setattr(email, "_client", lambda: client)

    assert await email.send_email("sam@example.com", "Subject", "<p>hi</p>") is True
    assert client.calls[0]["Destination"] == {"ToAddresses": ["sam@example.com"]}


async def test_an_api_rejection_returns_false_and_does_not_raise(monkeypatch):
    rejection = ClientError({"Error": {"Code": "MessageRejected", "Message": "Email address not verified"}}, "SendEmail")
    monkeypatch.setattr(email, "_client", lambda: FakeSesClient(error=rejection))

    assert await email.send_email("unverified@example.com", "Subject", "<p>hi</p>") is False


async def test_no_iam_role_returns_false_and_does_not_raise(monkeypatch):
    monkeypatch.setattr(email, "_client", lambda: FakeSesClient(error=NoCredentialsError()))

    assert await email.send_email("sam@example.com", "Subject", "<p>hi</p>") is False
