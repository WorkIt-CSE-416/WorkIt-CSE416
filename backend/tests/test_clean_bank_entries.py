"""The one-off clean-up of older resume readings (scripts/clean_bank_reading.py),
on the test database. Made-up rows only."""

import uuid

import pytest
from sqlalchemy import select

from app.models.bank import Bank_Entry, Bank_Skill
from app.models.dto import bank_section
from app.models.resume import Resume
from app.scripts.clean_bank_reading import clean

pytestmark = pytest.mark.anyio


async def test_the_clean_up_splits_glued_titles_and_drops_what_is_not_a_skill(database):
    from tests.test_built_resumes import _seed_applicant

    async with database() as session:
        student = await _seed_applicant(session)
        upload = uuid.uuid4()
        session.add(Resume(id=upload, applicant_id=student, original_filename="r.pdf", storage_path="local:r.pdf"))
        await session.flush()
        rows = [
            (bank_section.experience, "Software Engineer Intern, Telemetry| C++, Go, gRPC", "Northwind Signals"),
            (bank_section.projects, "Line Robot | Line Club", None),
        ]
        for section, title, org in rows:
            session.add(Bank_Entry(id=uuid.uuid4(), applicant_id=student, resume_id=upload, section=section,
                                   title=title, organization=org))
        for name, group in [("C++", "Languages"), ("Robotics Club| C/C++", None),
                            ("Computer Science degree", None), ("AI tools", None)]:
            session.add(Bank_Skill(id=uuid.uuid4(), applicant_id=student, resume_id=upload, name=name, group=group))
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


async def test_the_clean_up_keeps_real_skills_and_never_touches_typed_ones(database):
    from tests.test_built_resumes import _seed_applicant

    real = ["Scrum Master", "Master Data Management", "Chrome Developer Tools", "CI/CD tools",
            "Microsoft Office Tools", "User Experience"]
    junk = ["Computer Science degree", "AI tools", "Bachelor's degree in Physics", "3+ years of Java",
            "GPA 3.8", "Club| C++"]
    async with database() as session:
        student = await _seed_applicant(session)
        upload = uuid.uuid4()
        session.add(Resume(id=upload, applicant_id=student, original_filename="r.pdf", storage_path="local:r.pdf"))
        await session.flush()
        for name in real + junk:
            session.add(Bank_Skill(id=uuid.uuid4(), applicant_id=student, resume_id=upload, name=name))
        session.add(Bank_Skill(id=uuid.uuid4(), applicant_id=student, name="Robotics degree"))  # typed by hand
        await session.commit()

        await clean(session, student)
        await session.commit()
        names = set(await session.scalars(select(Bank_Skill.name).where(Bank_Skill.applicant_id == student)))
    assert names == {*real, "C++", "Robotics degree"}
