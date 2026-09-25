'''
hold model schema for profile table
'''
import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel
from app.models.dto import company_role, company_size_range, profile_status


class Profile(BaseModel):
    '''
    definition for profiles
    '''
    __abstract__= True  # copy attributes
    # The Supabase auth.users id, since each user would be 
    # first created in supabase 
    id:Mapped[uuid.UUID] = mapped_column(
                        ForeignKey("auth.users.id", ondelete="CASCADE"),
                        primary_key=True)
    email: Mapped[str] = mapped_column(String(100), unique=True)
    full_name: Mapped[str] =mapped_column(String(50))
    phone_number: Mapped[str | None] = mapped_column(String(30))
    avatar_url: Mapped[str | None]
    # NULL until onboarding's Continue action sets it — /auth/me reads it to
    # decide /onboarding/* vs the dashboard. No server_default: a new row
    # must start NULL, or every new account would read as already onboarded.
    onboarding_completed_at: Mapped[datetime.datetime | None] = mapped_column(
                        DateTime(timezone=True))

class Applicant_Profile(Profile):
    '''
    schema for job applicants
    '''
    __tablename__= "applicant_profiles"
    default_resume_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("resumes.id", ondelete="SET NULL", use_alter=True), index=True, nullable=True)
    headline: Mapped[str | None] = mapped_column(String(50))
    linkedin_url: Mapped[str | None]
    portfolio_url: Mapped[str | None]
    github_url: Mapped[str | None]
    other_url: Mapped[str | None]    # add another url for extra options


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
    slug:Mapped[str | None]
    website_url: Mapped[str | None]
    contact_email:Mapped[str] = mapped_column(String(100), unique=True)
    phone_number: Mapped[str | None] = mapped_column(String(30))
    logo_url: Mapped[str | None]
    description: Mapped[str | None]= mapped_column(String(250))
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
