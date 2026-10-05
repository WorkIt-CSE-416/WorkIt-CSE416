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

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    model_validator,
)

from app.models.dto import company_size_range, profile_status

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

class CompanySignup(BaseModel):
    ''' 
    stores checks and normalizations for company field in post request
    '''
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)
    name:str= Field(min_length=1, max_length=255)
    website_url: str | None = Field(None, alias="websiteUrl")
    contact_email: NormalizedEmail = Field(alias="contactEmail")
    contact_phone: str | None = Field(None, alias="contactPhone", max_length=30)
    size_range: company_size_range = Field(alias="sizeRange")

class SignupRequest(BaseModel):
    """POST body for signup. Mirrors frontend/src/app/signup/page.tsx's form
    exactly — name, email, password — with one deliberate omission:
    confirmPassword never reaches here. It's a client-side match check only
    (see that file's own docblock); sending it to the API would just be a
    second, redundant place the same rule could drift out of sync."""

    model_config = ConfigDict(populate_by_name=True)

    account_type: AccountType = Field(alias="accountType")
    full_name: str = Field(alias="name", min_length=1, max_length=50)
    email: NormalizedEmail
    password: str = Field(min_length=8)
    # company sign up 
    company: CompanySignup | None = None 

    @model_validator(mode="after")
    def company_matches_account_type(self):
        '''
        run checks after the fields are parsed to make sure account is populated
        '''
        if self.account_type is AccountType.COMPANY and self.company is None:
            raise ValueError("company is required for a company signup")
        if self.account_type is AccountType.APPLICANT and self.company is not None:
            raise ValueError("company is only accepted for a company signup")
        return self


class AuthenticatedAccount(BaseModel):
    '''
    profile to be returned once account is created/logged in 
    '''
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    full_name: str
    account_type: AccountType
    onboarding_completed: bool
    company_id: UUID | None = None
    # For get_company_member, so it needn't load the membership row a second
    # time. exclude=True keeps it out of /auth/me's response: it decides
    # access, and the frontend has no use for it.
    membership_status: profile_status | None = Field(None, exclude=True)
