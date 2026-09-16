import enum
import uuid as _uuid
from datetime import date
from typing import Optional

from sqlalchemy import text, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, BaseModel


class ResumeStatus(str, enum.Enum):
    uploaded="uploaded"
    parsed="parsed"
    parse_failed="parse_failed"

class Resume(BaseModel):
    __tablename__ = "resumes"

    id: Mapped[_uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[_uuid.UUID] = mapped_column(ForeignKey("applicant_profiles.id", ondelete="CASCADE"))
    original_filename: Mapped[Optional[str]]
    storage_path: Mapped[Optional[str]]
    status: Mapped[ResumeStatus] = mapped_column(server_default="uploaded")
    raw_text: Mapped[Optional[str]]
    parsed_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

class ResumeEducation(BaseModel):
    __tablename__ = "resume_education"

    id: Mapped[_uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    resume_id: Mapped[_uuid.UUID] = mapped_column(ForeignKey("resumes.id", ondelete="CASCADE"))
    institution: Mapped[str]
    degree: Mapped[Optional[str]]
    field_of_study: Mapped[Optional[str]]
    gpa: Mapped[Optional[float]]
    start_date: Mapped[Optional[date]]
    end_date: Mapped[Optional[date]]
    description: Mapped[Optional[str]]

class ResumeExperience(BaseModel):
    __tablename__ = "resume_experience"

    id: Mapped[_uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    resume_id: Mapped[_uuid.UUID] = mapped_column(ForeignKey("resumes.id", ondelete="CASCADE"))
    company_name: Mapped[str]
    title: Mapped[str]
    location: Mapped[Optional[str]]
    start_date: Mapped[Optional[date]]
    end_date: Mapped[Optional[date]]
    description: Mapped[Optional[str]]

class ResumeSkills(Base):
    __tablename__ = "resume_skills"

    id: Mapped[_uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    resume_id: Mapped[_uuid.UUID] = mapped_column(ForeignKey("resumes.id", ondelete="CASCADE"))
    skill_name: Mapped[str]
    category: Mapped[Optional[str]]

class ResumeProjects(BaseModel):
    __tablename__ = "resume_projects"

    id: Mapped[_uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    resume_id: Mapped[_uuid.UUID] = mapped_column(ForeignKey("resumes.id", ondelete="CASCADE"))
    project_name: Mapped[str]
    url: Mapped[Optional[str]]
    start_date: Mapped[Optional[date]]
    end_date: Mapped[Optional[date]]
    description: Mapped[Optional[str]]

class ResumeCertifications(Base):
    __tablename__ = "resume_certifications"

    id: Mapped[_uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    resume_id: Mapped[_uuid.UUID] = mapped_column(ForeignKey("resumes.id", ondelete="CASCADE"))
    cert_name: Mapped[str]
    issuer: Mapped[Optional[str]]
