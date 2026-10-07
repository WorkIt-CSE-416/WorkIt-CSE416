"""Request/response shapes for the applicant profile (GET + PATCH)."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ApplicantProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    full_name: str
    phone_number: str | None
    headline: str | None
    linkedin_url: str | None
    portfolio_url: str | None
    github_url: str | None
    other_url: str | None


class ApplicantProfileUpdate(BaseModel):
    """PATCH body. Only fields present in the JSON are applied;
    use model.model_fields_set to tell sent-as-null from omitted."""

    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str | None = Field(None, min_length=1, max_length=50)
    phone_number: str | None = Field(None, max_length=30)
    headline: str | None = Field(None, max_length=50)
    linkedin_url: str | None = None
    portfolio_url: str | None = None
    github_url: str | None = None
    other_url: str | None = None
