"""job application stage

Revision ID: c0467afe819c
Revises: 5cc3189af108
Create Date: 2026-10-15 17:55:48.578491

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c0467afe819c'
down_revision: Union[str, Sequence[str], None] = '5cc3189af108'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


STAGES = ('queued', 'needs_you', 'skipped', 'applied')


def upgrade() -> None:
    """Upgrade schema.

    Gives each job_applications row a stage, so auto apply can queue a job
    before the applicant applies (auto-apply/architecture.md, "Data model").
    Every row so far is an Applied mark, so they all become 'applied'.
    """
    # Hand-written: autogenerate creates an enum only with a new table.
    op.execute(
        "CREATE TYPE application_stage AS ENUM ("
        + ", ".join(f"'{stage}'" for stage in STAGES)
        + ")"
    )
    stage = postgresql.ENUM(*STAGES, name='application_stage', create_type=False)
    # The default fills the existing rows, and stays: the code deployed
    # before this inserts an Applied mark without a stage, which must keep
    # working whichever of the migration and the deploy comes first.
    op.add_column(
        'job_applications',
        sa.Column('stage', stage, server_default='applied', nullable=False),
    )

    # When the row was made: the queue's order. An existing row was made
    # when it was marked applied.
    op.add_column(
        'job_applications',
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
    )
    op.execute('UPDATE job_applications SET created_at = applied_at')

    # A queued job has not been applied to yet. The now() default stays, for
    # the same older inserts; a queued insert writes NULL itself.
    op.alter_column(
        'job_applications', 'applied_at',
        existing_type=sa.DateTime(timezone=True), nullable=True,
    )
    op.create_check_constraint(
        'job_applications_applied_dated', 'job_applications',
        "stage <> 'applied' OR applied_at IS NOT NULL",
    )


def downgrade() -> None:
    """Downgrade schema.

    Only applied rows existed before: queued, skipped and needs_you rows are
    deleted, since the old table can't hold them.
    """
    op.drop_constraint('job_applications_applied_dated', 'job_applications', type_='check')
    op.execute("DELETE FROM job_applications WHERE stage <> 'applied'")
    op.alter_column(
        'job_applications', 'applied_at',
        existing_type=sa.DateTime(timezone=True), nullable=False,
    )
    op.drop_column('job_applications', 'created_at')
    op.drop_column('job_applications', 'stage')
    op.execute('DROP TYPE application_stage')
