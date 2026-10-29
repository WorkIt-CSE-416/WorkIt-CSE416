"""application events and the stages after applied

KAN-413 (docs/email_tracker.md), build step 1: the tracker's interviewing,
offer and rejected stages, and application_events, the dated things on an
application (an interview, an assessment's due date, an offer, a
rejection). The student adds them by hand first; the email tracker
proposes them later into the same table.

Apply it before the deploy that writes them: it only adds enum values and
a table, so the code running before it never meets them, while the new
code's stage menu and Add Event answer 500 without it.

Revision ID: a7d3e5f1c2b4
Revises: b9e2c4d6f8a1
Create Date: 2026-10-27 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a7d3e5f1c2b4'
down_revision: Union[str, Sequence[str], None] = 'b9e2c4d6f8a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen here, not imported from dto: a later change to the enum must not
# change what this migration does.
event_kind = postgresql.ENUM(
    'confirmation', 'assessment', 'interview', 'offer', 'rejection', 'other',
    name='application_event_kind',
)
event_status = postgresql.ENUM('proposed', 'accepted', 'dismissed', name='application_event_status')
event_source = postgresql.ENUM('manual', 'gmail', name='application_event_source')


def upgrade() -> None:
    """Upgrade schema."""
    # Autogenerate never emits enum values (alembic/CLAUDE.md). ADD VALUE runs
    # outside the migration's transaction, as 17ea74fa4573's does.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE application_stage ADD VALUE IF NOT EXISTS 'interviewing'")
        op.execute("ALTER TYPE application_stage ADD VALUE IF NOT EXISTS 'offer'")
        op.execute("ALTER TYPE application_stage ADD VALUE IF NOT EXISTS 'rejected'")

    bind = op.get_bind()
    for kind in (event_kind, event_status, event_source):
        kind.create(bind, checkfirst=True)

    op.create_table(
        'application_events',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        # Null only for an email that matched no application (a later step)
        sa.Column('job_id', sa.Uuid(), nullable=True),
        sa.Column('kind', postgresql.ENUM(name='application_event_kind', create_type=False), nullable=False),
        sa.Column('status', postgresql.ENUM(name='application_event_status', create_type=False), nullable=False),
        sa.Column('source', postgresql.ENUM(name='application_event_source', create_type=False), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        # Exactly one: an instant for something at a time, a date for
        # something due on a day (the model's docstring says why)
        sa.Column('at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('on_day', sa.Date(), nullable=True),
        sa.Column('note', sa.String(), nullable=True),
        sa.Column('meeting_url', sa.String(), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        # Deleting the application (Unsave, taking it out of the queue)
        # deletes its events; MATCH SIMPLE skips the check while job_id is null
        sa.ForeignKeyConstraint(
            ['applicant_id', 'job_id'],
            ['job_applications.applicant_id', 'job_applications.job_id'],
            ondelete='CASCADE',
            name='application_events_application_fkey',
        ),
        sa.CheckConstraint('num_nonnulls(at, on_day) = 1', name='application_events_one_when'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'application_events_application_idx', 'application_events', ['applicant_id', 'job_id']
    )

    # By hand: autogenerate never emits RLS (alembic/CLAUDE.md). Deny-all
    # backstop against the anon key; ENABLE, never FORCE.
    op.execute('ALTER TABLE public.application_events ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema.

    Postgres can't drop an enum value, so application_stage is rebuilt
    without the three, as 17ea74fa4573's downgrade does. Their rows go back
    to applied, the stage they came from, and keep their applied_at.
    """
    op.drop_table('application_events')
    bind = op.get_bind()
    for kind in (event_source, event_status, event_kind):
        kind.drop(bind, checkfirst=True)

    op.execute(
        "UPDATE job_applications SET stage = 'applied', applied_at = coalesce(applied_at, now()) "
        "WHERE stage IN ('interviewing', 'offer', 'rejected')"
    )
    op.drop_constraint('job_applications_applied_dated', 'job_applications', type_='check')
    op.execute("ALTER TABLE job_applications ALTER COLUMN stage DROP DEFAULT")
    op.execute("ALTER TYPE application_stage RENAME TO application_stage_old")
    op.execute(
        "CREATE TYPE application_stage AS ENUM "
        "('queued', 'needs_you', 'skipped', 'applied', 'saved')"
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
