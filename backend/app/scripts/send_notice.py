"""
Sends one notice email (a policy change, say) to every active WorkIt
account, once (KAN-483; app/services/notices.py). `--campaign` names the
notice in the send log: re-running with the same name sends only to
addresses it has not reached yet. Start with `--dry-run`, which prints the
recipient count, a few addresses and the message, and sends nothing.

    uv run python -m app.scripts.send_notice --campaign privacy-2026-11 \
        --subject "We updated our privacy policy" --body-file notice.txt \
        --link https://workitjobs.ai/privacy --link-text "Read the policy" --dry-run

A real run names its recipients: `--to me@example.com` (repeatable) for a
test list, or `--all-accounts` for everyone. Run it on the EC2 instance
whose IAM role can send (docs/email-sending.md); elsewhere every send
fails and is retried on the next run.
"""

import argparse
import asyncio
import logging
import sys
from pathlib import Path

from app.db import get_sessionmaker
from app.services.notices import Notice, broadcast, check_link, notice_html

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def _masked(address: str) -> str:
    name, _, domain = address.partition("@")
    return f"{name[:1]}***@{domain}"


async def _run(args, notice: Notice):
    async with get_sessionmaker()() as db:
        report = await broadcast(
            db, args.campaign, notice, commit=db.commit, to=args.to, dry_run=args.dry_run, rate=args.rate
        )
        await db.commit()
        return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--campaign", required=True, help="this notice's name in the send log")
    parser.add_argument("--subject", required=True)
    parser.add_argument("--body-file", required=True, type=Path, help="plain text; a blank line starts a paragraph")
    parser.add_argument("--link", required=True, type=check_link, help="https://workitjobs.ai/...")
    parser.add_argument("--link-text", required=True)
    parser.add_argument("--to", action="append", help="send only to this address (repeatable): a test list")
    parser.add_argument("--all-accounts", action="store_true", help="send to every active account")
    parser.add_argument("--rate", type=float, default=1.0, help="sends a second, at most SES's MaxSendRate (default 1)")
    parser.add_argument("--dry-run", action="store_true", help="print the count, a sample and the message; send nothing")
    args = parser.parse_args(argv)

    if args.to and args.all_accounts:
        parser.error("--to and --all-accounts: pick one")
    if not args.dry_run and not args.to and not args.all_accounts:
        parser.error("a real run needs --to (a test list) or --all-accounts")

    notice = Notice(args.subject, args.body_file.read_text(), args.link, args.link_text)
    report = asyncio.run(_run(args, notice))
    if args.dry_run:
        print(f"[dry run] {report.recipients} recipients, e.g. {', '.join(map(_masked, report.sample)) or 'none'}")
        print(f"Subject: {notice.subject}\n{notice_html(notice)}")
    else:
        print(report)
    return 1 if report.failed else 0


if __name__ == "__main__":
    sys.exit(main())
