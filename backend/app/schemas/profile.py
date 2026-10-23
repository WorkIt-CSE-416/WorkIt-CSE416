"""Request/response shapes for the applicant profile (GET + PATCH)."""

from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from pydantic_core import PydanticCustomError


class ApplicantProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    # NULL means the sign-in email (Applicant_Profile.email_for_employers).
    contact_email: str | None
    full_name: str
    phone_number: str | None
    headline: str | None
    location: str | None
    linkedin_url: str | None
    portfolio_url: str | None
    github_url: str | None
    other_url: str | None


LINK_FIELDS = ("linkedin_url", "portfolio_url", "github_url", "other_url")


def web_link(value: str | None) -> str | None:
    """A link as stored: an http(s) address with a host that has a dot.
    "linkedin.com/in/jake" gains "https://", so every reader can put it in an
    href as it is. Anything else, a "javascript:" link included, is refused:
    the Profile page and the resume headers make these clickable."""
    if not value:
        return None
    if "://" not in value:
        value = f"https://{value}"
    parts = urlsplit(value)
    host = parts.hostname or ""
    if parts.scheme.lower() not in ("http", "https") or "." not in host or " " in value:
        # A custom error, so the 422's msg has no "Value error, " in front.
        raise PydanticCustomError(
            "web_link", "Enter a web address, such as linkedin.com/in/your-name"
        )
    return value


class ApplicantProfileUpdate(BaseModel):
    """PATCH body. Only fields present in the JSON are applied;
    use model.model_fields_set to tell sent-as-null from omitted.
    An empty string clears a field, the same as null."""

    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str | None = Field(None, min_length=1, max_length=50)
    contact_email: EmailStr | None = Field(None, max_length=100)
    phone_number: str | None = Field(None, max_length=30)
    headline: str | None = Field(None, max_length=50)
    location: str | None = Field(None, max_length=100)
    linkedin_url: str | None = Field(None, max_length=500)
    portfolio_url: str | None = Field(None, max_length=500)
    github_url: str | None = Field(None, max_length=500)
    other_url: str | None = Field(None, max_length=500)

    @field_validator("contact_email", "phone_number", "headline", "location", *LINK_FIELDS, mode="before")
    @classmethod
    def _blank_is_none(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator(*LINK_FIELDS)
    @classmethod
    def _web_link(cls, value: str | None) -> str | None:
        return web_link(value)
