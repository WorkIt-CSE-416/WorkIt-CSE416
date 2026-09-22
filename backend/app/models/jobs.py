'''
hold model schema for job posting tables
'''
from typing import Optional
import datetime
import uuid
from app.models.profiles import BaseModel
from app.models import dto
from sqlalchemy import ForeignKey, DateTime, text, Text, SmallInteger, CHAR, CheckConstraint, Index, desc,ForeignKeyConstraint
from sqlalchemy.orm import Mapped,mapped_column

class Job_Post(BaseModel):
    '''
    schema for a job posting, one row per job
    created_at / updated_at come from BaseModel
    '''
    __tablename__ = "job_postings"
    id:Mapped[uuid.UUID] = mapped_column(
                        primary_key=True,
                        default=uuid.uuid4,
                        server_default=text("gen_random_uuid()"))
    
    # index company id for faster look up/filtering by Company 
    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("company_profiles.id", ondelete="CASCADE"),
        index=True
    )
    posted_by_recruiter_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("company_memberships.id", ondelete="SET NULL"),    # if the recruiter is deleted, job remains
        index=True
    )

    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text) 

    job_type: Mapped[dto.job_type]
    experience_level: Mapped[dto.experience_level]
    min_years_experience: Mapped[Optional[int]] = mapped_column(SmallInteger)

    work_style: Mapped[dto.work_style]
    # nullable: "United States" or a country with no ISO subdivisions has no
    # state. Country is required; a remote posting still names one.
    location_state: Mapped[Optional[str]]
    # own FK because Postgres skips the composite one below once location_state
    # is NULL, which would leave a country-only row unchecked
    location_country: Mapped[str] = mapped_column(ForeignKey("countries.code"))

    salary: Mapped[Optional[float]]
    salary_min: Mapped[Optional[float]]
    salary_max: Mapped[Optional[float]]
    
    # use defaults as backup, but should be defined from backend 
    salary_currency: Mapped[str] = mapped_column(
                        CHAR(3),
                        default="USD",
                        server_default="USD")
    salary_period: Mapped[dto.salary_period] = mapped_column(
                        default=dto.salary_period.year,
                        server_default=dto.salary_period.year.name)
    status: Mapped[dto.job_post_status] = mapped_column(
                        default=dto.job_post_status.draft,
                        server_default=dto.job_post_status.draft.name)
    closes_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max",
            name="salary_range_ordered"
        ), 
        CheckConstraint(
            "salary_min >= 0 AND salary_max >= 0 AND salary >= 0",
            name="salary_non_negative"
        ),
        CheckConstraint(
            "salary IS NOT NULL OR (salary_min IS NOT NULL AND salary_max IS NOT NULL)",
            name= "salary_exist"
        ),

        ForeignKeyConstraint(
            ["location_state", "location_country"],
            ["states.code", "states.country_code"],
            name="country_state_reference_exist"
        ),
        CheckConstraint(
            "location_state IS NULL OR location_country IS NOT NULL",
            name="state_requires_country",
        ),

        Index(  # index by job status ranked from earliest posted to latest 
            "job_postings_status_idx",
            "status", 
            desc("created_at")
        ), 
        Index (
            "job_postings_loc_idx",
            "location_country",
            "location_state"
        )
    )