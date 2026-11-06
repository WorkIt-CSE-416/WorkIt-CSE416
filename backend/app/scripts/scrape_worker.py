"""CLI entry for the backend-owned scraper worker.

Usage:
    uv run python -m app.scripts.scrape_worker              # one cycle
    uv run python -m app.scripts.scrape_worker --dry-run    # show what would happen
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys

from app.db import get_engine
from app.scraper.worker import run_cycle

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)


async def main(*, dry_run: bool = False) -> None:
    engine = get_engine()
    async with engine.connect() as conn:
        summary = await run_cycle(conn, dry_run=dry_run)
    await engine.dispose()
    print(json.dumps(summary, indent=2))
    if summary.get("boards_failed"):
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run one scraper worker cycle")
    parser.add_argument(
        "--dry-run", action="store_true", help="Show what would happen without scraping"
    )
    args = parser.parse_args()
    asyncio.run(main(dry_run=args.dry_run))
