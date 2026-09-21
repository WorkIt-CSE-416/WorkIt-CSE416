'''
hold model schema for profile table
'''
from typing import Optional
import datetime
import uuid
from sqlalchemy import ForeignKey
from sqlalchemy import DateTime, String, text
from sqlalchemy.orm import Mapped,mapped_column
from app.models.dto import company_size_range, company_role, profile_status
from app.db import BaseModel



class Profile(BaseModel):
    '''
    definition for profiles
    '''
    __abstract__= True  # copy attributes
    id:Mapped[uuid.UUID] = mapped_column(
                        primary_key=True,
                        # python generate
                        default=uuid.uuid4,
                        # server backup
                        server_default=text("gen_random_uuid()"))
    email: Mapped[str] = mapped_column(String(100), unique=True)
    full_name: Mapped[str] =mapped_column(String(50))
    phone_number: Mapped[Optional[str]] = mapped_column(String(30))
    avatar_url: Mapped[Optional[str]]

    # Encoded KDF output (algorithm + params + salt + hash as one string —
    # what argon2/bcrypt/scrypt all return), never a raw password. 255 is
    # headroom for any of those, not a measured value: argon2id lands around
    # 95-100 chars at default params but grows with higher memory cost, bcrypt
    # is a fixed 60. Required, not Optional — there is no OAuth-only signup
    # path yet (see backend/CLAUDE.md's Auth section), so every row here is
    # created through the password form and always has one.
    password_hash: Mapped[str] = mapped_column(String(255))

    # NULL until onboarding's Continue action sets it — that's the whole
    # signal the login/signup routes need to decide /onboarding/* vs the
    # dashboard. No server_default: a freshly created row must start NULL,
    # not "now", or every new account would read as already onboarded.
    onboarding_completed_at: Mapped[Optional[datetime.datetime]] = mapped_column(
                        DateTime(timezone=True))

class Applicant_Profile(Profile):
    '''
    schema for job applicants
    '''
    __tablename__= "applicant_profiles"
    default_resume_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("resumes.id", ondelete="SET NULL", use_alter=True), index=True, nullable=True)
    headline: Mapped[Optional[str]] = mapped_column(String(50))
    linkedin_url: Mapped[Optional[str]]
    portfolio_url: Mapped[Optional[str]]
    github_url: Mapped[Optional[str]]
    other_url: Mapped[Optional[str]]    # add another url for extra options


class Company_Profile(BaseModel):
    '''
    schema for company profile (the company information)
    separate from individual recruiter under the company
    '''
    __tablename__="company_profiles"
    id:Mapped[uuid.UUID] = mapped_column(
                        primary_key=True,
                        # python generate
                        default=uuid.uuid4,
                        # server backup
                        server_default=text("gen_random_uuid()"))
    company_name: Mapped[str] = mapped_column(String(255))
    slug:Mapped[Optional[str]]
    website_url: Mapped[Optional[str]]
    contact_email:Mapped[str] = mapped_column(String(100), unique=True)
    phone_number: Mapped[Optional[str]] = mapped_column(String(30))
    logo_url: Mapped[Optional[str]]
    description: Mapped[Optional[str]]= mapped_column(String(250))
    size_range: Mapped[company_size_range]


class Company_Membership(Profile):
    '''
    individual profile under company (i.e. recruiter, etc.)
    '''
    __tablename__ = "company_memberships"
    company_id: Mapped[uuid.UUID]= mapped_column(
        ForeignKey("company_profiles.id", ondelete="CASCADE"),
        index=True
    )
    role:Mapped[company_role]
    status: Mapped[profile_status]
    headline: Mapped[str] = mapped_column(String(50))
