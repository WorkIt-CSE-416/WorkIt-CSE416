"""internship job type: drop the old levels

KAN-233, contract step 2 of 2. Apply it AFTER the deploy that drops
queries/jobs/legacy_levels.py, never before: the code live until then names
`internship` and `other` in its queries, and Postgres refuses a query that
names a value its enum lacks, so the Jobs page's Experience filter and counts
would fail. aa97037c00e5 already moved every row off those values.

Rebuilds `experience_level` as `student`, `new_grad` and `experienced`.

Revision ID: 188c8c2d7c14
Revises: aa97037c00e5
Create Date: 2026-10-17 13:40:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '188c8c2d7c14'
down_revision: Union[str, Sequence[str], None] = 'aa97037c00e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _rebuild_levels(values: str) -> None:
    # Postgres can't drop an enum value, so the type is rebuilt (as
    # 1ea834081a48's downgrade does). The column has no default to drop, and
    # the company_job_complete CHECK only tests IS NOT NULL, so it survives.
    op.execute("ALTER TYPE experience_level RENAME TO experience_level_old")
    op.execute(f"CREATE TYPE experience_level AS ENUM ({values})")
    op.execute(
        "ALTER TABLE job_postings ALTER COLUMN experience_level TYPE experience_level "
        "USING experience_level::text::experience_level"
    )
    op.execute("DROP TYPE experience_level_old")


def upgrade() -> None:
    """Upgrade schema."""
    _rebuild_levels("'student', 'new_grad', 'experienced'")


def downgrade() -> None:
    """Downgrade schema."""
    # Back to 027620538860's type, which holds both spellings.
    _rebuild_levels("'internship', 'new_grad', 'other', 'student', 'experienced'")
