"""
Fix report alerts (KAN-478): an email to WorkIt's admins when a new report
group arrives, at most once an hour. A group is a signature
(schemas/fill_reports.py's signature_of); it is new while no alert has
named any of its reports (fill_reports.alerted_at). Run hourly by
app/scripts/send_fill_report_alerts.py.

The admins are the emails on WORKIT_ADMINS (an account id there names no
inbox). Mail goes through services/email.py's SES sender, which needs the
sending machine's IAM role; while SES is in its sandbox it reaches only the
addresses SES has verified. When no admin's send is accepted, nothing is
stamped, so the next run tries again. Every link passes the notices'
check_link (https on workitjobs.ai), or nothing is sent. It flushes the stamps and never
commits: the script does.
"""

import datetime
import html
from urllib.parse import quote

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.fill_reports import Fill_Report
from app.services.email import send_email
from app.services.notices import check_link

QUIET = datetime.timedelta(hours=1)


def admin_emails() -> list[str]:
    """The emails on WORKIT_ADMINS, lower-cased, in order."""
    entries = (entry.strip().lower() for entry in get_settings().workit_admins.split(","))
    return [entry for entry in entries if "@" in entry]


def _email(groups: list) -> tuple[str, str]:
    base = get_settings().web_url.rstrip("/")
    noun = "group" if len(groups) == 1 else "groups"
    items = []
    for g in groups:
        _, kind, error = g.signature.split(":")
        what = " · ".join(html.escape(part) for part in (g.job_system, kind or "no field", error or "no error"))
        reports = "1 report" if g.count == 1 else f"{g.count} reports"
        link = check_link(f"{base}/admin/fill-reports?signature={quote(g.signature, safe='')}")
        items.append(f'<li><a href="{html.escape(link)}">{what}</a>: {reports}</li>')
    body = (
        f"<p>Students sent fix reports in {len(groups)} new {noun}:</p><ul>{''.join(items)}</ul>"
        f'<p><a href="{html.escape(check_link(base + "/admin/fill-reports"))}">All fill reports</a></p>'
    )
    return f"WorkIt: {len(groups)} new fix report {noun}", body


async def alert_new_groups(db: AsyncSession, *, now: datetime.datetime | None = None, dry_run: bool = False) -> int:
    """Emails the admins the new groups and stamps their reports; how many groups it named (0 within an hour of the last alert)."""
    now = now or datetime.datetime.now(datetime.UTC)
    admins = admin_emails()
    if not admins:
        return 0
    last = await db.scalar(select(func.max(Fill_Report.alerted_at)))
    if last is not None and now - last < QUIET:
        return 0
    groups = (await db.execute(
        select(Fill_Report.signature, func.min(Fill_Report.job_system).label("job_system"), func.count().label("count"))
        .where(Fill_Report.created_at <= now)
        .group_by(Fill_Report.signature)
        .having(func.bool_and(Fill_Report.alerted_at.is_(None)))
        .order_by(func.count().desc(), Fill_Report.signature)
    )).all()
    if not groups or dry_run:
        return len(groups)
    subject, body = _email(groups)
    accepted = [await send_email(to, subject, body) for to in admins]
    if not any(accepted):
        return 0
    await db.execute(
        update(Fill_Report)
        .where(Fill_Report.signature.in_([g.signature for g in groups]), Fill_Report.alerted_at.is_(None), Fill_Report.created_at <= now)
        .values(alerted_at=now)
    )
    await db.flush()
    return len(groups)
