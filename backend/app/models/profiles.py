'''
hold model schema for profile table 
'''
from typing import Optional
import datetime
import uuid 
from sqlalchemy import ForeignKey
from sqlalchemy import String, DateTime, func, text
from sqlalchemy.orm import Mapped,mapped_column 
from app.models.dto import company_size_range, company_role, profile_status
from app.db import Base # the actual Base that Alembic reads from 

class BaseModel(Base): 
    '''
    custom base model to store attributes that every subclass model would have
    '''
    __abstract__ = True
    created_at: Mapped[datetime.datetime]=mapped_column(
                                            DateTime(timezone=True), 
                                            server_default=func.now())
    updated_at: Mapped[datetime.datetime]=mapped_column(
                                            DateTime(timezone=True),
                                            server_default=func.now(),
                                            onupdate=func.now())

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

class Applicant_Profile(Profile): 
    '''
    schema for job applicants 
    '''
    __tablename__= "applicant_profiles"
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
        ForeignKey("company_profiles.id", ondelete="CASCADE")
    )
    role:Mapped[company_role]
    status: Mapped[profile_status]
    headline: Mapped[str] = mapped_column(String(50))