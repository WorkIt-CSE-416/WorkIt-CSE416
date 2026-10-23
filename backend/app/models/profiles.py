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
    # same design as resume, use a path to the supabase bucket
    # do not store the original url 
    avatar_path: Mapped[str | None]
    onboarding_completed_at: Mapped[datetime.datetime | None] = mapped_column(
                        DateTime(timezone=True))

class Applicant_Profile(Profile):
    '''
    schema for job applicants
    '''
    __tablename__= "applicant_profiles"
    default_resume_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("resumes.id", ondelete="SET NULL", use_alter=True), index=True, nullable=True)
    # The default can be a base resume instead (KAN-207). At most one of the
    # two is set (applicant_profiles_one_default_resume); setting one clears
    # the other.
    default_built_resume_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("built_resumes.id", ondelete="SET NULL", use_alter=True), index=True, nullable=True)
    headline: Mapped[str | None] = mapped_column(String(50))
    # The applicant's own city (KAN-312) — never a job posting's location
    # (job_locations/applicant_locations are search-preference data, not
    # this). Free text ("Seattle, WA"), not resolved against the
    # countries/states tables: a resume header and an ATS "Location (City)"
    # field both just want to show/type it, never filter on it. Read by the
    # autofiller as real data in place of a posting-specific guess.
    location: Mapped[str | None] = mapped_column(String(100))
    # The email employers see (KAN-262): resume headers and the autofiller.
    # NULL means the sign-in `email`, which the seeker cannot change here.
    contact_email: Mapped[str | None] = mapped_column(String(100))
    linkedin_url: Mapped[str | None]
    portfolio_url: Mapped[str | None]
    github_url: Mapped[str | None]
    other_url: Mapped[str | None]    # add another url for extra options

    @property
    def email_for_employers(self) -> str:
        '''The contact email, else the sign-in email.'''
        return self.contact_email or self.email


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
    # Nullable: signup doesn't collect one, so the owner's membership row is
    # created without it and filled in later, same as applicant_profiles.
    headline: Mapped[str | None] = mapped_column(String(50))
