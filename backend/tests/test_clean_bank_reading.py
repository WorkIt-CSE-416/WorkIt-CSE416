"""The one-off clean-up of older resume readings (scripts/clean_bank_reading.py),
on the test database. Made-up rows only."""

import uuid

import pytest
from sqlalchemy import select

from app.models.bank import Bank_Entry, Bank_Skill
from app.models.dto import bank_section
from app.scripts.clean_bank_reading import clean

pytestmark = pytest.mark.anyio


async def test_the_clean_up_splits_glued_titles_and_drops_what_is_not_a_skill(database):
    from tests.test_built_resumes import _seed_applicant

    async with database() as session:
        student = await _seed_applicant(session)
        rows = [
            (bank_section.experience, "Software Engineer Intern, Telemetry| C++, Go, gRPC", "Northwind Signals"),
            (bank_section.projects, "Line Robot | Line Club", None),
        ]
        for section, title, org in rows:
            session.add(Bank_Entry(id=uuid.uuid4(), applicant_id=student, section=section, title=title,
                                   organization=org))
        for name, group in [("C++", "Languages"), ("Robotics Club| C/C++", None),
                            ("Computer Science degree", None), ("AI tools", None)]:
            session.add(Bank_Skill(id=uuid.uuid4(), applicant_id=student, name=name, group=group))
        await session.commit()

        await clean(session, student)
        await session.commit()
        again = await clean(session, student)

        titles = sorted(await session.scalars(select(Bank_Entry.title).where(Bank_Entry.applicant_id == student)))
        skills = {(s.name, s.group) for s in await session.scalars(
            select(Bank_Skill).where(Bank_Skill.applicant_id == student))}
    assert titles == ["Line Robot | Line Club", "Software Engineer Intern, Telemetry"]
    assert skills == {("C++", "Languages"), ("C/C++", None), ("Go", None), ("gRPC", None)}
    assert not (again.titles or again.added or again.renamed or again.removed)
