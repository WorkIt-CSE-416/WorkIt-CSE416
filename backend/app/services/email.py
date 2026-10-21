"""
Sends one transactional email. The one place that knows which provider —
Resend's HTTP API today — so swapping to another (SendGrid, Postmark, SES)
later means changing this file's body, never a caller. KAN-298's daily job
alert is the first and only caller.

No queue, no retry, no template engine: one HTTP POST, one best-effort
result. A failed send never raises — app/services/job_alerts.py still
writes the bell notification even when the email didn't go out, the same
principle backend/app/routers/auth.py's _send_confirmation_email already
follows for a transient mail failure.
"""

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_RESEND_URL = "https://api.resend.com/emails"
_FROM = "WorkIt <alerts@workit.app>"
_TIMEOUT_SECONDS = 10


async def send_email(to: str, subject: str, html: str) -> bool:
    """True once Resend accepts the send. False (logged, never raised) with
    no RESEND_API_KEY set, or on any HTTP failure."""
    settings = get_settings()
    if not settings.resend_api_key:
        logger.warning("send_email: RESEND_API_KEY is not set, skipping send to %s", to)
        return False

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.post(
                _RESEND_URL,
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={"from": _FROM, "to": [to], "subject": subject, "html": html},
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.warning("send_email to %s failed: HTTP %s", to, exc.response.status_code)
        return False
    except httpx.HTTPError as exc:
        logger.warning("send_email to %s failed: %s", to, exc)
        return False

    return True
