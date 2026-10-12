import uuid as _uuid

from pgvector.sqlalchemy import (
    VECTOR,  # for storing embeddings in Postgres (gives PG a vector type)
)
from sqlalchemy import ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel
from app.models.dto import EMBEDDING_DIMENSIONS, ResumeStatus


class Resume(BaseModel):
    __tablename__ = "resumes"

    id: Mapped[_uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[_uuid.UUID] = mapped_column(ForeignKey("applicant_profiles.id", ondelete="CASCADE"), index=True)
    original_filename: Mapped[str | None]
    storage_path: Mapped[str | None]
    status: Mapped[ResumeStatus] = mapped_column(server_default="uploaded")
    raw_text: Mapped[str | None]
    # storing the ParsedResume objects 
    parsed_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # The resume's meaning as a vector
    embedding: Mapped[list[float] | None] = mapped_column(VECTOR(EMBEDDING_DIMENSIONS), deferred=True)
    # Set on a resume WorkIt built (KAN-176): the template its file was
    # rendered with. NULL for an upload. Its parsed_json is a frozen copy;
    # editing the Experience Bank never changes it.
    template_key: Mapped[str | None] = mapped_column(String(40))
    # A tailored resume's job posting. SET NULL: a posting that goes keeps
    # the resume, which is still the applicant's
    target_job_id: Mapped[_uuid.UUID | None] = mapped_column(
        ForeignKey("job_postings.id", ondelete="SET NULL", name="resumes_target_job_id_fkey"))
    # An applicant's own LaTeX (KAN-176, template_key "latex"): the source
    # exactly as pasted and edited. Its PDF is this compiled on every
    # request (services/latex_source); parsed_json is read back from it.
    latex_source: Mapped[str | None] = mapped_column(Text)
