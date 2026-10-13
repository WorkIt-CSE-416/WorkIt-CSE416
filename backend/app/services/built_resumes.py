"""
Built resumes (KAN-207): Generate, the 5-resume limit, the default resume,
and loading one resume's view. Like services/bank.py, every function takes
the applicant id and touches only that applicant's rows (another applicant's
resume answers `NotFound`), and flushes but never commits.

- **The limit:** uploaded resumes plus base resumes, at most `MAX_RESUMES`.
  Tailored resumes (with a job posting) and sent resumes do not count.
  `check_room` runs before anything is written, on Generate and on upload.
- **The default resume** is `applicant_profiles.default_resume_id` (an
  uploaded resume) or `default_built_resume_id` (a base resume), never both:
  setting one clears the other, and a check constraint backs it.
"""

import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.built_resume import (
    Built_Resume,
    Built_Resume_Bullet,
    Built_Resume_Entry,
    Built_Resume_Skill,
)
from app.models.profiles import Applicant_Profile
from app.models.resume import Resume
from app.services.bank import NotFound, load_bank
from app.services.resume_view import (
    BulletChoice,
    Choices,
    EntryChoice,
    ResumeView,
    SkillChoice,
    all_chosen,
    build_view,
)

MAX_RESUMES = 5
DEFAULT_TEMPLATE = "jakes"


class ResumeLimitReached(Exception):
    def __init__(self) -> None:
        super().__init__(
            f"You can keep {MAX_RESUMES} resumes (uploaded and base resumes together). "
            "Delete one to add another."
        )


async def count_resumes(session: AsyncSession, applicant_id: uuid.UUID) -> int:
    uploaded = await session.scalar(select(func.count()).where(Resume.applicant_id == applicant_id))
    base = await session.scalar(
        select(func.count()).where(
            Built_Resume.applicant_id == applicant_id, Built_Resume.job_posting_id.is_(None)
        )
    )
    return (uploaded or 0) + (base or 0)


async def check_room(session: AsyncSession, applicant_id: uuid.UUID) -> None:
    """Raise ResumeLimitReached when one more resume would pass the limit.
    Two requests at once can both pass; the limit errs toward the student."""
    if await count_resumes(session, applicant_id) >= MAX_RESUMES:
        raise ResumeLimitReached


async def generate(session: AsyncSession, applicant_id: uuid.UUID, name: str) -> Built_Resume:
    """A base resume with every bank entry, bullet and skill, in the bank's
    order (the fixed section order, newest first)."""
    await check_room(session, applicant_id)
    resume = Built_Resume(id=uuid.uuid4(), applicant_id=applicant_id, name=name, template=DEFAULT_TEMPLATE)
    session.add(resume)
    # No relationship() orders the inserts (models/CLAUDE.md): the resume
    # goes in before its choice rows.
    await session.flush()
    choices = all_chosen(await load_bank(session, applicant_id))
    session.add_all(
        [Built_Resume_Entry(built_resume_id=resume.id, entry_id=i, shown=c.shown, position=c.position)
         for i, c in choices.entries.items()]
        + [Built_Resume_Bullet(built_resume_id=resume.id, bullet_id=i, shown=c.shown, position=c.position)
           for i, c in choices.bullets.items()]
        + [Built_Resume_Skill(built_resume_id=resume.id, skill_id=i, shown=c.shown, position=c.position)
           for i, c in choices.skills.items()]
    )
    await session.flush()
    await session.refresh(resume)
    return resume


async def list_resumes(session: AsyncSession, applicant_id: uuid.UUID) -> list[Built_Resume]:
    """Newest first."""
    rows = await session.scalars(
        select(Built_Resume)
        .where(Built_Resume.applicant_id == applicant_id)
        .order_by(Built_Resume.created_at.desc(), Built_Resume.id)
    )
    return list(rows)


async def get_resume(session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID) -> Built_Resume:
    row = await session.scalar(
        select(Built_Resume).where(Built_Resume.id == resume_id, Built_Resume.applicant_id == applicant_id)
    )
    if row is None:
        raise NotFound
    return row


async def delete_resume(session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID) -> None:
    """Its choice rows go with it; a default pointing at it is cleared
    (ON DELETE SET NULL)."""
    await session.delete(await get_resume(session, applicant_id, resume_id))
    await session.flush()


async def default_built_id(session: AsyncSession, applicant_id: uuid.UUID) -> uuid.UUID | None:
    return await session.scalar(
        select(Applicant_Profile.default_built_resume_id).where(Applicant_Profile.id == applicant_id)
    )


async def set_default(
    session: AsyncSession,
    applicant_id: uuid.UUID,
    *,
    uploaded_id: uuid.UUID | None = None,
    built_id: uuid.UUID | None = None,
) -> None:
    """Point the default at one resume and clear the other pointer. The
    caller has checked the resume is the applicant's; a built one must be a
    base resume."""
    if built_id is not None:
        row = await get_resume(session, applicant_id, built_id)
        if row.job_posting_id is not None:
            raise NotFound
    await session.execute(
        update(Applicant_Profile)
        .where(Applicant_Profile.id == applicant_id)
        .values(default_resume_id=uploaded_id, default_built_resume_id=built_id)
    )


async def load_choices(session: AsyncSession, resume_id: uuid.UUID) -> Choices:
    entries = await session.scalars(
        select(Built_Resume_Entry).where(Built_Resume_Entry.built_resume_id == resume_id))
    bullets = await session.scalars(
        select(Built_Resume_Bullet).where(Built_Resume_Bullet.built_resume_id == resume_id))
    skills = await session.scalars(
        select(Built_Resume_Skill).where(Built_Resume_Skill.built_resume_id == resume_id))
    return Choices(
        entries={r.entry_id: EntryChoice(r.shown, r.position, r.show_gpa, r.show_coursework) for r in entries},
        bullets={r.bullet_id: BulletChoice(r.shown, r.position) for r in bullets},
        skills={r.skill_id: SkillChoice(r.shown, r.position) for r in skills},
    )


async def load_view(
    session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID
) -> tuple[Built_Resume, ResumeView]:
    resume = await get_resume(session, applicant_id, resume_id)
    bank = await load_bank(session, applicant_id)
    return resume, build_view(bank, await load_choices(session, resume.id))

