'''
The Experience Bank (KAN-176): everything one applicant has done, one row per
entry, plus the skills they name outside any entry. Private to the applicant;
a resume is a frozen ParsedResume copy made from it (models/resume.py), and
services/experience.py is the only code that maps between the two.
'''
import uuid as _uuid
from datetime import date

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel
from app.models.dto import EntrySection

_SECTIONS = ", ".join(f"'{s.value}'" for s in EntrySection)


class ExperienceEntry(BaseModel):
    __tablename__ = "experience_entries"

    id: Mapped[_uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), index=True)
    # Text with a CHECK, not a Postgres enum: see dto.EntrySection
    section: Mapped[str] = mapped_column(String(20))
    # The role, degree, project, award or certification
    title: Mapped[str] = mapped_column(String(200))
    # The company, school, club or issuer; a project has none
    organization: Mapped[str | None] = mapped_column(String(200))
    location: Mapped[str | None] = mapped_column(String(100))
    start_date: Mapped[date | None]
    # NULL with a start date means current
    end_date: Mapped[date | None]
    bullets: Mapped[list[str]] = mapped_column(
        ARRAY(String), server_default=text("'{}'::varchar[]"))
    # What only some sections have: field_of_study and gpa for education, url
    # and technologies for a project (schemas.experience.EntryDetails). An
    # entry has no position of its own: the bank lists each section newest
    # first, as a resume does
    details: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))

    __table_args__ = (
        CheckConstraint(f"section IN ({_SECTIONS})", name="experience_entries_section_known"),
    )


class ApplicantSkill(BaseModel):
    __tablename__ = "applicant_skills"

    id: Mapped[_uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    # Jake's Resume prints one line per category ("Languages: …")
    category: Mapped[str | None] = mapped_column(String(100))
    # The applicant's order: skills are saved as one list, and the first
    # category in it is the first line on the resume
    sort_order: Mapped[int] = mapped_column(server_default=text("0"))

    __table_args__ = (
        # "Python" and "python" are one skill; the index also serves the
        # per-applicant lookup, so applicant_id needs none of its own
        Index("applicant_skills_name_unique", "applicant_id", func.lower(name), unique=True),
    )
