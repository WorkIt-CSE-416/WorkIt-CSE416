"""internship job type expand

KAN-233, the expand half: an internship becomes the job type `internship`,
and experience levels become `student`, `new_grad` and `experienced` (from
`internship`, `new_grad` and `other`). This only ADDS the new enum values, so
the code running before the deploy never meets them. Apply it before the
deploy that writes them.

Migration B, after the deploy, moves the rows that still hold the old values
and removes those from `experience_level`. Until then the code reads both
(app/queries/jobs/legacy_levels.py).

Revision ID: 027620538860
Revises: c0467afe819c
Create Date: 2026-10-16 16:23:19.015093

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '027620538860'
down_revision: Union[str, Sequence[str], None] = 'c0467afe819c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Autogenerate never emits enum values (alembic/CLAUDE.md). ADD VALUE runs
    # outside the migration's transaction: a value added inside one can't be
    # used until that transaction commits (as 1ea834081a48 does).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'internship'")
        op.execute("ALTER TYPE experience_level ADD VALUE IF NOT EXISTS 'student'")
        op.execute("ALTER TYPE experience_level ADD VALUE IF NOT EXISTS 'experienced'")


def downgrade() -> None:
    """Downgrade schema."""
    # Postgres can't drop an enum value, so both types are rebuilt without the
    # new ones. Rows the new code wrote go back to the old spelling first: an
    # internship is the internship level again (its hours were never kept),
    # and experienced is other. Neither column has a default to drop; the
    # company_job_complete CHECK only tests IS NOT NULL, so it survives.
    op.execute(
        "UPDATE job_postings SET experience_level = 'internship', job_type = NULL "
        "WHERE job_type = 'internship' AND company_id IS NULL"
    )
    # A company's job must keep a job type (company_job_complete): full-time
    # is the closest the old values can say.
    op.execute(
        "UPDATE job_postings SET experience_level = 'internship', job_type = 'full_time' "
        "WHERE job_type = 'internship'"
    )
    op.execute(
        "UPDATE job_postings SET experience_level = 'internship' "
        "WHERE experience_level = 'student'"
    )
    op.execute(
        "UPDATE job_postings SET experience_level = 'other' "
        "WHERE experience_level = 'experienced'"
    )
    op.execute("ALTER TYPE job_type RENAME TO job_type_old")
    op.execute("CREATE TYPE job_type AS ENUM ('full_time', 'part_time', 'contract')")
    op.execute(
        "ALTER TABLE job_postings ALTER COLUMN job_type TYPE job_type "
        "USING job_type::text::job_type"
    )
    op.execute("DROP TYPE job_type_old")
    op.execute("ALTER TYPE experience_level RENAME TO experience_level_old")
    op.execute("CREATE TYPE experience_level AS ENUM ('internship', 'new_grad', 'other')")
    op.execute(
        "ALTER TABLE job_postings ALTER COLUMN experience_level TYPE experience_level "
        "USING experience_level::text::experience_level"
    )
    op.execute("DROP TYPE experience_level_old")
