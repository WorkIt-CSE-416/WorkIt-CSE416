"""
Sends one transactional email. The one place that knows which provider —
AWS SES today — so swapping to another (Resend, SendGrid, Postmark) later
means changing this file's body, never a caller. KAN-298's daily job
alert is the first and only caller.

Credentials come from the sending machine's IAM instance role, never an
env var: nothing here is a stored secret to rotate. No queue, no retry,
no template engine: one SES call, one best-effort result. A failed send
never raises — app/services/job_alerts.py still writes the bell
notification even when the email didn't go out.
"""

import asyncio
import logging
from functools import lru_cache

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.config import get_settings

logger = logging.getLogger(__name__)


@lru_cache
def _client():
    """One SES client per process. Safe to share: the one real caller,
    app/scripts/send_job_alerts.py, sends strictly sequentially."""
    return boto3.client("ses", region_name=get_settings().aws_region)


async def send_email(to: str, subject: str, html: str) -> bool:
    """True once SES accepts the send. False (logged, never raised) with
    no IAM role attached (BotoCoreError, e.g. local dev or GitHub Actions),
    or on an API-level rejection (ClientError, e.g. an unverified recipient
    while the SES account is still in its sandbox)."""
    settings = get_settings()
    try:
        await asyncio.to_thread(
            _client().send_email,
            Source=settings.ses_from_email,
            Destination={"ToAddresses": [to]},
            Message={"Subject": {"Data": subject}, "Body": {"Html": {"Data": html}}},
        )
    except (ClientError, BotoCoreError) as exc:
        logger.warning("send_email to %s failed: %s", to, exc)
        return False

    return True
