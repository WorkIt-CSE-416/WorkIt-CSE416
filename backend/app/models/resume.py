import enum
import uuid as _uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import  Text, text, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column


from json import jsonb
from app.db import Base


class ResumeStatus(str, enum.Enum):
    uploaded="uploaded"
    parsed="parsed"
    parse_failed="parse_failed"

class Resume(Base):
    __tablename__ = "resumes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("applicant_profiles.profile_id", ondelete="CASCADE"))
    original_filename: Mapped[Optional[str]]
    storage_path: Mapped[Optional[str]]
    file_hash: Mapped[Optional[str]]
    status: Mapped[ResumeStatus] = mapped_column(default=ResumeStatus.uploaded)
    raw_text: Mapped[Optional[str]]
    parsed_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    is_default: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(server_default=text("now()"))

