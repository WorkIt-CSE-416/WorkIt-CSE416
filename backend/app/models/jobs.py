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
    String,
    Text,
    UniqueConstraint,
    Computed,
    desc,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from pgvector.sqlalchemy import VECTOR
from sqlalchemy.dialects.postgresql import TSVECTOR

from app.db import Base
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
    # when an internship starts, as the posting names it: "Summer 2027", "2027"
    start_term: Mapped[str | None] = mapped_column(Text)

    work_style: Mapped[dto.work_style | None]
    # the location text as given, for display. Filtering uses job_locations
    location_raw: Mapped[str | None] = mapped_column(Text)

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
    # The posting's meaning as a vector
    embedding: Mapped[list[float] | None] = mapped_column(
        VECTOR(dto.EMBEDDING_DIMENSIONS), deferred=True
    )
    # The title and description as stemmed search terms; matching searches
    # it for the applicant's own skills. Postgres computes it and keeps it
    # current, so nothing here ever writes it.
    fts: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            "to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))",
            persisted=True,
        ),
        deferred=True,
    )

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

        Index(  # index by job status ranked from earliest posted to latest 
            "job_postings_status_idx",
            "status", 
            desc("created_at")
        ), 
        
        # trigram GIN indexes 
        # for each company name is uploaded, split name into 3 char buckets and store the job
        # when a search title comes in, split into 3, it looks for jobs that are in all buckets
        Index(
            "job_postings_company_name_trgm_idx",
            "company_name",
            postgresql_using="gin",
            postgresql_ops={"company_name": "gin_trgm_ops"}
        )
    )


class Job_Location(Base):
    '''
    one place a job is offered, as ISO codes. A job in San Francisco and New
    York has two rows; a job naming no place has none
    '''
    __tablename__ = "job_locations"
    id: Mapped[uuid.UUID] = mapped_column(
                        primary_key=True,
                        default=uuid.uuid4,
                        server_default=text("gen_random_uuid()"))
    # no index of its own: job_locations_job_place_key leads with job_id
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("job_postings.id", ondelete="CASCADE")
    )
    # ZZ for a place outside the seeded countries (models/CLAUDE.md)
    country: Mapped[str] = mapped_column(
        CHAR(2),
        ForeignKey("countries.code", name="job_locations_country_fkey")
    )
    # nullable: "United States", or a country with no seeded states
    state: Mapped[str | None] = mapped_column(String(6))

    __table_args__ = (
        # Postgres skips a composite FK when state is NULL, which is what the
        # country FK above is for
        ForeignKeyConstraint(
            ["state", "country"],
            ["states.code", "states.country_code"],
            name="job_locations_state_country_fkey"
        ),
        # NULLS NOT DISTINCT: otherwise two (job, US, NULL) rows don't collide
        UniqueConstraint(
            "job_id", "country", "state",
            name="job_locations_job_place_key",
            postgresql_nulls_not_distinct=True
        ),
        Index(
            "job_locations_place_idx",
            "country",
            "state"
        )
    )
