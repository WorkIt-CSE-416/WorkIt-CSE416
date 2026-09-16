import enum
import uuid as _uuid
from datetime import date
from typing import Optional

from pydantic import BaseModel as PydanticBase
from sqlalchemy import text, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel


class ResumeStatus(str, enum.Enum):
    uploaded="uploaded"
    parsed="parsed"
    parse_failed="parse_failed"


# --- Pydantic schemas for parsed_json structure ---

class Education(PydanticBase):
    institution: str
    degree: Optional[str] = None
    field_of_study: Optional[str] = None
    gpa: Optional[float] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    description: Optional[str] = None

class Experience(PydanticBase):
    company_name: str
    title: str
    location: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    description: Optional[str] = None

class Skill(PydanticBase):
    skill_name: str
    category: Optional[str] = None

class Project(PydanticBase):
    project_name: str
    url: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    description: Optional[str] = None

class Certification(PydanticBase):
    cert_name: str
    issuer: Optional[str] = None

class ParsedResume(PydanticBase):
    education: list[Education] = []
    experience: list[Experience] = []
    skills: list[Skill] = []
    projects: list[Project] = []
    certifications: list[Certification] = []


# --- SQLAlchemy model ---

class Resume(BaseModel):
    __tablename__ = "resumes"

    id: Mapped[_uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[_uuid.UUID] = mapped_column(ForeignKey("applicant_profiles.id", ondelete="CASCADE"))
    original_filename: Mapped[Optional[str]]
    storage_path: Mapped[Optional[str]]
    status: Mapped[ResumeStatus] = mapped_column(server_default="uploaded")
    raw_text: Mapped[Optional[str]]
    parsed_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
