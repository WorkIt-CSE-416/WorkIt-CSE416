"""
Emails WorkIt's admins (the emails on WORKIT_ADMINS) the fix report groups
that are new since the last alert, at most once an hour
(app/services/fill_report_alerts.py, KAN-478). Run hourly from the same EC2
crontab as the job alerts, whose IAM role lets services/email.py send
through SES; `--dry-run` counts the new groups and sends and stamps nothing.

    uv run python -m app.scripts.send_fill_report_alerts
    uv run python -m app.scripts.send_fill_report_alerts --dry-run
"""

import argparse
import asyncio
import logging
import sys

from app.db import get_sessionmaker
from app.services.fill_report_alerts import admin_emails, alert_new_groups

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


async def _run(*, dry_run: bool) -> int:
    async with get_sessionmaker()() as db:
        groups = await alert_new_groups(db, dry_run=dry_run)
        await db.commit()
        return groups


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="count the new groups; send and stamp nothing")
    args = parser.parse_args(argv)
    groups = asyncio.run(_run(dry_run=args.dry_run))
    print(f"{'[dry run] ' if args.dry_run else ''}{groups} new fix report groups for {len(admin_emails())} admin emails")
    return 0


if __name__ == "__main__":
    sys.exit(main())
