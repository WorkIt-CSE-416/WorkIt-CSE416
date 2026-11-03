"""
Emails one account that it will be closed (KAN-483): "your account will be
closed on <date> because <reason>" (app/services/notices.py's
closure_notice, the one template). Sent once per address and closing date;
a re-run sends nothing. `--dry-run` prints the message and sends nothing.

    uv run python -m app.scripts.send_closure_notice --email sam@example.com \
        --date 2026-12-01 --reason "it has been inactive for two years" --dry-run
"""

import argparse
import asyncio
import datetime
import sys

from app.db import get_sessionmaker
from app.services.notices import closure_notice, notice_html, send_closure_notice


async def _send(args) -> str:
    async with get_sessionmaker()() as db:
        outcome = await send_closure_notice(db, args.email, args.date, args.reason, commit=db.commit)
        await db.commit()
        return outcome


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", required=True)
    parser.add_argument("--date", required=True, type=datetime.date.fromisoformat, help="closing date, YYYY-MM-DD")
    parser.add_argument("--reason", required=True, help='reads after "because"')
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    if args.dry_run:
        notice = closure_notice(args.date, args.reason)
        print(f"[dry run] To: {args.email}\nSubject: {notice.subject}\n{notice_html(notice)}")
        return 0
    outcome = asyncio.run(_send(args))
    print(outcome)
    return 0 if outcome in ("sent", "already_sent") else 1


if __name__ == "__main__":
    sys.exit(main())
