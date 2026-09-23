"""
Request/response shapes for login and signup. Separate from
app/models/profiles.py on purpose — see backend/CLAUDE.md: "SQLAlchemy models
and Pydantic schemas are separate layers... the first time an internal column
must not be exposed, you will regret" collapsing them. password_hash is that
column; it has no field anywhere in this file.
"""

from enum import StrEnum
from typing import Annotated, Optional
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field

# Case shouldn't matter for an email address — "Jane@Example.com" and
# "jane@example.com" are the same account — but it must for a password.
# Normalizing here, once, means every table's `email` UNIQUE constraint and
# every login lookup are case-insensitive for free: signup stores the
# lowercased form, login queries with the lowercased form, so they always
# compare equal without the router ever having to remember to call
# .lower() itself. EmailStr validates shape first; AfterValidator only
# lowercases a value that already parsed as a real address.
NormalizedEmail = Annotated[EmailStr, AfterValidator(str.lower)]


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
    # No length floor here for now — frontend/src/app/signup/signup-form.tsx
    # enforces the 8-char minimum via the input's own minLength, and this
    # was deliberately dropped rather than kept as a second copy of that
    # rule. Not a security backstop against a direct API call right now —
    # reintroduce it here if that gap needs closing again.
    password: str


class LoginRequest(BaseModel):
    """POST body for login. frontend/src/app/login/page.tsx's form: email,
    password, plus the account-type switcher's hidden field."""

    model_config = ConfigDict(populate_by_name=True)

    account_type: AccountType = Field(alias="accountType")
    email: NormalizedEmail
    password: str


class AuthenticatedAccount(BaseModel):
    """What a successful login/signup response body carries. The access
    token itself is never in here — it travels only in the httpOnly cookie
    (see app/security.py's ACCESS_TOKEN_TTL), never in a JSON body a script
    could read. from_attributes=True so this can be built directly off an
    Applicant_Profile/Company_Membership ORM row without hand-mapping each
    field — and since password_hash has no field here, one never leaks
    through that shortcut either.

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
    # Not derived here — whoever builds this response passes it explicitly,
    # since an Applicant_Profile row has no company_id to read at all.
    company_id: Optional[UUID] = None
