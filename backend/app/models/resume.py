import uuid as _uuid

from sqlalchemy import ForeignKey, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel
from app.models.dto import ResumeStatus


class Resume(BaseModel):
    __tablename__ = "resumes"

    id: Mapped[_uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[_uuid.UUID] = mapped_column(ForeignKey("applicant_profiles.id", ondelete="CASCADE"), index=True)
    original_filename: Mapped[str | None]
    storage_path: Mapped[str | None]
    status: Mapped[ResumeStatus] = mapped_column(server_default="uploaded")
    raw_text: Mapped[str | None]
    parsed_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
