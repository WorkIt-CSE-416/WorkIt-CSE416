"""saved application stage

KAN-261: a job's Save button keeps the job as a `saved` job_applications row,
so the Applications board's Saved column is real. This only ADDS the value,
so the code running before the deploy never meets it. Apply it before the
deploy that writes it, or Save answers 500 until it is applied.

Revision ID: 17ea74fa4573
Revises: 3f7a2c9d1e84
Create Date: 2026-10-18 16:10:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '17ea74fa4573'
down_revision: Union[str, Sequence[str], None] = '3f7a2c9d1e84'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Autogenerate never emits enum values (alembic/CLAUDE.md). ADD VALUE runs
    # outside the migration's transaction, as 027620538860's does.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE application_stage ADD VALUE IF NOT EXISTS 'saved'")


def downgrade() -> None:
    """Downgrade schema.

    Postgres can't drop an enum value, so the type is rebuilt without it. A
    saved job has no application before this, so its row goes. The default
    and the CHECK name the type, so both come off for the rebuild and go back.
    """
    op.execute("DELETE FROM job_applications WHERE stage = 'saved'")
    op.drop_constraint('job_applications_applied_dated', 'job_applications', type_='check')
    op.execute("ALTER TABLE job_applications ALTER COLUMN stage DROP DEFAULT")
    op.execute("ALTER TYPE application_stage RENAME TO application_stage_old")
    op.execute(
        "CREATE TYPE application_stage AS ENUM ('queued', 'needs_you', 'skipped', 'applied')"
    )
    op.execute(
        "ALTER TABLE job_applications ALTER COLUMN stage TYPE application_stage "
        "USING stage::text::application_stage"
    )
    op.execute("DROP TYPE application_stage_old")
    op.execute("ALTER TABLE job_applications ALTER COLUMN stage SET DEFAULT 'applied'")
    op.create_check_constraint(
        'job_applications_applied_dated', 'job_applications',
        "stage <> 'applied' OR applied_at IS NOT NULL",
    )
