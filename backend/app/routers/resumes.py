"""Resumes under /applicants/{applicant_id}/resumes: upload, list, delete.

Upload (POST) extracts text from a PDF or DOCX into `raw_text`, always from
the file (the client never sends parsed content), reads it with the
heuristic parser and writes what it read into the experience bank with
`services/bank.py`'s `import_upload`, as entries and skills the upload owns
(ADR 0005), in the same transaction as the row. The response's `bank` says what it wrote (`ImportResult`); the
parser's reading is not kept anywhere else. The model never reads an upload
by itself: the student asks for that through Import Again
(`POST /applicants/{id}/bank/import`). `GET .../{resume_id}` returns one
resume as the list does.
**The parse preview** (KAN-372, ADR 0006): `POST .../preview` takes a file
as upload does and answers what the parser reads in it (`ResumePreview`),
saving nothing: each entry and skill lists the other uploads' rows a
confirm would replace, and `duplicate_of` names an upload with the same
text. The student confirms by uploading the same file with
`?replace=matching`, which also deletes those rows in the upload's
transaction (`bank.import_upload`).
**Duplicates** (KAN-267): an upload whose text matches one of the student's
uploads (`text_hash`, which says what "matches" means) answers 409
`{"detail": {"message": "Duplicate Resume found: <name>", "resume_id"}}`
before anything is stored; Import Updated Resume checks the student's other
uploads. Checked before the 5-upload limit, so a student at the limit still
learns the file is already there.
`PUT .../{resume_id}` (a file, as upload takes it) is Import Updated Resume:
it replaces the row's file with a newer version and reads it into the bank
the same way. The row keeps its id, so the primary star stays; the file
goes to a new Storage path, because a sent resume may still point at the
old one, which is removed only when nothing uses it. **Replace and delete
freeze first** (KAN-267, `sent_resumes.freeze_upload`): the sent resumes
that point at the old file become a snapshot of its text, in the same
commit, so the file is no longer in use and goes; one with no readable
text keeps the file. It replaces the
upload's entries and skills with the new reading (ADR 0005), so what the
old file held goes, with the student's edits to it. It answers what upload
answers.
`PATCH .../{resume_id}` ({"name"}) renames it (KAN-268): the name is the
row's `original_filename`, which every screen shows and a DOCX downloads
under, so it keeps the stored file's extension. Import Updated Resume
then names the row after the new file again.
`PUT .../{resume_id}/default` makes it the default resume
(`applicant_profiles.default_resume_id`; the list reports it as `is_default`),
clearing a built resume that was the default. A student's only resume is
the default without a click: upload and delete set it
(`built_resumes.default_if_only`). Upload answers 409 when the
student already has 5 uploads; generated resumes do not count (KAN-268,
`app/services/built_resumes.py`).
`GET .../{resume_id}/file` returns a 5-minute signed URL: inline for a PDF, a
download under the original filename for a DOCX. `?download=true` makes a PDF
download too: the row's Download button (KAN-268).
`GET .../{resume_id}/bytes` returns the file itself from this API's own
origin, for the Chrome autofiller (`autofiller_extension/`) to attach to an
ATS's resume field — signed URLs go to Storage's own domain, which the
extension's `host_permissions` doesn't cover.
`DELETE .../{resume_id}` removes the row, and its stored file unless a sent
resume still uses it (`app/services/sent_resumes.py`, KAN-208).
"""
import asyncio
import hashlib
import logging
import unicodedata
import uuid
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session, get_supabase
from app.deps import assert_applicant_owns, get_current_account
from app.models.dto import ResumeStatus
from app.models.profiles import Applicant_Profile
from app.models.resume import Resume
from app.schemas.auth import AuthenticatedAccount
from app.schemas.bank import (
    ImportResult,
    PreviewDuplicate,
    PreviewEntry,
    PreviewSkill,
    ResumePreview,
)
from app.schemas.resume import ResumeRename
from app.services import (
    bank,
    bank_import,
    built_resumes,
    local_files,
    sent_resumes,
    stored_files,
)
from app.services.stored_files import BUCKET
from app.services.text_extraction import UploadRejected
from app.services.text_extraction import extract as _extract
from app.services.text_extraction import read_upload as _read_upload
from app.services.usage import Feature, uses_left

router = APIRouter()
logger = logging.getLogger(__name__)

# The preview link is opened the moment it is made; this only has to outlast
# the browser's PDF viewer loading a 5 MB file.
FILE_URL_TTL_SECONDS = 5 * 60


def text_hash(raw_text: str | None) -> str | None:
    '''The duplicate check's key (KAN-267): sha256 of the resume's text, so
    the same resume exported again (new bytes, same words) is caught. NFKC
    makes a PDF's ligatures plain letters, and every run of whitespace
    becomes one space, so moved line breaks and column gaps don't count;
    case does. No text, no hash: such an upload is never matched.

    Changing this or `_extract` makes the hashes already stored stale: an old
    upload stops matching a new one of the same resume (a duplicate gets
    through; a new resume is never refused).'''
    words = " ".join(unicodedata.normalize("NFKC", raw_text or "").split())
    return hashlib.sha256(words.encode()).hexdigest() if words else None


async def _duplicate_of(
    session: AsyncSession, applicant_id: uuid.UUID, digest: str | None, *, besides: uuid.UUID | None = None
) -> Resume | None:
    '''The applicant's uploaded resume with this text, other than `besides`.'''
    if digest is None:
        return None
    query = select(Resume).where(Resume.applicant_id == applicant_id, Resume.text_hash == digest)
    if besides is not None:
        query = query.where(Resume.id != besides)
    return await session.scalar(query)


def _duplicate(resume: Resume) -> HTTPException:
    # A dict detail: the message to show, and which resume it is, for a
    # screen that selects it (docs/sent_resume.md, flow 1).
    return HTTPException(409, {
        "message": f"Duplicate Resume found: {resume.original_filename or 'Uploaded resume'}",
        "resume_id": str(resume.id),
    })


@router.post("/applicants/{applicant_id}/resumes/preview", response_model=ResumePreview)
async def preview_resume(
    applicant_id: uuid.UUID,
    file: UploadFile,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    """The parse preview (KAN-372, ADR 0006): the file read as an upload
    reads it, with nothing saved: no Storage file, no row, no bank write. The
    student confirms by uploading the same file with `?replace=matching`."""
    assert_applicant_owns(account, applicant_id)
    try:
        contents, ext, _ = await _read_upload(file)
    except UploadRejected as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    raw_text = await _extract(contents, ext)
    entries, skills = bank_import.read(raw_text)
    same = await _duplicate_of(session, applicant_id, text_hash(raw_text))
    matches = await bank.upload_matches(session, applicant_id, entries, skills)
    return ResumePreview(
        entries=[PreviewEntry(**e.model_dump(), replaces=ids) for e, ids in zip(entries, matches.entries)],
        skills=[PreviewSkill(name=name, group=group, replaces=ids)
                for (name, group), ids in zip(skills, matches.skills)],
        duplicate_of=None if same is None else PreviewDuplicate(
            resume_id=same.id, name=same.original_filename or "Uploaded resume"),
    )


# Depends grabs get_session before function runs and passes the session into function.
# FastAPI handles the lifecycle

@router.post("/applicants/{applicant_id}/resumes")
async def upload_resume(
    applicant_id: uuid.UUID,
    file: UploadFile,
    # "matching": the upload confirms a parse preview, and replaces the
    # entries and skills of other uploads its reading matches (ADR 0006).
    replace: Literal["matching"] | None = Query(None),
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session)
):
    assert_applicant_owns(account, applicant_id)

    try:
        contents, ext, mime = await _read_upload(file)
    except UploadRejected as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    # raw_text always comes from the file, never from the client. Read before
    # the Storage upload, so a duplicate leaves no file behind.
    raw_text = await _extract(contents, ext)
    digest = text_hash(raw_text)
    if (same := await _duplicate_of(session, applicant_id, digest)) is not None:
        raise _duplicate(same)
    # Before the Storage upload, so a rejected sixth leaves no file behind
    try:
        await built_resumes.check_room(session, applicant_id)
    except built_resumes.ResumeLimitReached as exc:
        raise HTTPException(409, str(exc))

    resume_id = uuid.uuid4()
    storage_path = f"{applicant_id}/{resume_id}{ext}"


    # Upload to Storage
    client = get_supabase()
    try:
        await asyncio.to_thread(
            client.storage.from_(BUCKET).upload,
            storage_path,
            contents,
            {"content-type": mime},
        )
    except Exception:
        logger.exception("Storage upload failed",
                         extra={"storage_path": storage_path})
        raise HTTPException(502, "File upload failed")


    entries, skills = bank_import.read(raw_text)

    # Resume ORM object
    resume = Resume(
        id=resume_id,
        applicant_id=applicant_id,
        original_filename=file.filename,
        raw_text=raw_text,
        text_hash=digest,
        storage_path=storage_path,
        status=ResumeStatus.parsed if entries or skills else ResumeStatus.parse_failed,
        created_at=datetime.now(UTC),
    )

    # The row and what it adds to the bank commit together (ADR 0003).
    try:
        session.add(resume)
        # The bank's entries point at the resume, and no relationship()
        # orders the inserts (models/CLAUDE.md).
        await session.flush()
        imported = await bank.import_upload(
            session, applicant_id, resume.id, entries, skills, replace_matching=replace == "matching")
        left = await uses_left(session, applicant_id, Feature.PARSING)
        await built_resumes.default_if_only(session, applicant_id)
        default_id = await _default_id(session, applicant_id)
        await session.commit()
    except Exception as exc:
        await session.rollback()
        # DB failed - remove the file from Storage
        await stored_files.remove(get_supabase, storage_path, "Failed to remove orphaned file from Storage")
        await _raise_if_raced(session, exc, applicant_id, digest)
        raise HTTPException(500, "Failed to save resume record")

    return _imported(resume, resume.id == default_id, entries, skills, imported, left)


async def _raise_if_raced(
    session: AsyncSession, exc: Exception, applicant_id: uuid.UUID, digest: str | None,
    besides: uuid.UUID | None = None,
) -> None:
    '''After a failed commit: when another request saved the same text first,
    `resumes_text_hash_key` refused this one, so say it is a duplicate.'''
    if isinstance(exc, IntegrityError):
        same = await _duplicate_of(session, applicant_id, digest, besides=besides)
        if same is not None:
            raise _duplicate(same) from exc


@router.put("/applicants/{applicant_id}/resumes/{resume_id}")
async def replace_resume(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    file: UploadFile,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    """Import Updated Resume: a newer version of the file on this row, read
    into the bank as an upload is. No limit check, since the count stays.
    The duplicate check skips this row: the same text in a new layout is how
    a student swaps the file."""
    assert_applicant_owns(account, applicant_id)
    resume = await _get_owned_resume(session, applicant_id, resume_id)
    try:
        contents, ext, mime = await _read_upload(file)
    except UploadRejected as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    raw_text = await _extract(contents, ext)
    digest = text_hash(raw_text)
    if (same := await _duplicate_of(session, applicant_id, digest, besides=resume.id)) is not None:
        raise _duplicate(same)
    # The old file's sent resumes become a snapshot of its text (KAN-267),
    # read while the row still holds that text; it commits with the
    # replacement, and the old file then goes as nothing uses it.
    try:
        await sent_resumes.freeze_upload(session, applicant_id, resume)
    except SQLAlchemyError:
        await session.rollback()
        logger.exception("Failed to keep the sent resumes of a replaced resume")
        raise HTTPException(500, "Failed to save resume record")

    # A new path, never the old one: a sent resume may point at the old
    # file (one with no text stays a file), and a sent resume's file never
    # changes (KAN-208).
    old_path = resume.storage_path
    storage_path = f"{applicant_id}/{uuid.uuid4()}{ext}"
    client = get_supabase()
    try:
        await asyncio.to_thread(
            client.storage.from_(BUCKET).upload,
            storage_path,
            contents,
            {"content-type": mime},
        )
    except Exception:
        logger.exception("Storage upload failed", extra={"storage_path": storage_path})
        raise HTTPException(502, "File upload failed")

    entries, skills = bank_import.read(raw_text)

    resume.original_filename = file.filename
    resume.raw_text = raw_text
    resume.text_hash = digest
    resume.storage_path = storage_path
    resume.status = ResumeStatus.parsed if entries or skills else ResumeStatus.parse_failed
    # The row says when its file was uploaded, and this one was uploaded now.
    resume.created_at = datetime.now(UTC)

    try:
        # A newer file: its reading replaces what the old one held (ADR 0005).
        imported = await bank.import_upload(session, applicant_id, resume.id, entries, skills)
        left = await uses_left(session, applicant_id, Feature.PARSING)
        default_id = await _default_id(session, applicant_id)
        await session.commit()
    except Exception as exc:
        await session.rollback()
        await stored_files.remove(get_supabase, storage_path, "Failed to remove orphaned file from Storage")
        await _raise_if_raced(session, exc, applicant_id, digest, besides=resume_id)
        raise HTTPException(500, "Failed to save resume record")

    if old_path and not await sent_resumes.file_in_use(session, old_path):
        await stored_files.remove(get_supabase, old_path, "Failed to remove replaced resume file from Storage")

    return _imported(resume, resume.id == default_id, entries, skills, imported, left)


def _imported(resume: Resume, is_default: bool, entries, skills, imported, left: int) -> dict:
    """An uploaded file's row and what its reading wrote into the bank."""
    return {
        "id": str(resume.id),
        "applicant_id": str(resume.applicant_id),
        "original_filename": resume.original_filename,
        "raw_text": resume.raw_text,
        "storage_path": resume.storage_path,
        "status": resume.status,
        "is_default": is_default,
        "created_at": resume.created_at.isoformat() if resume.created_at else None,
        "bank": ImportResult(
            found=len(entries) + len(skills),
            entries_added=imported.entries_added,
            skills_added=imported.skills_added,
            entries_replaced=imported.entries_replaced,
            skills_replaced=imported.skills_replaced,
            uses_left=left,
        ).model_dump(),
    }


@router.get("/applicants/{applicant_id}/resumes")
async def list_resumes(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    assert_applicant_owns(account, applicant_id)

    result = await session.execute(
        select(Resume)
        .where(Resume.applicant_id == applicant_id)
        .order_by(Resume.created_at.desc())
    )

    resumes = result.scalars().all()
    default_id = await _default_id(session, applicant_id)
    return [_item(r, default_id) for r in resumes]


async def _default_id(session: AsyncSession, applicant_id: uuid.UUID) -> uuid.UUID | None:
    # The primary resume lives on the profile, not on the resume rows.
    return await session.scalar(
        select(Applicant_Profile.default_resume_id).where(Applicant_Profile.id == applicant_id)
    )


def _item(r: Resume, default_id: uuid.UUID | None) -> dict:
    return {
        "id": str(r.id),
        "applicant_id": str(r.applicant_id),
        "original_filename": r.original_filename,
        "storage_path": r.storage_path,
        "status": r.status,
        "is_default": r.id == default_id,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


async def _get_owned_resume(
    session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID
) -> Resume:
    resume = (
        await session.execute(
            select(Resume).where(Resume.id == resume_id, Resume.applicant_id == applicant_id)
        )
    ).scalar_one_or_none()
    if not resume:
        raise HTTPException(404, "Resume not found")
    return resume


@router.get("/applicants/{applicant_id}/resumes/{resume_id}")
async def get_resume(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    assert_applicant_owns(account, applicant_id)
    resume = await _get_owned_resume(session, applicant_id, resume_id)
    return _item(resume, await _default_id(session, applicant_id))


@router.patch("/applicants/{applicant_id}/resumes/{resume_id}")
async def rename_resume(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    body: ResumeRename,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    """A new name for the upload. Without the extension a DOCX would
    download as a file no program opens, so a name without the stored
    file's extension gets it."""
    assert_applicant_owns(account, applicant_id)
    resume = await _get_owned_resume(session, applicant_id, resume_id)
    ext = PurePosixPath(resume.storage_path or "").suffix
    name = body.name
    if ext and not name.lower().endswith(ext.lower()):
        name += ext
    resume.original_filename = name
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        logger.exception("Failed to rename resume", extra={"resume_id": str(resume_id)})
        raise HTTPException(500, "Failed to rename the resume")
    return _item(resume, await _default_id(session, applicant_id))


@router.put("/applicants/{applicant_id}/resumes/{resume_id}/default")
async def set_default_resume(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    """Make this the applicant's default resume. It is a pointer on the profile
    (default_resume_id, ON DELETE SET NULL), so deleting the resume clears it;
    a base resume that was the default stops being it."""
    assert_applicant_owns(account, applicant_id)
    resume = await _get_owned_resume(session, applicant_id, resume_id)
    await built_resumes.set_default(session, applicant_id, uploaded_id=resume.id)
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        logger.exception("Failed to set default resume", extra={"resume_id": str(resume_id)})
        raise HTTPException(500, "Failed to set the primary resume")
    return {"default_resume_id": str(resume.id)}


@router.get("/applicants/{applicant_id}/resumes/{resume_id}/file")
async def get_resume_file_url(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    download: bool = Query(False),
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    """A short-lived link to the uploaded file, for the profile's preview. A
    browser shows a PDF itself; it can't show a DOCX, so that link downloads
    the file under its name, as every link does with `download`."""
    assert_applicant_owns(account, applicant_id)
    resume = await _get_owned_resume(session, applicant_id, resume_id)
    # A local file (services/local_files.py) has no Storage link.
    if not resume.storage_path or local_files.is_local(resume.storage_path):
        raise HTTPException(404, "Resume file not found")
    options = (
        {} if resume.storage_path.endswith(".pdf") and not download
        else {"download": resume.original_filename or True}
    )
    try:
        signed = await asyncio.to_thread(
            get_supabase().storage.from_(BUCKET).create_signed_url,
            resume.storage_path,
            FILE_URL_TTL_SECONDS,
            options,
        )
    except Exception:
        logger.exception("Failed to sign resume URL", extra={"storage_path": resume.storage_path})
        raise HTTPException(502, "Could not open the resume")
    return {"url": signed.get("signedUrl")}


@router.get("/applicants/{applicant_id}/resumes/{resume_id}/bytes")
async def get_resume_file_bytes(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """The file itself, from this API's own origin — for the Chrome
    autofiller (`autofiller_extension/`), which cannot rely on a signed
    Storage URL the way the webapp's preview link above does: its
    `manifest.json` host_permissions cover this API's origins, never
    Storage's, so a fetch to a signed URL is subject to whatever CORS
    policy the Storage bucket happens to have, not this app's. Routing the
    bytes through here instead needs no such assumption, at the cost of a
    server round trip through Storage and this app at attach-time instead of
    a direct browser-to-Storage fetch. A local resume (`local:<name>`,
    services/local_files.py; development only) comes from LOCAL_FILES_DIR,
    never Storage: 404 when the folder is unset or lacks it."""
    assert_applicant_owns(account, applicant_id)
    resume = await _get_owned_resume(session, applicant_id, resume_id)
    if not resume.storage_path:
        raise HTTPException(404, "Resume file not found")
    try:
        data = await stored_files.read(get_supabase, resume.storage_path)
    except Exception:
        logger.exception("Failed to download resume file", extra={"storage_path": resume.storage_path})
        raise HTTPException(502, "Could not open the resume")
    if data is None:
        raise HTTPException(404, "Resume file not found")
    ext = PurePosixPath(resume.storage_path).suffix.lower()
    filename = resume.original_filename or f"resume{ext}"
    return Response(
        data,
        media_type=stored_files.media_type(resume.storage_path),
        headers={"Content-Disposition": stored_files.attachment(filename)},
    )


@router.delete("/applicants/{applicant_id}/resumes/{resume_id}")
async def delete_resume(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    assert_applicant_owns(account, applicant_id)

    resume = await _get_owned_resume(session, applicant_id, resume_id)

    # Delete DB row first (reversible via rollback), then Storage. Its sent
    # resumes become a snapshot of its text first (KAN-267), in the same
    # commit, so the file is no longer in use.
    storage_path = resume.storage_path
    try:
        await sent_resumes.freeze_upload(session, applicant_id, resume)
        await session.delete(resume)
        await built_resumes.default_if_only(session, applicant_id)
        await session.commit()
    except Exception:
        await session.rollback()
        raise HTTPException(500, "Failed to delete resume record")

    # A sent resume still pointing at this file (its text gave nothing to
    # rebuild from) keeps it (KAN-208); deleting that sent resume later
    # removes the file once nothing uses it.
    if await sent_resumes.file_in_use(session, storage_path):
        return {"detail": "Resume deleted"}
    # DB succeeded: now remove the file (best effort; the row is gone).
    await stored_files.remove(get_supabase, storage_path, "Failed to remove resume file from Storage")
    return {"detail": "Resume deleted"}