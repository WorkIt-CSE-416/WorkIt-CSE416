'''
hold model schema for profile table 
'''
from typing import Optional
import datetime
import uuid 
from sqlalchemy import ForeignKey
from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped,mapped_column, relationship

class Base(DeclarativeBase): 
    # standard base 
    pass 

class BaseModel(Base): 
    '''
    custom base model to store attributes that every subclass model would have
    '''
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
    __tablename__ = "profiles"
    id:Mapped[uuid.UUID] = mapped_column(primary_key=True)
    email: Mapped[str]
    full_name: Mapped[str] 
    phone_number: Mapped[Optional[str]]
    avatar_url: Mapped[Optional[str]]

class Applicant_Profile(BaseModel): 
    '''
    schema for job applicants 
    '''
    __tablename__= "applicant_profiles"
    profile_id: Mapped[uuid.UUID]= mapped_column(
                ForeignKey("profiles.id", ondelete="CASCADE")
    )
    headline: Mapped[Optional[str]] 
    linkedin_url: Mapped[Optional[str]]
    portfolio_url: Mapped[Optional[str]]
    github_url: Mapped[Optional[str]]
    other_url: Mapped[Optional[str]]    # add another url for extra options 
