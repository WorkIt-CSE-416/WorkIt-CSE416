"""notifications

KAN-298: the top bar's bell, fed for the first time -- one row per daily
job-match digest (ten jobs in `data`, not ten rows), written only by
app/services/job_alerts.py. Also adds applicant_profiles.job_alerts_enabled,
the Settings opt-in that gates both the bell and the digest email, default
false so an existing account is never surprised by a new unsolicited email
the day this ships. Nothing reads either before the deploy that adds the
notifications routes and the Settings toggle, so applying this early is
safe; deployed first, Settings' PATCH and the bell's GET both answer with a
column/table that doesn't exist.

Revision ID: 89d598a1667d
Revises: 5a6e419367b8
Create Date: 2026-10-21 00:47:20.397537

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '89d598a1667d'
down_revision: Union[str, Sequence[str], None] = '5a6e419367b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'applicant_profiles',
        sa.Column('job_alerts_enabled', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )

    op.create_table(
        'notifications',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('type', sa.String(length=32), nullable=False),
        sa.Column('title', sa.String(length=100), nullable=False),
        sa.Column('body', sa.String(length=200), nullable=False),
        sa.Column(
            'data', postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"), nullable=False,
        ),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("jsonb_typeof(data) = 'array'", name='notifications_data_array'),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_notifications_applicant_id'), 'notifications', ['applicant_id'], unique=False)
    # By hand: autogenerate never emits RLS (alembic/CLAUDE.md). ENABLE, never FORCE.
    op.execute('ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('notifications')
    op.drop_column('applicant_profiles', 'job_alerts_enabled')
