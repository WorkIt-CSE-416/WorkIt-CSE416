'''
hold model schema for job posting tables
'''
import datetime
import uuid

from sqlalchemy import (
    CHAR,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    SmallInteger,
    Text,
    desc,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models import dto
from app.models.profiles import BaseModel


class Job_Post(BaseModel):
    '''
    schema for a job posting, one row per job
    serves both jobs that are scraped (external) or posted by recruiters
    '''
    __tablename__ = "job_postings"
    id:Mapped[uuid.UUID] = mapped_column(
                        primary_key=True,
                        default=uuid.uuid4,
                        server_default=text("gen_random_uuid()"))
    
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("company_profiles.id", ondelete="CASCADE"),
        index=True
    )
    posted_by_recruiter_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("company_memberships.id", ondelete="SET NULL"),    # if the recruiter is deleted, job remains
        index=True
    )
    company_name: Mapped[str | None] = mapped_column(Text)
    company_logo_url: Mapped[str | None] = mapped_column(Text)
    apply_url: Mapped[str | None] = mapped_column(Text, unique=True)

    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)

    job_type: Mapped[dto.job_type | None]
    experience_level: Mapped[dto.experience_level | None]
    min_years_experience: Mapped[int | None] = mapped_column(SmallInteger)

    work_style: Mapped[dto.work_style | None]
    location_raw: Mapped[str | None] = mapped_column(Text)
    location_state: Mapped[str | None]
    location_country: Mapped[str | None] = mapped_column(ForeignKey("countries.code"))

    salary: Mapped[float | None]
    salary_min: Mapped[float | None]
    salary_max: Mapped[float | None]
    
    salary_currency: Mapped[str] = mapped_column(
                        CHAR(3),
                        default="USD",
                        server_default="USD")
    salary_period: Mapped[dto.salary_period] = mapped_column(
                        default=dto.salary_period.year,
                        server_default=dto.salary_period.year.name)
    status: Mapped[dto.job_post_status] = mapped_column(
                        default=dto.job_post_status.published,
                        server_default=dto.job_post_status.published.name)
    closes_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    posted_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))

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
            "company_id IS NULL OR (description IS NOT NULL AND job_type IS NOT NULL"
            " AND experience_level IS NOT NULL AND work_style IS NOT NULL)",
            name="company_job_complete"
        ),
        CheckConstraint(
            "company_id IS NOT NULL OR (company_name IS NOT NULL AND apply_url IS NOT NULL)",
            name="scraped_job_completed"
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