"""
How long WorkIt keeps each kind of data, and the purge that enforces it
(KAN-482). RETENTION is the one place a period lives: the daily job
(app/scripts/purge_old_data.py, run by .github/workflows/retention-purge.yml)
reads it, and the privacy policy's retention section quotes the same
numbers (KAN-474). Change a period here and in the policy together.

The purge logs and returns how many rows it deleted per table, never their
contents. A table that does not exist yet is skipped, so a rule can be set
before its table ships (fill_events, KAN-476).
"""

import datetime
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class Rule:
    table: str
    # The row's age: a timestamptz column, or a date column (date=True).
    column: str
    days: int
    # Extra SQL condition a row must also meet to be deleted.
    where: str | None = None
    date: bool = False


RETENTION: tuple[Rule, ...] = (
    # Fix reports, with or without an account (those sent before KAN-369
    # named no one): 1 year.
    Rule("fill_reports", "created_at", 365),
    # AI usage counters only enforce daily limits: 30 days.
    Rule("ai_usage_counters", "day", 30, date=True),
    # Notifications the student has read: 90 days. Unread ones stay.
    Rule("notifications", "created_at", 90, where="read_at IS NOT NULL"),
    # Fill events (KAN-476's fill numbers): 90 days. Skipped until the
    # table exists; KAN-476 makes sure it has a created_at timestamptz.
    Rule("fill_events", "created_at", 90),
    # The extension's per-account daily write counts (KAN-478) only enforce
    # daily caps, as the AI counters do: 30 days.
    Rule("daily_counts", "day", 30, date=True),
    # Uninstall survey answers (KAN-471), which name no account: 1 year.
    Rule("uninstall_answers", "created_at", 365),
    # The notice send log (KAN-483), an address per campaign with no account
    # link: 1 year, past any campaign's re-run. email_suppressions has no
    # rule on purpose: SES compliance means a bounced or complaining address
    # is never mailed again, so it is kept (docs/email-sending.md).
    Rule("email_sends", "sent_at", 365),
)


def _condition(rule: Rule) -> str:
    condition = f"{rule.column} < :cutoff"
    if rule.where:
        condition += f" AND ({rule.where})"
    return condition


def _cutoff(rule: Rule, now: datetime.datetime) -> datetime.datetime | datetime.date:
    cutoff = now - datetime.timedelta(days=rule.days)
    return cutoff.date() if rule.date else cutoff


async def purge(
    db: AsyncSession, *, now: datetime.datetime | None = None, dry_run: bool = False
) -> dict[str, int | None]:
    """Delete every row past its period and flush; the caller commits. Returns the count per
    table (None for a table that does not exist). A dry run counts the rows
    it would delete and deletes nothing."""
    now = now or datetime.datetime.now(datetime.UTC)
    counts: dict[str, int | None] = {}
    for rule in RETENTION:
        exists = await db.scalar(text("SELECT to_regclass(:t) IS NOT NULL"), {"t": rule.table})
        if not exists:
            counts[rule.table] = None
            continue
        params = {"cutoff": _cutoff(rule, now)}
        if dry_run:
            sql = f"SELECT count(*) FROM {rule.table} WHERE {_condition(rule)}"
            counts[rule.table] = await db.scalar(text(sql), params)
        else:
            sql = f"DELETE FROM {rule.table} WHERE {_condition(rule)}"
            counts[rule.table] = (await db.execute(text(sql), params)).rowcount
    await db.flush()
    return counts
