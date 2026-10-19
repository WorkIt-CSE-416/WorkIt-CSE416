"""Request shapes for uploaded resumes (routers/resumes.py)."""

from pydantic import BaseModel

from app.schemas.built_resume import Name


class ResumeRename(BaseModel):
    """PATCH body: the upload's new name (KAN-268). The route keeps the
    stored file's extension on it."""

    name: Name
