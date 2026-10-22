"""desktop review stages

KAN-323 (auto-apply/desktop.md): WorkIt Desktop fills applications on the
student's own computer and stops before Submit for the student's review.
`application_stage` gains `filling`, `review` and `approved`, placed after
`queued`; `application_reviews` keeps what Desktop filled and the answers
the student approved, one row per application; `desktop_heartbeats` keeps
each applicant's Desktop's last beat.

Only adds: the code running before the deploy never meets the new values or
reads the new tables, so apply it before the deploy that writes them.
Deployed first, every Desktop route answers 500.

Revision ID: 40329c7aef62
Revises: 3aa342c5a064
Create Date: 2026-10-22 03:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '40329c7aef62'
down_revision: Union[str, Sequence[str], None] = '3aa342c5a064'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Autogenerate never emits enum values (alembic/CLAUDE.md). ADD VALUE runs
    # outside the migration's transaction, as 17ea74fa4573's does.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE application_stage ADD VALUE IF NOT EXISTS 'filling' AFTER 'queued'")
        op.execute("ALTER TYPE application_stage ADD VALUE IF NOT EXISTS 'review' AFTER 'filling'")
        op.execute("ALTER TYPE application_stage ADD VALUE IF NOT EXISTS 'approved' AFTER 'review'")

    op.create_table(
        'application_reviews',
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('job_id', sa.Uuid(), nullable=False),
        sa.Column('review', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('approved_answers', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("jsonb_typeof(review) = 'object'", name='application_reviews_review_object'),
        sa.CheckConstraint(
            "approved_answers IS NULL OR jsonb_typeof(approved_answers) = 'array'",
            name='application_reviews_approved_array',
        ),
        sa.ForeignKeyConstraint(
            ['applicant_id', 'job_id'], ['job_applications.applicant_id', 'job_applications.job_id'],
            ondelete='CASCADE', name='application_reviews_application_fkey',
        ),
        sa.PrimaryKeyConstraint('applicant_id', 'job_id'),
    )
    # By hand: autogenerate never emits RLS (alembic/CLAUDE.md). ENABLE, never FORCE.
    op.execute('ALTER TABLE public.application_reviews ENABLE ROW LEVEL SECURITY')

    op.create_table(
        'desktop_heartbeats',
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('workers', sa.Integer(), nullable=False),
        sa.Column('busy', sa.Integer(), nullable=False),
        sa.Column('usage', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('version', sa.String(), nullable=False),
        sa.Column('last_seen', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint(
            'workers >= 0 AND busy >= 0 AND busy <= workers', name='desktop_heartbeats_counts'
        ),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('applicant_id'),
    )
    op.execute('ALTER TABLE public.desktop_heartbeats ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema.

    Postgres can't drop an enum value, so the type is rebuilt without the
    three, as 17ea74fa4573's downgrade does. An application Desktop had
    claimed goes back to queued (its review goes with the table), so no row
    is lost. The default and the CHECK name the type, so both come off for
    the rebuild and go back.
    """
    op.drop_table('desktop_heartbeats')
    op.drop_table('application_reviews')
    op.execute(
        "UPDATE job_applications SET stage = 'queued'"
        " WHERE stage IN ('filling', 'review', 'approved')"
    )
    op.drop_constraint('job_applications_applied_dated', 'job_applications', type_='check')
    op.execute("ALTER TABLE job_applications ALTER COLUMN stage DROP DEFAULT")
    op.execute("ALTER TYPE application_stage RENAME TO application_stage_old")
    op.execute(
        "CREATE TYPE application_stage AS ENUM"
        " ('saved', 'queued', 'needs_you', 'skipped', 'applied')"
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
