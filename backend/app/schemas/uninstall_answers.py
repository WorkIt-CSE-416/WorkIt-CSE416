"""POST /uninstall-answers (KAN-471): one of the survey's reasons, an
optional line of the student's own and the extension's version. Any other
key is refused (422), never stored."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.extension_config import EXTENSION_VERSION

Reason = Literal["bad_fills", "missing_sites", "found_job", "other_tool", "privacy", "other"]


class UninstallAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: Reason
    detail: str | None = Field(default=None, max_length=500)
    # manifest.json's version: up to four dot-separated numbers.
    version: str | None = Field(default=None, max_length=32, pattern=EXTENSION_VERSION)

    @field_validator("detail")
    @classmethod
    def blank_is_none(cls, detail: str | None) -> str | None:
        return (detail or "").strip() or None
