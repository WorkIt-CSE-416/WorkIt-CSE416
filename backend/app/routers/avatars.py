"""
profile picture for applicants 
"""
import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session, get_supabase
from app.deps import assert_applicant_owns, get_current_account
from app.models.profiles import Applicant_Profile
from app.schemas.auth import AuthenticatedAccount
from app.schemas.avatar import AvatarResponse
from app.services.avatar import (
    MAX_UPLOAD_BYTES,
    OUTPUT_EXT,
    OUTPUT_MIME,
    InvalidImageError,
    normalize_avatar,
)

router = APIRouter()
logger = logging.getLogger(__name__)

BUCKET = "Avatar"
# Matches the Supabase access token's lifetime, so a page that is still
# signed in never shows a broken image because its URL ran out first.
SIGNED_URL_TTL_SECONDS = 60 * 60


async def _signed_url(path: str) -> str | None:
    '''
    create short lived url for that path, add the authorized token so browser can access with a TTL
    '''
    client = get_supabase()
    try:
        signed = await asyncio.to_thread(
            client.storage.from_(BUCKET).create_signed_url, path, SIGNED_URL_TTL_SECONDS
        )
    except Exception:
        # Initials are an acceptable fallback; failing the whole profile load
        # over a photo is not.
        logger.exception("Failed to sign avatar URL", extra={"storage_path": path})
        return None
    return signed.get("signedUrl")


async def _remove_file(path: str) -> None:
    """Best-effort delete for a file the database no longer points at. A
    failure orphans the object but loses no data, so it is logged, not raised."""
    try:
        await asyncio.to_thread(get_supabase().storage.from_(BUCKET).remove, [path])
    except Exception:
        logger.exception("Failed to remove avatar from Storage", extra={"storage_path": path})


async def _load_profile(
    session: AsyncSession, applicant_id: uuid.UUID, *, lock: bool = False
) -> Applicant_Profile:
    query = select(Applicant_Profile).where(Applicant_Profile.id == applicant_id)
    if lock:
        # Two uploads racing, wait for the other upload to finish 
        query = query.with_for_update().execution_options(populate_existing=True)
    profile = (await session.execute(query)).scalar_one_or_none()
    if profile is None:
        raise HTTPException(404, "Profile not found")
    return profile


# Any signed-in account may view any applicant's photo. The dependency still
# runs, so an anonymous request is a 401.
@router.get(
    "/applicants/{applicant_id}/avatar",
    response_model=AvatarResponse,
    dependencies=[Depends(get_current_account)],
)
async def get_avatar(
    applicant_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> AvatarResponse:
    profile = await _load_profile(session, applicant_id)
    if not profile.avatar_path:
        return AvatarResponse(url=None)
    return AvatarResponse(url=await _signed_url(profile.avatar_path))


@router.put("/applicants/{applicant_id}/avatar", response_model=AvatarResponse)
async def upload_avatar(
    applicant_id: uuid.UUID,
    file: UploadFile,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> AvatarResponse:
    assert_applicant_owns(account, applicant_id)

    if file.size is not None and file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image must be under 5 MB")
    contents = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image must be under 5 MB")

    # file.content_type is whatever the client claimed; normalize_avatar
    # decides the format from the bytes instead.
    try:
        webp = await asyncio.to_thread(normalize_avatar, contents)
    except InvalidImageError as exc:
        raise HTTPException(400, str(exc)) from exc

    # A fresh name per upload, never an overwrite: browsers and Supabase's
    # CDN cache by URL, and a reused path could keep serving the old face.
    new_path = f"{applicant_id}/{uuid.uuid4()}{OUTPUT_EXT}"
    client = get_supabase()
    try:
        await asyncio.to_thread(
            client.storage.from_(BUCKET).upload,
            new_path,
            webp,
            {"content-type": OUTPUT_MIME},
        )
    except Exception as exc:
        logger.exception("Avatar upload to Storage failed")
        raise HTTPException(502, "Image upload failed") from exc

    try:
        profile = await _load_profile(session, applicant_id, lock=True)
        old_path = profile.avatar_path
        profile.avatar_path = new_path
        await session.commit()
    except Exception as exc:
        await session.rollback()
        await _remove_file(new_path)
        if isinstance(exc, HTTPException):
            raise
        logger.exception("Failed to save avatar path")
        raise HTTPException(500, "Failed to save profile photo") from exc

    # Only after the row points at the new file is the old one unreferenced.
    if old_path:
        await _remove_file(old_path)

    return AvatarResponse(url=await _signed_url(new_path))


@router.delete("/applicants/{applicant_id}/avatar", response_model=AvatarResponse)
async def delete_avatar(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> AvatarResponse:
    assert_applicant_owns(account, applicant_id)

    profile = await _load_profile(session, applicant_id, lock=True)
    old_path = profile.avatar_path
    if old_path:
        profile.avatar_path = None
        await session.commit()
        await _remove_file(old_path)

    return AvatarResponse(url=None)
