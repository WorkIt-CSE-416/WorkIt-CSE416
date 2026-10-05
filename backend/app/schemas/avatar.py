"""Response shape for the avatar routes. Separate from app/models/profiles.py
— the row stores a Storage path, which never leaves this API."""

from pydantic import BaseModel


class AvatarResponse(BaseModel):
    # A short-lived signed URL for the private bucket, or None when the
    # account has no photo and the frontend should draw initials.
    url: str | None
