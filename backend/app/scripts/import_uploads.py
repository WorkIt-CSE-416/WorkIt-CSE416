"""
Fill the experience bank from resumes uploaded before an upload did it
itself (KAN-240, ADR 0003).

    uv run python -m app.scripts.import_uploads --dry-run   do it all, then roll back
    uv run python -m app.scripts.import_uploads

Only a student whose bank is empty (no entries, no skills) is filled. A
student with anything in the bank already imported or typed their facts,
and a merge would add the resume's original wording beside bullets they
reworded. Each such student's uploads are read with the heuristic parser,
newest first, so the newest resume's fields win and an older one adds only
what the newer lacks. The model never runs: it would spend the students'
daily uses.

One transaction for the whole run. A second run fills nothing, since every
bank it filled is no longer empty.

Claude never runs it against a shared database (backend/CLAUDE.md, the
same rule as the feed import): the user runs it, --dry-run first.
"""

import argparse
import asyncio
import sys
import uuid
from dataclasses import dataclass

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_engine, get_sessionmaker
from app.models.bank import Bank_Entry, Bank_Skill
from app.models.resume import Resume
from app.services import bank, bank_import


@dataclass
class Report:
    students: int = 0
    resumes: int = 0
    entries_added: int = 0
    skills_added: int = 0


async def backfill(session: AsyncSession) -> Report:
    """Merge every upload of each student with an empty bank. Flushes, never
    commits."""
    empty_bank = ~exists().where(Bank_Entry.applicant_id == Resume.applicant_id) & ~exists().where(
        Bank_Skill.applicant_id == Resume.applicant_id
    )
    rows = (
        await session.execute(
            select(Resume.applicant_id, Resume.raw_text)
            .where(Resume.raw_text.is_not(None), empty_bank)
            .order_by(Resume.applicant_id, Resume.created_at.desc())
        )
    ).all()
    report = Report()
    seen: set[uuid.UUID] = set()
    for applicant_id, raw_text in rows:
        entries, skills = bank_import.read(raw_text)
        merged = await bank.merge_import(session, applicant_id, entries, skills)
        seen.add(applicant_id)
        report.resumes += 1
        report.entries_added += merged.entries_added
        report.skills_added += merged.skills_added
    report.students = len(seen)
    return report


async def _run(*, dry_run: bool) -> Report:
    engine = get_engine()
    try:
        async with get_sessionmaker()() as session:
            report = await backfill(session)
            if dry_run:
                await session.rollback()
            else:
                await session.commit()
            return report
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="run every step, then roll back")
    args = parser.parse_args(argv)
    report = asyncio.run(_run(dry_run=args.dry_run))
    print(
        f"{'DRY RUN, rolled back — ' if args.dry_run else ''}"
        f"{report.resumes} uploads from {report.students} students with an empty bank: "
        f"{report.entries_added} entries and {report.skills_added} skills added"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
