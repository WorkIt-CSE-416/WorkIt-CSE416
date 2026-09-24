"""
Request/response shapes for signup and /auth/me. Separate from
app/models/profiles.py on purpose — see backend/CLAUDE.md: "SQLAlchemy models
and Pydantic schemas are separate layers." There is no login request here:
login goes straight from the Next server to Supabase Auth and never reaches
this API with a password (backend/CLAUDE.md's Auth section).
"""

from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field

# Case shouldn't matter for an email address — "Jane@Example.com" and
# "jane@example.com" are the same account — but it must for a password.
# Supabase Auth lowercases the address it stores too; normalizing here keeps
# the profile row's copy identical to auth.users.email, so the UNIQUE
# constraint on each table agrees with Supabase's. EmailStr validates shape
# first; AfterValidator only lowercases a value that already parsed.
NormalizedEmail = Annotated[EmailStr, AfterValidator(str.lower), Field(max_length=100)]


class AccountType(StrEnum):
    """Which of the two account tables a request is for — applicant_profiles
    or company_memberships. Not in app/models/dto.py: that file holds enums
    stored in a column; this one is never persisted, only read off the wire.
    Values match the frontend's account-type-switcher.tsx TYPES literally, so
    the "accountType" form field needs no translation at this boundary."""

    APPLICANT = "applicant"
    COMPANY = "company"


class SignupRequest(BaseModel):
    """POST body for signup. Mirrors frontend/src/app/signup/page.tsx's form
    exactly — name, email, password — with one deliberate omission:
    confirmPassword never reaches here. It's a client-side match check only
    (see that file's own docblock); sending it to the API would just be a
    second, redundant place the same rule could drift out of sync."""

    model_config = ConfigDict(populate_by_name=True)

    account_type: AccountType = Field(alias="accountType")
    # alias="name" because that's the wire name signup/page.tsx's form sends
    # (name="name" on the field) — full_name is what the column is actually
    # called once it reaches Profile in app/models/profiles.py.
    full_name: str = Field(alias="name", min_length=1, max_length=50)
    email: NormalizedEmail
    # Passed straight to Supabase Auth and never stored here. No length
    # floor in this file: Supabase enforces the project's minimum (Auth →
    # Providers → Email in the dashboard) and signup-form.tsx enforces 8
    # characters in the browser. Set the dashboard minimum to 8 to match.
    password: str


class AuthenticatedAccount(BaseModel):
    """What signup and /auth/me return. No token in here: Supabase Auth
    issues the session, and the Next server holds it in Supabase's own
    cookies. from_attributes=True so this can be built directly off an
    Applicant_Profile/Company_Membership ORM row without hand-mapping each
    field.

    onboarding_completed is a bool, not the raw onboarding_completed_at
    timestamp: the only thing a caller needs is which side of that NULL check
    the account is on. Where it redirects to (`/onboarding/applicant` vs
    `/jobs`, say) is a route concern, not this API's.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    full_name: str
    account_type: AccountType
    onboarding_completed: bool
    # Set only for a company_memberships account; None for an applicant.
    # Always read from the membership row, never from the token.
    company_id: UUID | None = None
