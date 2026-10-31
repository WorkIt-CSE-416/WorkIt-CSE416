"""The fill report's shapes (KAN-403, KAN-369 fix reports).

POST /fill-reports takes only FillReportRequest: every model forbids other
keys, so a value the student typed can't ride along under a new name (422).
The extension takes values out before it sends (its preview shows what is
sent); `scrub` here takes out what still looks like an email or a phone
number, a second line behind it. The rest are the answers of the student's
and the admins' reads (routers/fill_reports.py)."""

import datetime
import re
from typing import Literal
from urllib.parse import parse_qsl, urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator

# The extension's error names (autofiller_extension/src/shared/report-parts.js ERRORS).
ErrorName = Literal["Readback", "FillError", "Handoff", "NoForm", "NoAnswer", "Error"]
# What opened the report card (report-parts.js TRIGGERS): the ⋯ menu, a fill's error, a field that
# failed read-back, a field the student edited after WorkIt filled it, a row they marked wrong.
Trigger = Literal["menu", "error", "readback", "edited", "row"]
Status = Literal["new", "triaged", "fixed"]
# How a field read back (report-parts.js READBACKS).
Readback = Literal["matches", "differs", "empty", "unread"]

# The query params a posting link keeps: the ones that say which posting the
# page is (Greenhouse's embed ?for=<board>&token=<id>, a careers page's
# ?gh_jid=, an ?jobId= or similar), each an id of letters, digits and . _ -.
# Any other param (a tracking source, an email) is refused, never stored.
POSTING_PARAMS = frozenset({"for", "token", "gh_jid", "jobId", "job_id", "jobid", "jobReqId", "career_job_req_id"})
POSTING_ID = re.compile(r"[A-Za-z0-9._-]{1,100}")

# The largest form snapshot and request body taken. A big Workday step's form, its values out, is about
# 150 KB; the cap leaves room and keeps a page's script from filling the table.
HTML_MAX = 512_000
BODY_MAX = 1_000_000

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# A phone number written as one: an optional +country, then 3-3-4 digits with separators, or 10+ digits after a +.
_PHONE = re.compile(r"(?<![\w])(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w])|\+\d{10,14}(?!\d)")


def scrub(value: str | None) -> str | None:
    """`value` with what looks like an email or a phone number replaced by «email» / «phone»."""
    if value is None:
        return None
    return _PHONE.sub("«phone»", _EMAIL.sub("«email»", value))


def _public_link(value: str) -> str:
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


class FillReportField(BaseModel):
    """
    One field of the form. `kind`, `label_shape` and `error` are KAN-403's
    (a failed field's). The rest came with fix reports, each optional:
    the field's `name` (the engine's Question name), its `label` and
    `options` as the form words them (values out), `required`, the
    `selector` the extension found it by and whether it was `visible`; the
    Plan's `source` for it and the `planned` answer's shape ("text:12", a
    choice, a file; never the answer), the fill's `status` and `reason`
    (values out), how it read back and what it `shows` (a shape again);
    `marked`: the student marked it wrong; `edited`: they changed it after
    WorkIt filled it.
    """

    model_config = ConfigDict(extra="forbid")

    kind: str = Field(pattern=r"^[a-z_-]{1,24}$")
    label_shape: str = Field(max_length=120)
    error: ErrorName | None = None
    name: str | None = Field(default=None, max_length=200)
    label: str | None = Field(default=None, max_length=300)
    required: bool | None = None
    options: list[str] | None = Field(default=None, max_length=100)
    selector: str | None = Field(default=None, max_length=500)
    visible: bool | None = None
    source: str | None = Field(default=None, pattern=r"^[a-z_]{1,24}$")
    planned: str | None = Field(default=None, pattern=r"^[a-z]{1,12}(:\d{1,6})?$")
    status: str | None = Field(default=None, pattern=r"^[a-z_]{1,24}$")
    reason: str | None = Field(default=None, max_length=500)
    readback: Readback | None = None
    shows: str | None = Field(default=None, pattern=r"^[a-z]{1,12}(:\d{1,6})?$")
    marked: bool = False
    edited: bool = False

    @field_validator("label_shape")
    @classmethod
    def _shape_only(cls, value: str) -> str:
        if not all(c.isalpha() or c in "# " for c in value):
            raise ValueError("a label shape holds only letters, # and spaces")
        return value

    @field_validator("options")
    @classmethod
    def _short_options(cls, value: list[str] | None) -> list[str] | None:
        if value is not None and any(len(option) > 200 for option in value):
            raise ValueError("an option is at most 200 characters")
        return value


class Recognition(BaseModel):
    """What the Fill engine's jobOf made of the page: its job system, whether it is the form, and the posting's ids."""

    model_config = ConfigDict(extra="forbid")

    site: str = Field(pattern=r"^[a-z_]{1,24}$")
    on_form: bool | None = None
    ids: dict[str, str] = Field(default_factory=dict, max_length=8)

    @field_validator("ids")
    @classmethod
    def _plain_ids(cls, value: dict[str, str]) -> dict[str, str]:
        for key, id_ in value.items():
            if not re.fullmatch(r"[A-Za-z_]{1,24}", key) or not POSTING_ID.fullmatch(id_):
                raise ValueError("an id is letters, digits and . _ -")
        return value


class ReportContext(BaseModel):
    """Where and with what the report was made."""

    model_config = ConfigDict(extra="forbid")

    extension_version: str = Field(pattern=r"^[\w.+-]{1,32}$")
    browser: str = Field(max_length=120)
    captured_at: datetime.datetime
    recognition: Recognition | None = None
    # The page's address after the job system's own redirects, kept as posting_url is (and checked the same way).
    page_url: str | None = Field(default=None, max_length=2000)
    frame: Literal["top", "iframe"] = "top"
    step: str | None = Field(default=None, max_length=120)

    @field_validator("page_url")
    @classmethod
    def _page_link(cls, value: str | None) -> str | None:
        return value if value is None else _public_link(value)


class TimelineEntry(BaseModel):
    """One step of the fill: `t` ms after the page's first plan, its `kind` (plan, fill, field, error, ...), and what it said (values out)."""

    model_config = ConfigDict(extra="forbid")

    t: int = Field(ge=0, le=86_400_000)
    kind: str = Field(pattern=r"^[a-z_:-]{1,32}$")
    field: str | None = Field(default=None, max_length=200)
    status: str | None = Field(default=None, pattern=r"^[a-z_]{1,24}$")
    message: str | None = Field(default=None, max_length=500)
    stack: str | None = Field(default=None, max_length=4000)


class FillReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_system: str = Field(pattern=r"^[a-z_]{1,24}$")
    posting_url: str = Field(max_length=2000)
    engine_version: str = Field(pattern=r"^[\w.+-]{1,64}$")
    fields: list[FillReportField] = Field(max_length=300)
    note: str | None = Field(default=None, max_length=1000)
    trigger: Trigger | None = None
    context: ReportContext | None = None
    timeline: list[TimelineEntry] | None = Field(default=None, max_length=400)
    html: str | None = Field(default=None, max_length=HTML_MAX)

    @field_validator("posting_url")
    @classmethod
    def _posting_link(cls, value: str) -> str:
        return _public_link(value)

    def scrubbed(self) -> dict:
        """The report as stored: JSON without the parts not given (nor a field's false marked / edited), scrub run over every free text."""
        report = self.model_dump(mode="json", exclude_none=True)
        for key in ("note", "html"):
            if key in report:
                report[key] = scrub(report[key])
        for field in report["fields"]:
            for part in ("label", "reason"):
                if part in field:
                    field[part] = scrub(field[part])
            if "options" in field:
                field["options"] = [scrub(option) for option in field["options"]]
            for flag in ("marked", "edited"):
                if not field[flag]:
                    del field[flag]
        for entry in report.get("timeline", []):
            for part in ("message", "stack"):
                if part in entry:
                    entry[part] = scrub(entry[part])
        return report


def signature_of(report: dict) -> str:
    """
    The report's group (KAN-478): "<job system>:<field kind>:<error>", for the
    field it is about: the first that went wrong, else the first the student
    marked ("Marked"), else none ("<job system>::"). Twenty students hitting
    one broken field send one signature.
    """
    fields = report.get("fields") or []
    field = next((f for f in fields if f.get("error")), None) or next((f for f in fields if f.get("marked")), None)
    if field is None:
        return f"{report['job_system']}::"
    return f"{report['job_system']}:{field['kind']}:{field.get('error') or 'Marked'}"


class FillReportStored(BaseModel):
    id: str


class FillReportSummary(BaseModel):
    """A report in a list: the student's own (GET /fill-reports/mine) and the admins' (GET /admin/fill-reports)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime.datetime
    job_system: str
    posting_url: str
    engine_version: str
    status: Status
    trigger: Trigger | None
    note: str | None
    field_count: int
    marked: list[str]
    signature: str


class FillReportList(BaseModel):
    reports: list[FillReportSummary]
    total: int


class FillReportDetail(FillReportSummary):
    """One report, whole: what the student sent, and the team's triage."""

    fields: list[dict]
    context: dict | None
    timeline: list[dict] | None
    html: str | None
    admin_note: str | None
    updated_at: datetime.datetime | None


class FillReportGroup(BaseModel):
    """Reports with one signature (signature_of): its parts, how many, when, the newest's id, and their engine versions."""

    signature: str
    job_system: str
    field_kind: str | None
    error: str | None
    count: int
    first_at: datetime.datetime
    last_at: datetime.datetime
    latest_id: str
    engine_versions: list[str]


class FillReportGroups(BaseModel):
    groups: list[FillReportGroup]


class FillReportTriage(BaseModel):
    """PATCH /admin/fill-reports/{id}: a new status, a note, or both."""

    model_config = ConfigDict(extra="forbid")

    status: Status | None = None
    admin_note: str | None = Field(default=None, max_length=4000)
