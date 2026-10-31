"""
Deletes data past its retention period (KAN-482): the periods and tables
are app/services/retention.py's RETENTION. Run daily by
.github/workflows/retention-purge.yml. Logs how many rows it deleted per
table, never their contents. `--dry-run` counts what it would delete and
deletes nothing.

    uv run python -m app.scripts.purge_old_data --dry-run
    uv run python -m app.scripts.purge_old_data
"""

import argparse
import asyncio
import datetime
import logging
import sys

from app.db import get_sessionmaker
from app.services.retention import purge

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


async def run(*, dry_run: bool, now: datetime.datetime | None = None) -> dict[str, int | None]:
    async with get_sessionmaker()() as db:
        counts = await purge(db, now=now, dry_run=dry_run)
    prefix = "[dry run] " if dry_run else ""
    verb = "would be deleted" if dry_run else "deleted"
    for table, count in counts.items():
        if count is None:
            logger.info("%s%s: skipped, no such table", prefix, table)
        else:
            logger.info("%s%s: %d %s", prefix, table, count, verb)
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="count what would be deleted; delete nothing")
    args = parser.parse_args(argv)
    asyncio.run(run(dry_run=args.dry_run))
    return 0


if __name__ == "__main__":
    sys.exit(main())
