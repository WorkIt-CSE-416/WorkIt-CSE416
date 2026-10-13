"""
Sent resumes (KAN-208): the exact file a student downloaded or applied
with, kept unchanged. Like services/bank.py, every function takes the
applicant id and touches only that applicant's rows (another applicant's
row answers `NotFound`), and flushes but never commits. Storage is handed
in by the router (its `get_supabase()`), so tests patch it there.

- **From a built resume** (`send_built`): hash the view, template and header
  text before rendering. A repeat hash for the same built resume (and the
  same job posting) returns the last sent resume with no render and no
  upload. Otherwise render, upload the PDF to `{applicant}/sent/{id}.pdf`
  in the Resume bucket and write the row.
- **From an uploaded resume** (`send_uploaded`, for Apply, KAN-220): no new
  file; the row points at the uploaded resume's stored file.
- **Apply** (KAN-220) is either one with a `job_posting_id`; a posting that
  does not exist answers `NotFound`. A repeat is matched within the same
  posting, so a plain download and an Apply are separate sent resumes.
- **A file stays while a row uses it** (`file_in_use`). Deleting an uploaded
  resume keeps its file while a sent resume points at it; deleting a sent
  resume removes its file only when no other sent resume or uploaded resume
  uses it.
"""

import asyncio
import dataclasses
import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.jobs import Job_Post
from app.models.resume import Resume
from app.models.sent_resume import Sent_Resume
from app.services import built_resumes
from app.services.bank import NotFound
from app.services.resume_render import Identity, render
from app.services.resume_view import ResumeView

BUCKET = "Resume"


@dataclass(frozen=True)
class Sent:
    row: Sent_Resume
    created: bool
    # The characters the PDF's font could not draw, from a fresh render. A
    # repeat returns none: the student already took that file once.
    missing_characters: tuple[str, ...] = ()


def content_hash(view: ResumeView, identity: Identity, template: str) -> str:
    """Everything the PDF is made from, before it is made. Dataclasses
    serialize field by field in a fixed order; dates and decimals by str."""
    payload = {"template": template, "identity": dataclasses.asdict(identity), "view": dataclasses.asdict(view)}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


async def _check_posting(session: AsyncSession, job_posting_id: uuid.UUID | None) -> None:
    if job_posting_id is not None and await session.get(Job_Post, job_posting_id) is None:
        raise NotFound


async def _last_match(
    session: AsyncSession, applicant_id: uuid.UUID, job_posting_id: uuid.UUID | None, *where: Any
) -> Sent_Resume | None:
    return await session.scalar(
        select(Sent_Resume)
        .where(
            Sent_Resume.applicant_id == applicant_id,
            Sent_Resume.job_posting_id.is_not_distinct_from(job_posting_id),
            *where,
        )
        .order_by(Sent_Resume.created_at.desc())
        .limit(1)
    )


async def send_built(
    session: AsyncSession,
    storage: Any,
    applicant_id: uuid.UUID,
    built_resume_id: uuid.UUID,
    *,
    job_posting_id: uuid.UUID | None = None,
) -> Sent:
    """Raises NotFound for a built resume that is not the applicant's, and
    resume_render.TectonicUnavailable when the PDF cannot be made. When this
    returns `created`, the file is uploaded: if the commit then fails, the
    caller removes `row.storage_path`."""
    await _check_posting(session, job_posting_id)
    resume, view = await built_resumes.load_view(session, applicant_id, built_resume_id)
    identity = await built_resumes.load_identity(session, applicant_id)
    digest = content_hash(view, identity, resume.template)
    last = await _last_match(
        session, applicant_id, job_posting_id,
        Sent_Resume.built_resume_id == resume.id, Sent_Resume.content_hash == digest,
    )
    if last is not None:
        return Sent(last, created=False)

    rendered = await asyncio.to_thread(render, view, identity, resume.template)
    sent_id = uuid.uuid4()
    path = f"{applicant_id}/sent/{sent_id}.pdf"
    await asyncio.to_thread(storage.from_(BUCKET).upload, path, rendered.pdf, {"content-type": "application/pdf"})
    row = Sent_Resume(
        id=sent_id, applicant_id=applicant_id, storage_path=path, name=resume.name,
        built_resume_id=resume.id, job_posting_id=job_posting_id, content_hash=digest,
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return Sent(row, created=True, missing_characters=rendered.missing_characters)


async def send_uploaded(
    session: AsyncSession,
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    *,
    job_posting_id: uuid.UUID | None = None,
) -> Sent:
    """A sent resume that points at an uploaded resume's own file. The file
    never changes, so a repeat (same resume, same posting) returns the last."""
    await _check_posting(session, job_posting_id)
    resume = await session.scalar(
        select(Resume).where(Resume.id == resume_id, Resume.applicant_id == applicant_id)
    )
    if resume is None or not resume.storage_path:
        raise NotFound
    last = await _last_match(session, applicant_id, job_posting_id, Sent_Resume.uploaded_resume_id == resume.id)
    if last is not None:
        return Sent(last, created=False)
    row = Sent_Resume(
        id=uuid.uuid4(), applicant_id=applicant_id, storage_path=resume.storage_path,
        name=resume.original_filename or "Uploaded resume", uploaded_resume_id=resume.id,
        job_posting_id=job_posting_id,
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return Sent(row, created=True)


async def list_sent(session: AsyncSession, applicant_id: uuid.UUID) -> list[Sent_Resume]:
    """Newest first."""
    rows = await session.scalars(
        select(Sent_Resume)
        .where(Sent_Resume.applicant_id == applicant_id)
        .order_by(Sent_Resume.created_at.desc(), Sent_Resume.id)
    )
    return list(rows)


async def get_sent(session: AsyncSession, applicant_id: uuid.UUID, sent_id: uuid.UUID) -> Sent_Resume:
    row = await session.scalar(
        select(Sent_Resume).where(Sent_Resume.id == sent_id, Sent_Resume.applicant_id == applicant_id)
    )
    if row is None:
        raise NotFound
    return row


async def file_in_use(session: AsyncSession, storage_path: str) -> bool:
    """Whether a sent resume or an uploaded resume still points at the file."""
    return bool(await session.scalar(select(or_(
        exists().where(Sent_Resume.storage_path == storage_path),
        exists().where(Resume.storage_path == storage_path),
    ))))


async def delete_sent(session: AsyncSession, applicant_id: uuid.UUID, sent_id: uuid.UUID) -> str | None:
    """Delete the row. Returns its file's path when nothing else uses the
    file any more, for the caller to remove after the commit."""
    row = await get_sent(session, applicant_id, sent_id)
    path = row.storage_path
    await session.delete(row)
    await session.flush()
    return None if await file_in_use(session, path) else path


def download_name(row: Sent_Resume) -> str:
    """The file name a download is saved under. A row with no hash came from
    an uploaded resume, whose name is its original filename."""
    stem = row.name.rsplit(".", 1)[0] if row.content_hash is None else row.name
    return built_resumes.file_name(stem, row.storage_path.rsplit(".", 1)[-1])
