"""
KAN-298's daily digest: one applicant's best new matches, as one bell
notification and one email, from one computed list -- never scored twice.
Reuses auto apply's own matching and batch-picking rather than a second
implementation (auto-apply/architecture.md, "Match (built)" and "The
batch"): `fetch_recommended` scores every listed job against the
experience bank, `pick_batch` takes the best `BATCH_SIZE` keeping one
posting per company+title. Unlike auto apply's own batch, this never
restricts to Greenhouse: a digest links to WorkIt's own job page, never
`apply_url`, so it needs no ATS-specific knowledge at all.

The one caller is app/scripts/send_job_alerts.py.
"""

import logging
import sys

from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply.pipeline import BATCH_SIZE, MIN_MATCH
from app.auto_apply.rules import pick_batch
from app.config import get_settings
from app.models.notification import Notification
from app.queries.jobs.filters import JobFilters
from app.routers.jobs import EmptyBank, fetch_recommended
from app.schemas.auth import AuthenticatedAccount
from app.schemas.jobs import ScoredJob
from app.services.email import send_email
from app.services.notices import is_suppressed

logger = logging.getLogger(__name__)


async def build_digest(db: AsyncSession, account: AuthenticatedAccount) -> list[ScoredJob]:
    """This applicant's best new matches, best first, up to BATCH_SIZE, one
    per company+title. Raises EmptyBank for an account with nothing to
    score against -- the caller skips it, the same way every other
    fetch_recommended caller does."""
    scored = await fetch_recommended(
        db,
        account,
        # Every job with an application at any stage stays out, the same
        # rule auto apply's own batch follows: a digest that kept nagging
        # about a job the student already applied to, skipped or even just
        # saved would train them to ignore it.
        filters=JobFilters(no_application_by=account.id),
        min_match=MIN_MATCH,
        # Every match, not a page: pick_batch drops repeats before it takes
        # BATCH_SIZE, same reasoning auto_apply/pipeline.py's own _matches
        # uses this exact limit for.
        limit=sys.maxsize,
    )
    return pick_batch(scored, BATCH_SIZE)


def _job_row_html(job: ScoredJob, web_url: str) -> str:
    link = f"{web_url}/jobs/{job.id}"
    return f"""
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #e5e1f5">
        <a href="{link}" style="font-size:16px;font-weight:600;color:#1a1625;text-decoration:none">{job.title}</a>
        <div style="font-size:14px;color:#6b6478;margin-top:2px">{job.company} &middot; {job.match}% match</div>
      </td>
    </tr>"""


def _digest_html(jobs: list[ScoredJob], web_url: str) -> str:
    rows = "".join(_job_row_html(job, web_url) for job in jobs)
    return f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h1 style="font-size:20px;color:#1a1625">Your {len(jobs)} Best Matches Today</h1>
      <p style="font-size:14px;color:#6b6478">New postings scored against your experience bank.</p>
      <table style="width:100%;border-collapse:collapse">{rows}</table>
      <p style="margin-top:24px">
        <a href="{web_url}/jobs" style="font-size:14px;color:#6b4ee6">See all jobs on WorkIt &rarr;</a>
      </p>
      <p style="font-size:12px;color:#9890a3;margin-top:32px">
        Turn these off any time in <a href="{web_url}/settings" style="color:#9890a3">Settings</a>.
      </p>
    </div>"""


async def send_job_alert(db: AsyncSession, account: AuthenticatedAccount) -> bool:
    """Builds the digest and, when it isn't empty, writes one Notification
    row and sends one email from it. Returns whether anything went out --
    an empty digest (zero new matches above MIN_MATCH) sends and writes
    nothing, so the bell never shows a hollow "0 matches today"."""
    jobs = await build_digest(db, account)
    if not jobs:
        return False

    web_url = get_settings().web_url.rstrip("/")
    db.add(
        Notification(
            applicant_id=account.id,
            type="job_alert",
            title=f"Your {len(jobs)} Best Matches Today",
            body=f"{jobs[0].title} at {jobs[0].company} ({jobs[0].match}% match), and {len(jobs) - 1} more."
            if len(jobs) > 1
            else f"{jobs[0].title} at {jobs[0].company} ({jobs[0].match}% match).",
            data=[
                {"job_id": job.id, "title": job.title, "company": job.company, "match": job.match}
                for job in jobs
            ],
        )
    )
    await db.commit()

    if await is_suppressed(db, account.email):
        # Bounced or complained before (app/services/notices.py): the bell
        # still shows the digest, but no email goes out.
        return True
    sent = await send_email(
        account.email, f"Your {len(jobs)} best job matches today", _digest_html(jobs, web_url)
    )
    if not sent:
        logger.warning("job alert email failed for %s; the bell notification was still written", account.id)
    return True


__all__ = ["EmptyBank", "build_digest", "send_job_alert"]
