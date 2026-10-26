"""POST /fill-reports (KAN-403): the only shape a problem report may have.
Every model forbids other keys, so an answer, a reason or the page's text
is refused (422), never stored."""

import re
from typing import Literal
from urllib.parse import parse_qsl, urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator

# The extension's error names (autofiller_extension/src/content/report.js ERRORS).
ErrorName = Literal["Readback", "FillError", "Handoff", "NoForm", "NoAnswer", "Error"]

# The query params a posting link keeps: the ones that say which posting the
# page is (Greenhouse's embed ?for=<board>&token=<id>, a careers page's
# ?gh_jid=, an ?jobId= or similar), each an id of letters, digits and . _ -.
# Any other param (a tracking source, an email) is refused, never stored.
POSTING_PARAMS = frozenset({"for", "token", "gh_jid", "jobId", "job_id", "jobid", "jobReqId", "career_job_req_id"})
POSTING_ID = re.compile(r"[A-Za-z0-9._-]{1,100}")


class FillReportField(BaseModel):
    """One failed field: its kind, its label's shape (lower-case letters, # for digits, spaces), its error's name."""

    model_config = ConfigDict(extra="forbid")

    kind: str = Field(pattern=r"^[a-z_-]{1,24}$")
    label_shape: str = Field(max_length=120)
    error: ErrorName

    @field_validator("label_shape")
    @classmethod
    def _shape_only(cls, value: str) -> str:
        if not all(c.isalpha() or c in "# " for c in value):
            raise ValueError("a label shape holds only letters, # and spaces")
        return value


class FillReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_system: str = Field(pattern=r"^[a-z_]{1,24}$")
    posting_url: str = Field(max_length=2000)
    engine_version: str = Field(pattern=r"^[\w.+-]{1,64}$")
    fields: list[FillReportField] = Field(max_length=200)
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("posting_url")
    @classmethod
    def _public_link(cls, value: str) -> str:
        parts = urlsplit(value)
        if parts.scheme not in ("http", "https") or not parts.netloc or parts.fragment or "@" in parts.netloc:
            raise ValueError("the posting's link, http or https with no sign-in or fragment")
        try:
            params = parse_qsl(parts.query, keep_blank_values=True, strict_parsing=bool(parts.query))
        except ValueError:
            raise ValueError("the posting link's query is not key=value pairs") from None
        for key, param in params:
            if key not in POSTING_PARAMS or not POSTING_ID.fullmatch(param):
                raise ValueError(f"the posting's link keeps only the params naming the posting ({key!r} isn't one)")
        return value


class FillReportStored(BaseModel):
    id: str
