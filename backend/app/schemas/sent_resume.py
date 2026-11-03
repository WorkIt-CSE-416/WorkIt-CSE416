"""Request/response shapes for sent resumes (KAN-208)."""

import base64
import binascii
import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.services.text_extraction import MAX_SIZE, PDF_MAGIC


class SentFileCreate(BaseModel):
    """POST .../sent-resumes/file: the file Apply attached to a form
    (KAN-544), its name and its bytes in base64, and the job posting it went
    to. A PDF under 5 MB, as an upload is; anything else is a 422."""

    job_posting_id: UUID
    file_name: str = Field(min_length=1, max_length=255)
    content: str = Field(max_length=4 * (MAX_SIZE // 3 + 1))

    @field_validator("file_name")
    @classmethod
    def _named(cls, name: str) -> str:
        if not name.strip():
            raise ValueError("The file needs a name")
        return name.strip()

    @field_validator("content")
    @classmethod
    def _a_pdf(cls, data: str) -> str:
        try:
            pdf = base64.b64decode(data, validate=True)
        except (binascii.Error, ValueError):
            raise ValueError("data is not base64")
        if len(pdf) > MAX_SIZE:
            raise ValueError("File must be under 5 MB")
        if not pdf.startswith(PDF_MAGIC):
            raise ValueError("Only a PDF is kept as a sent file")
        return data

    def pdf(self) -> bytes:
        return base64.b64decode(self.content)


class SentResumeCreate(BaseModel):
    """POST body: exactly one source, a built resume or an uploaded resume,
    and the job posting it went to (Apply, KAN-220). Only a send keeps a sent
    resume: a download keeps nothing (KAN-267), so the posting is required.
    A built resume goes as a PDF; an uploaded resume is its own file. The
    file Apply sent goes to POST .../sent-resumes/file (SentFileCreate)."""

    built_resume_id: UUID | None = None
    uploaded_resume_id: UUID | None = None
    job_posting_id: UUID

    @model_validator(mode="after")
    def _one_source(self) -> "SentResumeCreate":
        if (self.built_resume_id is None) == (self.uploaded_resume_id is None):
            raise ValueError("Give exactly one of built_resume_id and uploaded_resume_id")
        return self


class SentResumeResponse(BaseModel):
    """One sent resume as every route answers it."""

    id: UUID
    name: str
    built_resume_id: UUID | None
    uploaded_resume_id: UUID | None
    job_posting_id: UUID | None
    created_at: datetime.datetime
    # The file's kind: "pdf", or "docx" for a Word download kept before
    # KAN-267 (or an uploaded Word file). A snapshot is always a PDF.
    format: str
    # Rebuilt from an uploaded file's text once that upload was replaced or
    # deleted (KAN-267): the layout and some sections may differ from what
    # was sent.
    rebuilt: bool

    @classmethod
    def from_row(cls, row) -> "SentResumeResponse":
        """From a Sent_Resume row; `format` from its file's extension."""
        return cls(
            id=row.id, name=row.name, built_resume_id=row.built_resume_id,
            uploaded_resume_id=row.uploaded_resume_id, job_posting_id=row.job_posting_id,
            created_at=row.created_at,
            format=row.storage_path.rsplit(".", 1)[-1].lower() if row.storage_path else "pdf",
            rebuilt=row.snapshot_id is not None and row.content_hash is None,
        )


class SentResumeFile(BaseModel):
    """A sent resume's file, one of two ways (KAN-267): `url`, a 5-minute
    link to a file in Storage (an uploaded resume's, or a PDF kept before
    KAN-267), or `data`, the PDF itself in base64, rendered again from its
    snapshot. `original_text` is a rebuilt one's uploaded file's text."""

    file_name: str
    content_type: str = "application/pdf"
    url: str | None = None
    data: str | None = None
    rebuilt: bool = False
    original_text: str | None = None

    @classmethod
    def of(cls, file) -> "SentResumeFile":
        """From the service's SentFile."""
        return cls(
            file_name=file.file_name, url=file.url,
            data=base64.b64encode(file.pdf).decode("ascii") if file.pdf is not None else None,
            rebuilt=file.rebuilt, original_text=file.original_text,
        )


class SentResumeDownload(SentResumeResponse):
    """A kept sent resume and its file (`SentResumeFile`'s fields), with the
    characters a fresh render's font could not draw."""

    file_name: str
    content_type: str = "application/pdf"
    url: str | None = None
    data: str | None = None
    missing_characters: list[str]

    @classmethod
    def of(cls, row, file, missing_characters=()) -> "SentResumeDownload":
        sent = SentResumeFile.of(file)
        return cls(
            **SentResumeResponse.from_row(row).model_dump(),
            file_name=sent.file_name, url=sent.url, data=sent.data,
            missing_characters=list(missing_characters),
        )
