"""
Sent resumes (KAN-208): the exact file a student applied with, kept
unchanged. A download keeps nothing (KAN-267): every sent resume is a send
to a job posting (Apply, or auto apply), and always a PDF. Like services/bank.py, every function takes the
applicant id and touches only that applicant's rows (another applicant's
row answers `NotFound`), and flushes but never commits. Storage is handed
in by the router (its `get_supabase()`), so tests patch it there.

Where a sent resume's file is (KAN-267, docs/sent_resume.md):

- **From a built resume** (`send_built`): a snapshot, not a stored PDF.
  Hash the view, template and header text before rendering; a repeat hash
  for the same built resume and job posting returns the last sent resume.
  Otherwise render the PDF once (the student attaches it), and keep what it
  is made from as a `built` snapshot: gzipped JSON in `resume_snapshots`,
  about 2 KB where the PDF is 33. Sent resumes of the same content share
  one snapshot, whatever their posting. Opening one renders it again.
- **From an uploaded resume** (`send_uploaded`): no new file; the row
  points at the uploaded resume's stored file.
- **Until that upload is replaced or deleted** (`freeze_upload`, called by
  both routes before the row loses its file): its sent resumes then become
  an `upload` snapshot of the file's text as the parser reads it, with the
  text itself, and the file goes once nothing uses it. Approximate: the
  layout and any section the parser does not read are lost. A file with no
  text, or one the parser reads nothing from, stays a file.
- **A file stays while a row uses it** (`file_in_use`), and a snapshot
  while a sent resume does (`delete_sent`).
"""

import asyncio
import dataclasses
import gzip
import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, exists, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.resume import Resume
from app.models.sent_resume import Resume_Snapshot, Sent_Resume
from app.services import bank_import, built_resumes, postings, stored_files
from app.services.bank import NotFound
from app.services.resume_render import HeaderIdentity, render
from app.services.resume_view import ResumeView, view_from_json, view_from_reading

BUCKET = stored_files.BUCKET
# How long a sent resume's download link works.
FILE_URL_TTL_SECONDS = 5 * 60
# The snapshot JSON's shape, for a reader that must handle an older one later.
SNAPSHOT_VERSION = 1


@dataclass(frozen=True)
class Sent:
    row: Sent_Resume
    created: bool
    # The characters the PDF's font could not draw, from a fresh render. A
    # repeat returns none: the student already took that file once.
    missing_characters: tuple[str, ...] = ()
    # The PDF a new built send rendered, so answering it needs no second render.
    pdf: bytes | None = None


@dataclass(frozen=True)
class SentFile:
    """A sent resume's file, one of two ways: `url`, a short-lived link to a
    file in Storage, or `pdf`, rendered again from its snapshot. `rebuilt`
    marks an uploaded file's parsed snapshot, whose layout differs from what
    was sent; `original_text` is that file's text."""

    file_name: str
    url: str | None = None
    pdf: bytes | None = None
    rebuilt: bool = False
    original_text: str | None = None


def _identity(identity: HeaderIdentity) -> dict:
    """The header's fields as stored and hashed. `us_citizen` is left out
    while false, so a resume sent before the field existed still hashes the
    same and a repeat still finds it; an old snapshot reads it as false."""
    data = dataclasses.asdict(identity)
    if not data["us_citizen"]:
        del data["us_citizen"]
    return data


def content_hash(view: ResumeView, identity: HeaderIdentity, template: str) -> str:
    """Everything the PDF is made from, before it is made. Dataclasses
    serialize field by field in a fixed order; dates and decimals by str.
    Word files were kept with "format" in this payload until KAN-267; a PDF
    never had it, so a repeat still matches a sent resume kept before."""
    payload = {"template": template, "identity": _identity(identity), "view": dataclasses.asdict(view)}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def _snapshot(view: ResumeView, identity: HeaderIdentity, template: str, **more: Any) -> dict:
    return {"v": SNAPSHOT_VERSION, "template": template, "identity": _identity(identity),
            "view": dataclasses.asdict(view), **more}


def _pack(payload: dict) -> bytes:
    return gzip.compress(json.dumps(payload, sort_keys=True, default=str).encode())


async def _keep_snapshot(session: AsyncSession, applicant_id: uuid.UUID, digest: str, source: str, payload: dict
                         ) -> uuid.UUID:
    """The applicant's snapshot with this hash, made if it is new. One
    statement, so two sends of one content at once still make one."""
    made = await session.scalar(
        insert(Resume_Snapshot)
        .values(applicant_id=applicant_id, content_hash=digest, source=source, data=_pack(payload))
        .on_conflict_do_nothing(index_elements=["applicant_id", "content_hash"])
        .returning(Resume_Snapshot.id)
    )
    return made or await session.scalar(select(Resume_Snapshot.id).where(
        Resume_Snapshot.applicant_id == applicant_id, Resume_Snapshot.content_hash == digest))


async def _check_posting(session: AsyncSession, job_posting_id: uuid.UUID) -> None:
    if await postings.listed(session, job_posting_id) is None:
        raise NotFound


async def _last_match(
    session: AsyncSession, applicant_id: uuid.UUID, job_posting_id: uuid.UUID, *where: Any
) -> Sent_Resume | None:
    return await session.scalar(
        select(Sent_Resume)
        .where(
            Sent_Resume.applicant_id == applicant_id,
            Sent_Resume.job_posting_id == job_posting_id,
            *where,
        )
        .order_by(Sent_Resume.created_at.desc())
        .limit(1)
    )


async def send_built(
    session: AsyncSession,
    applicant_id: uuid.UUID,
    built_resume_id: uuid.UUID,
    *,
    job_posting_id: uuid.UUID,
) -> Sent:
    """The built resume as a PDF, sent to the job posting, kept as a
    snapshot. Raises NotFound for a built resume that is not the
    applicant's, and resume_render.TectonicUnavailable when the PDF cannot
    be made. Stores nothing in Storage."""
    await _check_posting(session, job_posting_id)
    resume, view = await built_resumes.load_view(session, applicant_id, built_resume_id)
    identity = await built_resumes.load_header_identity(session, applicant_id)
    digest = content_hash(view, identity, resume.template)
    last = await _last_match(
        session, applicant_id, job_posting_id,
        Sent_Resume.built_resume_id == resume.id, Sent_Resume.content_hash == digest,
    )
    if last is not None:
        return Sent(last, created=False)

    rendered = await asyncio.to_thread(render, view, identity, resume.template)
    snapshot_id = await _keep_snapshot(
        session, applicant_id, digest, "built", _snapshot(view, identity, resume.template))
    row = Sent_Resume(
        id=uuid.uuid4(), applicant_id=applicant_id, snapshot_id=snapshot_id, name=resume.name,
        built_resume_id=resume.id, job_posting_id=job_posting_id, content_hash=digest,
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return Sent(row, created=True, missing_characters=rendered.missing_characters, pdf=rendered.pdf)


async def send_uploaded(
    session: AsyncSession,
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    *,
    job_posting_id: uuid.UUID,
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


async def freeze_upload(session: AsyncSession, applicant_id: uuid.UUID, resume: Resume) -> None:
    """Before an uploaded resume's file is replaced or deleted: the sent
    resumes that point at it become a snapshot of its text as the parser
    reads it, so the file can go. Call it while `resume` still has the old
    file and its text. With no text, or nothing read, it changes nothing:
    there is nothing to rebuild from, and the file stays while a sent
    resume uses it. Renders nothing and downloads nothing."""
    if not resume.storage_path:
        return
    rows = list(await session.scalars(select(Sent_Resume).where(
        Sent_Resume.applicant_id == applicant_id, Sent_Resume.storage_path == resume.storage_path)))
    if not rows:
        return
    entries, skills = bank_import.read(resume.raw_text)
    if not entries and not skills:
        return
    # The parser does not read the file's header: it prints the profile's.
    identity = await built_resumes.load_header_identity(session, applicant_id)
    payload = _snapshot(view_from_reading(entries, skills), identity, built_resumes.DEFAULT_TEMPLATE,
                        source="upload", raw_text=resume.raw_text)
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    snapshot_id = await _keep_snapshot(session, applicant_id, digest, "upload", payload)
    for row in rows:
        row.storage_path, row.snapshot_id = None, snapshot_id
    await session.flush()


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
    """Delete the row, and its snapshot when no other sent resume uses it.
    Returns its file's path when nothing else uses the file any more, for
    the caller to remove after the commit."""
    row = await get_sent(session, applicant_id, sent_id)
    path, snapshot_id = row.storage_path, row.snapshot_id
    await session.delete(row)
    await session.flush()
    if snapshot_id is not None and not await session.scalar(
            select(exists().where(Sent_Resume.snapshot_id == snapshot_id))):
        await session.execute(delete(Resume_Snapshot).where(Resume_Snapshot.id == snapshot_id))
    return None if path is None or await file_in_use(session, path) else path


def rebuilt(row: Sent_Resume) -> bool:
    """A snapshot of an uploaded file's text (no content hash: an uploaded
    resume's row never has one), whose layout differs from what was sent."""
    return row.snapshot_id is not None and row.content_hash is None


async def open_file(
    session: AsyncSession, storage: Any, row: Sent_Resume, *, download: bool = True, pdf: bytes | None = None
) -> SentFile:
    """The row's file: a link to it in Storage (downloading it under its
    name, or with `download` False opening it in the browser), or its
    snapshot rendered again (`pdf`, when the caller has just rendered it,
    saves that). Raises resume_render.TectonicUnavailable when the PDF
    cannot be made, and whatever Storage raises: the caller says what failed."""
    name = download_name(row)
    if row.storage_path is not None:
        return SentFile(name, url=await file_url(storage, row, download=download))
    if pdf is not None:  # a send that just rendered it: a built resume's, so no original text
        return SentFile(name, pdf=pdf, rebuilt=rebuilt(row))
    data = json.loads(gzip.decompress(await session.scalar(
        select(Resume_Snapshot.data).where(Resume_Snapshot.id == row.snapshot_id))))
    identity = HeaderIdentity(**{**data["identity"], "links": tuple(map(tuple, data["identity"]["links"]))})
    rendered = await asyncio.to_thread(render, view_from_json(data["view"]), identity, data["template"])
    return SentFile(name, pdf=rendered.pdf, rebuilt=rebuilt(row), original_text=data.get("raw_text"))


async def file_url(storage: Any, row: Sent_Resume, *, download: bool = True) -> str:
    """A link to the row's stored file for FILE_URL_TTL_SECONDS, that
    downloads it under its download name, or opens it in the browser. Raises
    whatever Storage raises: the caller says what failed."""
    signed = await asyncio.to_thread(
        storage.from_(BUCKET).create_signed_url,
        row.storage_path,
        FILE_URL_TTL_SECONDS,
        {"download": download_name(row)} if download else {},
    )
    return signed.get("signedUrl")


def download_name(row: Sent_Resume) -> str:
    """The file name a download is saved under. A row with no hash came from
    an uploaded resume, whose name is its original filename. A snapshot is
    always a PDF."""
    stem = row.name.rsplit(".", 1)[0] if row.content_hash is None else row.name
    ext = row.storage_path.rsplit(".", 1)[-1] if row.storage_path else "pdf"
    return built_resumes.file_name(stem, ext)
