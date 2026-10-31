"""
Sends KAN-298's daily job-match digest to every applicant who opted in
(Settings), as a bell notification and an email, from one computed list
per applicant (app/services/job_alerts.py). Run by .github/workflows/
job-alerts.yml, daily; `--dry-run` builds and reports every digest without
writing a notification or sending anything.

    uv run python -m app.scripts.send_job_alerts
    uv run python -m app.scripts.send_job_alerts --dry-run

One applicant's failure (an empty bank, a model/embedding hiccup, a bounced
email) never stops the run for everyone else -- each is caught, counted,
and logged; a broken account is tomorrow's problem, not today's run.

Before sending, a real run copies SES's suppression list into
email_suppressions (notices.sync_suppressions, KAN-483), so an address that
bounced since the last broadcast gets no email today. A list SES can't give
is logged, and the run sends with the suppressions it already has.
"""

import argparse
import asyncio
import logging
import sys

from sqlalchemy import select

from app.db import get_sessionmaker
from app.models.profiles import Applicant_Profile
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.services.job_alerts import EmptyBank, build_digest, send_job_alert
from app.services.notices import sync_suppressions

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


class Report:
    def __init__(self) -> None:
        self.checked = 0
        self.sent = 0
        self.empty_bank = 0
        self.no_matches = 0
        self.failed = 0

    def __str__(self) -> str:
        return (
            f"checked {self.checked} opted-in applicants: "
            f"{self.sent} digests sent, {self.empty_bank} empty banks skipped, "
            f"{self.no_matches} with no new matches, {self.failed} failed"
        )


def _account_of(profile: Applicant_Profile) -> AuthenticatedAccount:
    return AuthenticatedAccount(
        id=profile.id,
        email=profile.email,
        full_name=profile.full_name,
        account_type=AccountType.APPLICANT,
        onboarding_completed=True,
    )


async def _run(*, dry_run: bool) -> Report:
    report = Report()
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        if not dry_run:
            try:
                await sync_suppressions(db)
                await db.commit()
            except Exception:
                logger.exception("could not refresh the suppression list; sending with the stored one")
                await db.rollback()
        profiles = (
            await db.scalars(
                select(Applicant_Profile).where(Applicant_Profile.job_alerts_enabled)
            )
        ).all()

        for profile in profiles:
            report.checked += 1
            account = _account_of(profile)
            try:
                if dry_run:
                    jobs = await build_digest(db, account)
                    if jobs:
                        report.sent += 1
                    else:
                        report.no_matches += 1
                    continue

                sent = await send_job_alert(db, account)
                if sent:
                    report.sent += 1
                else:
                    report.no_matches += 1
            except EmptyBank:
                report.empty_bank += 1
            except Exception:
                logger.exception("job alert failed for applicant %s", profile.id)
                report.failed += 1
                await db.rollback()

    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="build and report every digest; write and send nothing")
    args = parser.parse_args(argv)

    report = asyncio.run(_run(dry_run=args.dry_run))
    print(("[dry run] " if args.dry_run else "") + str(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
