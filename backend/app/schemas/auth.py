"""
Request/response shapes for login and signup. Separate from
app/models/profiles.py on purpose — see backend/CLAUDE.md: "SQLAlchemy models
and Pydantic schemas are separate layers... the first time an internal column
must not be exposed, you will regret" collapsing them. password_hash is that
column; it has no field anywhere in this file.
"""

from enum import StrEnum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


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
    email: EmailStr
    # 8 is a floor, not a policy — this repo has no product decision yet on
    # complexity rules, and the signup form itself enforces nothing beyond
    # `required`. Add real complexity rules when that decision exists, not
    # speculatively now.
    password: str = Field(min_length=8)


class LoginRequest(BaseModel):
    """POST body for login. frontend/src/app/login/page.tsx's form: email,
    password, plus the account-type switcher's hidden field."""

    model_config = ConfigDict(populate_by_name=True)

    account_type: AccountType = Field(alias="accountType")
    email: EmailStr
    password: str


class AuthenticatedAccount(BaseModel):
    """What a successful login/signup response body carries. The session
    token itself is never in here — it travels only in the httpOnly cookie
    (see app/security.py's SESSION_TTL), never in a JSON body a script could
    read. from_attributes=True so this can be built directly off an
    Applicant_Profile/Company_Membership ORM row without hand-mapping each
    field — and since password_hash has no field here, one never leaks
    through that shortcut either.

    onboarding_completed is a bool, not the raw onboarding_completed_at
    timestamp: the only thing a caller needs is which side of that NULL check
    the account is on. Where it redirects to (`/onboarding/applicant` vs
    `/jobs`, say) is a route concern, not this API's — see
    db/auth_methodology.md Step 5.
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


if __name__ == "__main__":
    # ponytail: the one runnable check for this module's aliasing/validation
    # branches, and the security invariant the docstring above claims.

    signup = SignupRequest.model_validate(
        {"accountType": "applicant", "name": "Jane Doe", "email": "jane@example.com", "password": "correct horse"}
    )
    assert signup.account_type == AccountType.APPLICANT
    assert signup.full_name == "Jane Doe"

    login = LoginRequest.model_validate(
        {"accountType": "company", "email": "jane@example.com", "password": "correct horse"}
    )
    assert login.account_type == AccountType.COMPANY

    try:
        SignupRequest.model_validate(
            {"accountType": "applicant", "name": "Jane Doe", "email": "jane@example.com", "password": "short"}
        )
        raise AssertionError("a password under 8 chars must be rejected")
    except ValueError:
        pass

    assert "password_hash" not in AuthenticatedAccount.model_fields, (
        "the response schema must never carry a credential field"
    )

    # Prove it end to end, not just by field name: build the response from an
    # object that DOES have a password_hash (an ORM row would) and confirm it
    # never reaches the serialized output.
    class FakeRow:
        id = UUID("00000000-0000-0000-0000-000000000000")
        email = "jane@example.com"
        full_name = "Jane Doe"
        account_type = AccountType.APPLICANT
        onboarding_completed = False
        company_id = None
        password_hash = "argon2id$this-must-never-appear"

    dumped = AuthenticatedAccount.model_validate(FakeRow()).model_dump()
    assert "password_hash" not in dumped, "password_hash leaked through model_validate"

    print("app/schemas/auth.py: all checks passed")
