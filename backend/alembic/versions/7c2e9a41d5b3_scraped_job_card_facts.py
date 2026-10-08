"""scraped job card facts: weekly and monthly pay, start term

Revision ID: 7c2e9a41d5b3
Revises: 4cfa4c1836cd
Create Date: 2026-10-07 20:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = '7c2e9a41d5b3'
down_revision: Union[str, Sequence[str], None] = '4cfa4c1836cd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Many internships pay by the week or month, and the scraper keeps that
    # period rather than turning a 12-week stipend into an annual salary.
    # Autogenerate never emits enum values (alembic/CLAUDE.md); ADD VALUE runs
    # outside the migration's transaction, as in 1ea834081a48.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE salary_period ADD VALUE IF NOT EXISTS 'week' AFTER 'hour'")
        op.execute("ALTER TYPE salary_period ADD VALUE IF NOT EXISTS 'month' AFTER 'week'")
    # When an internship starts, as the posting names it: "Summer 2027", "2027".
    op.add_column('job_postings', sa.Column('start_term', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('job_postings', 'start_term')
    # Postgres can't drop an enum value, so the type is rebuilt without them.
    # A weekly or monthly amount means nothing read as yearly, so it goes.
    op.execute(
        "UPDATE job_postings SET salary = NULL, salary_min = NULL, salary_max = NULL, "
        "salary_period = 'year' WHERE salary_period IN ('week', 'month')"
    )
    op.execute("ALTER TYPE salary_period RENAME TO salary_period_old")
    op.execute("CREATE TYPE salary_period AS ENUM ('year', 'hour')")
    op.execute("ALTER TABLE job_postings ALTER COLUMN salary_period DROP DEFAULT")
    op.execute(
        "ALTER TABLE job_postings ALTER COLUMN salary_period TYPE salary_period "
        "USING salary_period::text::salary_period"
    )
    op.execute("ALTER TABLE job_postings ALTER COLUMN salary_period SET DEFAULT 'year'")
    op.execute("DROP TYPE salary_period_old")
