'''
The experience bank (KAN-206): one bank row per applicant, its entries, the
entries' bullets, the bullets' variants (KAN-217) and the applicant's skills.
An entry or skill read from an upload belongs to that upload (`resume_id`,
ADR 0005); one the student made belongs to none.
Built resumes are a later table that points at these.
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
    # The catalog keys (services/skill_catalog.py) of skills the student
    # deleted (KAN-369): a reading or Tailor never adds them again.
    removed_skills: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'"))


class Bank_Entry(BaseModel):
    '''
    One thing the applicant did, in one section. Months are stored as the
    first day of the month. The section fields (degree ... award_date) are
    null outside their own section; schemas/bank.py enforces which is which.
    `resume_id` is the upload whose import wrote it (ADR 0005): uploads never
    share an entry, so the same job on two uploads is two rows, and deleting
    or re-reading the upload deletes its entries. Null: the student made it.
    '''
    __tablename__ = "bank_entries"
    __table_args__ = (Index("bank_entries_applicant_resume_idx", "applicant_id", "resume_id"),)

    id: Mapped[_uuid.UUID] = mapped_column(
        primary_key=True, default=_uuid.uuid4, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), index=True)
    resume_id: Mapped[_uuid.UUID | None] = mapped_column(ForeignKey("resumes.id", ondelete="CASCADE"))
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
    A named ability, with an optional group ("Languages"). Owned as an entry
    is (`resume_id`). A name appears once per owner, ignoring case: once per
    upload, and once among the student's own (bank_skills_applicant_name_key,
    NULLS NOT DISTINCT).
    '''
    __tablename__ = "bank_skills"
    __table_args__ = (
        Index("bank_skills_applicant_name_key", "applicant_id", "resume_id", text("lower(name)"), unique=True,
              postgresql_nulls_not_distinct=True),
        Index("bank_skills_applicant_resume_idx", "applicant_id", "resume_id"),
    )

    id: Mapped[_uuid.UUID] = mapped_column(
        primary_key=True, default=_uuid.uuid4, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"))
    resume_id: Mapped[_uuid.UUID | None] = mapped_column(ForeignKey("resumes.id", ondelete="CASCADE"))
    name: Mapped[str]
    group: Mapped[str | None]

