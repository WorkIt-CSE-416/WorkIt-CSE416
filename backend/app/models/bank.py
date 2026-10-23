'''
The experience bank (KAN-206): one bank row per applicant, its entries, the
entries' bullets, the bullets' variants (KAN-217), the applicant's skills,
and the skill links (KAN-216) between skills and entries. Built resumes are
a later table that points at these.
'''
import datetime
import uuid as _uuid
from decimal import Decimal

from pgvector.sqlalchemy import VECTOR
from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel
from app.models.dto import EMBEDDING_DIMENSIONS, bank_section, entry_end_kind


class Experience_Bank(BaseModel):
    '''
    One row per applicant, made by the first change to their bank. Holds the
    bank embedding; a null embedding means "remake it on the next
    recommendations request", so every bank change sets it back to null.
    '''
    __tablename__ = "experience_banks"

    applicant_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), primary_key=True)
    embedding: Mapped[list[float] | None] = mapped_column(VECTOR(EMBEDDING_DIMENSIONS), deferred=True)
    embedded_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))


class Bank_Entry(BaseModel):
    '''
    One thing the applicant did, in one section. Months are stored as the
    first day of the month. The section fields (degree ... award_date) are
    null outside their own section; schemas/bank.py enforces which is which.
    '''
    __tablename__ = "bank_entries"

    id: Mapped[_uuid.UUID] = mapped_column(
        primary_key=True, default=_uuid.uuid4, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), index=True)
    section: Mapped[bank_section]
    title: Mapped[str]
    organization: Mapped[str | None]
    location: Mapped[str | None]
    start_month: Mapped[datetime.date | None]
    end_month: Mapped[datetime.date | None]
    end_kind: Mapped[entry_end_kind | None]
    # Education
    degree: Mapped[str | None]
    field_of_study: Mapped[str | None]
    gpa: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    gpa_scale: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    coursework: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'"))
    honors: Mapped[str | None]
    # Projects
    link: Mapped[str | None]
    # Certifications
    issuer: Mapped[str | None]
    # Awards
    award_date: Mapped[datetime.date | None]


class Bank_Bullet(BaseModel):
    '''
    One line of an entry, in its original wording. Variants are another table.
    '''
    __tablename__ = "bank_bullets"

    id: Mapped[_uuid.UUID] = mapped_column(
        primary_key=True, default=_uuid.uuid4, server_default=text("gen_random_uuid()"))
    entry_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("bank_entries.id", ondelete="CASCADE"), index=True)
    position: Mapped[int]
    text: Mapped[str]


class Bank_Bullet_Variant(BaseModel):
    '''
    Another wording of a bullet, kept beside the original (ADR 0001): made
    by Tailor for one job posting, or typed on one built resume and local to
    it (the editor, KAN-218), never both. A built resume shows a variant only
    when its bullet choice names it. A variant never reaches the bank
    embedding, so adding one does not clear it.
    '''
    __tablename__ = "bank_bullet_variants"
    __table_args__ = (
        CheckConstraint(
            "job_posting_id IS NULL OR built_resume_id IS NULL", name="bank_bullet_variants_one_owner_check"),
        # At most one local variant for each bullet on a built resume.
        Index("bank_bullet_variants_local_key", "built_resume_id", "bullet_id", unique=True,
              postgresql_where=text("built_resume_id IS NOT NULL")),
    )

    id: Mapped[_uuid.UUID] = mapped_column(
        primary_key=True, default=_uuid.uuid4, server_default=text("gen_random_uuid()"))
    bullet_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("bank_bullets.id", ondelete="CASCADE"), index=True)
    text: Mapped[str]
    # SET NULL: a variant outlives its posting, so another resume that
    # shows it keeps its wording.
    job_posting_id: Mapped[_uuid.UUID | None] = mapped_column(
        ForeignKey("job_postings.id", ondelete="SET NULL"))
    built_resume_id: Mapped[_uuid.UUID | None] = mapped_column(
        ForeignKey("built_resumes.id", ondelete="CASCADE"))


class Bank_Skill(BaseModel):
    '''
    A named ability, with an optional group ("Languages"). A name appears
    once per applicant, ignoring case (bank_skills_applicant_name_key).
    '''
    __tablename__ = "bank_skills"
    __table_args__ = (
        Index("bank_skills_applicant_name_key", "applicant_id", text("lower(name)"), unique=True),
    )

    id: Mapped[_uuid.UUID] = mapped_column(
        primary_key=True, default=_uuid.uuid4, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"))
    name: Mapped[str]
    group: Mapped[str | None]


class Bank_Skill_Link(BaseModel):
    '''
    Potentially bad design, links each skill with entry, this may not be needed to save DB costs
    '''
    __tablename__ = "bank_skill_links"

    skill_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("bank_skills.id", ondelete="CASCADE"), primary_key=True)
    entry_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("bank_entries.id", ondelete="CASCADE"), primary_key=True, index=True)
