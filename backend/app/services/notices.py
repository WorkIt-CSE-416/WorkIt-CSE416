"""
WorkIt's notice emails (KAN-483): a one-off notice to every active
account (a policy change, say), the account-closure email, and the
bounce/complaint suppression both respect. Sends go through
app/services/email.py's send_email, one address per message.

- **Suppression.** SES adds an address to the account's suppression list
  when it hard-bounces or complains (once account-level suppression is on,
  docs/email-sending.md). `sync_suppressions` copies that list into
  `email_suppressions`; nothing here or in the job alert sends to one.
- **The send log.** `send_once` writes `email_sends` (campaign, address)
  before it sends and removes the row if SES refuses, so a re-run of the
  same campaign skips everyone it already reached. A run killed between
  the write and the send leaves that one address marked sent: missing one
  email beats sending it twice.

The callers are app/scripts/send_notice.py and
app/scripts/send_closure_notice.py.
"""

import logging
from functools import lru_cache

import boto3
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.email_log import Email_Suppression

logger = logging.getLogger(__name__)


@lru_cache
def _suppression_client():
    """SES v2: the suppression list has no v1 API."""
    return boto3.client("sesv2", region_name=get_settings().aws_region)


def _normal(address: str) -> str:
    return address.strip().lower()


async def sync_suppressions(db: AsyncSession) -> int:
    """Copies SES's suppression list into email_suppressions. Returns how
    many addresses were new."""
    client = _suppression_client()
    added = 0
    token = None
    while True:
        page = client.list_suppressed_destinations(**({"NextToken": token} if token else {}))
        for summary in page.get("SuppressedDestinationSummaries", []):
            result = await db.execute(
                insert(Email_Suppression)
                .values(email=_normal(summary["EmailAddress"]), reason=summary["Reason"])
                .on_conflict_do_nothing(index_elements=["email"])
            )
            added += result.rowcount
        token = page.get("NextToken")
        if not token:
            break
    await db.commit()
    return added


async def is_suppressed(db: AsyncSession, address: str) -> bool:
    return (await db.get(Email_Suppression, _normal(address))) is not None
