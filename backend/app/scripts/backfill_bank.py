"""
Fill each applicant's Experience Bank from the resume they already have
(KAN-176). Run once, after the migration that creates the bank:

    uv run python -m app.scripts.backfill_bank --dry-run    do it all, then roll back
    uv run python -m app.scripts.backfill_bank

An applicant whose bank has any entry is skipped, so a second run, or one
after people have started using the builder, adds nothing twice. The resume
read is the one Scout reads: the primary if it parsed, else the newest that
did. Like import_jobs, it writes to whatever DATABASE_URL names, so Claude
never runs it against a shared database.
"""

import argparse
import asyncio
import sys

from pydantic import ValidationError
from sqlalchemy import exists, select

from app.db import get_sessionmaker
from app.models.dto import ParsedResume
from app.models.experience import ExperienceEntry
from app.models.profiles import Applicant_Profile
from app.models.resume import Resume
from app.routers.experience import import_into_bank


async def _run(*, dry_run: bool) -> tuple[int, int, int]:
    filled = entries = skipped = 0
    async with get_sessionmaker()() as db:
        applicants = (await db.execute(
            select(Applicant_Profile.id, Applicant_Profile.default_resume_id).where(
                ~exists().where(ExperienceEntry.applicant_id == Applicant_Profile.id))
        )).all()
        for applicant_id, default_id in applicants:
            parsed_json = await db.scalar(
                select(Resume.parsed_json)
                .where(Resume.applicant_id == applicant_id, Resume.parsed_json.is_not(None))
                .order_by((Resume.id == default_id).desc(), Resume.created_at.desc())
                .limit(1))
            if not parsed_json:
                continue
            try:
                parsed = ParsedResume.model_validate(parsed_json)
            except ValidationError:
                skipped += 1
                continue
            result = await import_into_bank(db, applicant_id, parsed)
            filled += 1
            entries += result.added_entries
        if dry_run:
            await db.rollback()
        else:
            await db.commit()
    return filled, entries, skipped


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="do it all, then roll back")
    args = parser.parse_args(argv)
    filled, entries, skipped = asyncio.run(_run(dry_run=args.dry_run))
    prefix = "DRY RUN, rolled back — " if args.dry_run else ""
    print(f"{prefix}{filled} banks filled with {entries} entries; {skipped} resumes unreadable")
    return 0


if __name__ == "__main__":
    sys.exit(main())
