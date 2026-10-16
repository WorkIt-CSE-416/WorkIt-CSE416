"""internship job type contract

KAN-233, the contract half. Apply it after the code from 027620538860's
deploy is live (that code reads both spellings and writes only the new one),
and before the deploy that drops queries/jobs/legacy_levels.py.

Moves the rows an older import or the company form wrote with the old values,
then rebuilds `experience_level` without them:
- an internship level becomes the internship job type for a student (its
  stated hours, which the cards never showed, go);
- `other` becomes `experienced`.

Revision ID: aa97037c00e5
Revises: 4c59715d02db
Create Date: 2026-10-16 17:05:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'aa97037c00e5'
down_revision: Union[str, Sequence[str], None] = '4c59715d02db'
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
    op.execute(
        "UPDATE job_postings SET job_type = 'internship', experience_level = 'student' "
        "WHERE experience_level = 'internship'"
    )
    op.execute(
        "UPDATE job_postings SET experience_level = 'experienced' "
        "WHERE experience_level = 'other'"
    )
    _rebuild_levels("'student', 'new_grad', 'experienced'")


def downgrade() -> None:
    """Downgrade schema."""
    # Back to 027620538860's type, which holds both spellings; the rows keep
    # the new one, which that revision's code reads.
    _rebuild_levels("'internship', 'new_grad', 'other', 'student', 'experienced'")
