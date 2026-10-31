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

import asyncio
import datetime
import html
import logging
from dataclasses import dataclass, field
from functools import lru_cache
from urllib.parse import urlsplit

import boto3
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.dto import profile_status
from app.models.email_log import Email_Send, Email_Suppression
from app.models.profiles import Applicant_Profile, Company_Membership
from app.services import email

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


@dataclass(frozen=True)
class Notice:
    subject: str
    # Plain text; a blank line starts a new paragraph.
    body: str
    link: str
    link_text: str


def check_link(link: str) -> str:
    """Every link in a notice is https on workitjobs.ai or a subdomain of
    it, never the old Vercel host. Raises ValueError otherwise."""
    parts = urlsplit(link)
    host = parts.hostname or ""
    if parts.scheme != "https" or not (host == "workitjobs.ai" or host.endswith(".workitjobs.ai")):
        raise ValueError(f"notice links must be https://workitjobs.ai, not {link!r}")
    return link


def notice_html(notice: Notice) -> str:
    check_link(notice.link)
    paragraphs = "".join(
        f'<p style="font-size:15px;color:#1a1625;line-height:1.5">{html.escape(part.strip())}</p>'
        for part in notice.body.split("\n\n")
        if part.strip()
    )
    return f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h1 style="font-size:20px;color:#1a1625">{html.escape(notice.subject)}</h1>
      {paragraphs}
      <p style="margin-top:24px">
        <a href="{html.escape(notice.link)}" style="font-size:15px;color:#6b4ee6">{html.escape(notice.link_text)} &rarr;</a>
      </p>
      <p style="font-size:12px;color:#9890a3;margin-top:32px">
        You're getting this because you have a WorkIt account. It's a notice about
        your account, not marketing.
      </p>
    </div>"""


async def active_recipients(db: AsyncSession) -> list[str]:
    """Every active account's sign-in address, lowercased, once each:
    every applicant and every company member whose status is active."""
    applicants = await db.scalars(select(Applicant_Profile.email))
    members = await db.scalars(
        select(Company_Membership.email).where(Company_Membership.status == profile_status.active)
    )
    return sorted({_normal(address) for address in [*applicants, *members] if address})


async def send_once(db: AsyncSession, campaign: str, address: str, subject: str, body_html: str) -> str:
    """Sends one campaign's email to one address at most once. Returns
    "sent", "already_sent", "suppressed" or "failed" (SES refused it; not
    logged, so a re-run tries it again)."""
    address = _normal(address)
    if await is_suppressed(db, address):
        return "suppressed"
    claimed = await db.execute(
        insert(Email_Send)
        .values(campaign=campaign, email=address)
        .on_conflict_do_nothing(constraint="email_sends_campaign_email_key")
    )
    await db.commit()
    if not claimed.rowcount:
        return "already_sent"
    if await email.send_email(address, subject, body_html):
        return "sent"
    await db.execute(delete(Email_Send).where(Email_Send.campaign == campaign, Email_Send.email == address))
    await db.commit()
    return "failed"


@dataclass
class Report:
    recipients: int = 0
    sent: int = 0
    already_sent: int = 0
    suppressed: int = 0
    failed: int = 0
    sample: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        return (
            f"{self.recipients} recipients: {self.sent} sent, {self.already_sent} already sent, "
            f"{self.suppressed} suppressed, {self.failed} failed"
        )


async def broadcast(
    db: AsyncSession,
    campaign: str,
    notice: Notice,
    *,
    to: list[str] | None = None,
    dry_run: bool = False,
    rate: float = 1.0,
    sleep=asyncio.sleep,
) -> Report:
    """Sends `notice` once to every active account, or only to `to` (a
    test list) when given. `campaign` names this notice in the send log:
    re-running with the same name reaches only the addresses it missed.
    At most `rate` sends a second (SES's MaxSendRate: 1 in the sandbox).
    A dry run counts and samples the recipients and sends nothing."""
    body_html = notice_html(notice)
    recipients = sorted({_normal(a) for a in to}) if to is not None else await active_recipients(db)
    report = Report(recipients=len(recipients), sample=recipients[:3])
    if dry_run:
        return report

    await sync_suppressions(db)
    for address in recipients:
        outcome = await send_once(db, campaign, address, notice.subject, body_html)
        setattr(report, outcome, getattr(report, outcome) + 1)
        if outcome in ("sent", "failed"):
            await sleep(1 / rate)
    return report


def closure_notice(close_on: datetime.date, reason: str) -> Notice:
    """The one account-closure email: "your account will be closed on
    <date> because <reason>". `reason` reads after "because"."""
    day = f"{close_on:%B} {close_on.day}, {close_on.year}"
    return Notice(
        subject=f"Your WorkIt account will be closed on {day}",
        body=(
            f"Your WorkIt account will be closed on {day} because {reason.strip().rstrip('.')}.\n\n"
            "Until then you can sign in as usual, save anything you want to keep, "
            "or delete the account yourself in Settings. After that date your account "
            "and its data are deleted."
        ),
        link=f"{get_settings().web_url.rstrip('/')}/settings",
        link_text="Open Settings",
    )


async def send_closure_notice(db: AsyncSession, address: str, close_on: datetime.date, reason: str) -> str:
    """Sends the closure email for one account, once per closing date.
    Returns send_once's outcome."""
    notice = closure_notice(close_on, reason)
    await sync_suppressions(db)
    return await send_once(db, f"closure-{close_on.isoformat()}", address, notice.subject, notice_html(notice))
