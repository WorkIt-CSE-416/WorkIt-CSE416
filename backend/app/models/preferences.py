'''
a seeker's saved job preferences: what onboarding asked (KAN-231), in the
vocabulary GET /jobs filters on, so the Jobs page can hand them straight back
to it as filters. docs/search.md and models/CLAUDE.md have the design.
'''
import uuid
from decimal import Decimal

from sqlalchemy import (
    CHAR,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, BaseModel


def _list_column() -> Mapped[list[str]]:
    # NOT NULL with an empty default: "no pick" is an empty list, never NULL,
    # so a reader never has to tell the two apart.
    return mapped_column(ARRAY(Text), nullable=False, server_default=text("'{}'"))


class Applicant_Preferences(BaseModel):
    '''
    one row per applicant, written whole by PUT /applicants/{id}/preferences
    the roles live in applicant_job_roles and the places in
    applicant_locations, for their foreign keys

    Text with CHECKs rather than Postgres enums: changing an enum's values is
    a coordinated deploy (KAN-233 took an expand and a contract step), while
    a CHECK changes in one migration.
    The values are GET /jobs' query values, which routers/jobs.py validates
    the same way. Places and seasons are checked by shape in the API only, as
    GET /jobs checks them: a code no job uses matches nothing.
    '''
    __tablename__ = "applicant_preferences"
    applicant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), primary_key=True
    )
    work_styles: Mapped[list[str]] = _list_column()     # ["remote", "hybrid"]
    levels: Mapped[list[str]] = _list_column()          # ["student", "new_grad"]
    job_types: Mapped[list[str]] = _list_column()       # ["full_time", "internship"]
    start_terms: Mapped[list[str]] = _list_column()     # ["summer-2027"]
    # A pay range in US dollars per pay_per, either end open; stored as
    # entered so the form shows it back as typed.
    min_pay: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    max_pay: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    pay_per: Mapped[str] = mapped_column(Text, server_default=text("'year'"))
    visa: Mapped[str | None] = mapped_column(Text)      # "sponsors"

    __table_args__ = (
        CheckConstraint(
            "work_styles <@ ARRAY['remote','hybrid','onsite']::text[]",
            name="applicant_preferences_work_styles",
        ),
        CheckConstraint(
            "levels <@ ARRAY['student','new_grad','experienced']::text[]",
            name="applicant_preferences_levels",
        ),
        CheckConstraint(
            "job_types <@ ARRAY['full_time','part_time','contract','internship']::text[]",
            name="applicant_preferences_job_types",
        ),
        # The same caps GET /jobs puts on its query.
        CheckConstraint(
            "cardinality(start_terms) <= 12", name="applicant_preferences_start_terms_cap"
        ),
        CheckConstraint(
            "min_pay IS NULL OR min_pay > 0", name="applicant_preferences_min_pay"
        ),
        CheckConstraint(
            "max_pay IS NULL OR max_pay > 0", name="applicant_preferences_max_pay"
        ),
        CheckConstraint("pay_per IN ('hour','year')", name="applicant_preferences_pay_per"),
        CheckConstraint(
            "visa IS NULL OR visa = 'sponsors'",
            name="applicant_preferences_visa",
        ),
    )


class Applicant_Job_Role(Base):
    '''
    a role the applicant picked in onboarding: the docs' planned
    profile_job_roles (docs/search.md), named for the table it hangs off
    '''
    __tablename__ = "applicant_job_roles"
    applicant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), primary_key=True
    )
    # RESTRICT, as job_role_tags: a role can't be deleted while anyone picked
    # it (models/CLAUDE.md, "Onboarding picks should take RESTRICT too").
    role_slug: Mapped[str] = mapped_column(
        ForeignKey("job_roles.slug", ondelete="RESTRICT"), primary_key=True
    )

    __table_args__ = (
        Index("applicant_job_roles_role_idx", "role_slug", "applicant_id"),
    )


class Applicant_Location(Base):
    '''
    a place the applicant picked in onboarding, as job_locations holds a job's:
    a country, and the state when a state was picked ("US", "US-CA"). Its
    foreign keys refuse a code the location tables lack
    '''
    __tablename__ = "applicant_locations"
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    # no index of its own: applicant_locations_applicant_place_key leads with it
    applicant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE")
    )
    country: Mapped[str] = mapped_column(
        CHAR(2), ForeignKey("countries.code", name="applicant_locations_country_fkey")
    )
    state: Mapped[str | None] = mapped_column(String(6))

    __table_args__ = (
        # Postgres skips a composite FK when state is NULL; the country FK
        # above covers that row.
        ForeignKeyConstraint(
            ["state", "country"],
            ["states.code", "states.country_code"],
            name="applicant_locations_state_country_fkey",
        ),
        # NULLS NOT DISTINCT: otherwise two (applicant, US, NULL) rows don't collide
        UniqueConstraint(
            "applicant_id", "country", "state",
            name="applicant_locations_applicant_place_key",
            postgresql_nulls_not_distinct=True,
        ),
    )
