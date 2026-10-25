"""
Clean what an older resume reading left in the bank, before the parser split
a "| C++, Go" tool list off a title (utils/CLAUDE.md, "A role's tools"):

    uv run python -m app.scripts.clean_bank_reading            # dry run: prints, writes nothing
    uv run python -m app.scripts.clean_bank_reading --apply    # writes
    uv run python -m app.scripts.clean_bank_reading --applicant <id> [--apply]

For every experience, leadership or project entry whose title ends in a tool
list after a bar, the title keeps only what comes before it, and the tools
the same owner (the upload, or the student's own) lacks become its
ungrouped skills, as a fresh import does now. A skill that is not one
(`bank_import.not_a_skill`) is removed; one with a bar ("Club| C++") is
renamed to what follows the last bar when that is a skill the owner lacks.
Only skills read from an upload are checked: a skill the student typed
(no resume_id) is theirs and is never renamed or removed.

Running it again changes nothing. It refuses a database that is not on this
computer. It prints counts and the changes it makes.
"""

import argparse
import asyncio
import sys
import uuid
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_sessionmaker
from app.models.bank import Bank_Entry, Bank_Skill
from app.models.dto import bank_section
from app.services.bank import clear_embedding
from app.services.bank_import import not_a_skill, skill_pairs
from app.utils.resume_parser import split_tools

SECTIONS = (bank_section.experience, bank_section.leadership, bank_section.projects)


@dataclass
class Report:
    titles: list[tuple[str, str]] = field(default_factory=list)  # (before, after)
    added: list[str] = field(default_factory=list)
    renamed: list[tuple[str, str]] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    applicants: set[uuid.UUID] = field(default_factory=set)


async def clean(session: AsyncSession, applicant_id: uuid.UUID | None = None) -> Report:
    report = Report()
    entries = select(Bank_Entry).where(Bank_Entry.section.in_(SECTIONS))
    skills = select(Bank_Skill)
    if applicant_id is not None:
        entries = entries.where(Bank_Entry.applicant_id == applicant_id)
        skills = skills.where(Bank_Skill.applicant_id == applicant_id)
    all_skills = list(await session.scalars(skills.order_by(Bank_Skill.created_at)))
    # the names each owner holds, ignoring case
    held: dict[tuple, set[str]] = {}
    for skill in all_skills:
        if skill.resume_id is None or not not_a_skill(skill.name):
            held.setdefault((skill.applicant_id, skill.resume_id), set()).add(skill.name.lower())

    for skill in all_skills:
        if skill.resume_id is None or not not_a_skill(skill.name):
            continue
        names = held.setdefault((skill.applicant_id, skill.resume_id), set())
        tail = skill.name.rpartition("|")[2].strip()
        if "|" in skill.name and skill_pairs([(tail, None)]) and tail.lower() not in names:
            report.renamed.append((skill.name, tail))
            skill.name = tail
            names.add(tail.lower())
        else:
            report.removed.append(skill.name)
            await session.delete(skill)
        report.applicants.add(skill.applicant_id)

    for entry in await session.scalars(entries.order_by(Bank_Entry.created_at)):
        title, tools = split_tools(entry.title)
        if not tools or not title:
            continue
        report.titles.append((entry.title, title))
        entry.title = title
        names = held.setdefault((entry.applicant_id, entry.resume_id), set())
        for name, _ in skill_pairs([(t, None) for t in tools]):
            if name.lower() in names:
                continue
            names.add(name.lower())
            session.add(Bank_Skill(
                id=uuid.uuid4(), applicant_id=entry.applicant_id, resume_id=entry.resume_id, name=name, group=None,
            ))
            report.added.append(name)
        report.applicants.add(entry.applicant_id)

    for applicant in report.applicants:
        await clear_embedding(session, applicant)
    await session.flush()
    return report


def _local(url: str) -> bool:
    return (urlsplit(url).hostname or "") in ("localhost", "127.0.0.1", "::1")


async def _run(applicant_id: uuid.UUID | None, *, apply: bool) -> Report:
    async with get_sessionmaker()() as session:
        report = await clean(session, applicant_id)
        await (session.commit() if apply else session.rollback())
        return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--applicant", type=uuid.UUID, help="only this applicant (default: every one)")
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run, rolled back)")
    args = parser.parse_args(argv)
    if not _local(get_settings().app_url):
        print("DATABASE_URL is not on this computer: the clean-up runs only on a local database.", file=sys.stderr)
        return 2
    report = asyncio.run(_run(args.applicant, apply=args.apply))
    print(f"{'' if args.apply else 'DRY RUN, rolled back: '}{len(report.applicants)} applicant(s)")
    for before, after in report.titles:
        print(f"  title: {before!r} -> {after!r}")
    for name in report.added:
        print(f"  skill added: {name!r}")
    for before, after in report.renamed:
        print(f"  skill renamed: {before!r} -> {after!r}")
    for name in report.removed:
        print(f"  skill removed: {name!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
