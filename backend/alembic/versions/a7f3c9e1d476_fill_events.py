"""fill_events: one fill's numbers from the extension (KAN-476)

Revision ID: a7f3c9e1d476
Revises: a7c3e9d1f467
Create Date: 2026-10-31 18:00:00.000000

One row per fill the extension ran, single or batch: the job system, the
Fill engine's and the extension's versions, the field counts (filled,
guessed, needs you, failed), the error names with a count each, and the
duration. No value, answer or link. account_id caps one account's events a
day and goes with the account. Kept 90 days by KAN-482's purge
(services/retention.py, which skips the table until this exists). A new
table, so old code ignores it and it is safe to apply before or after the
deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a7f3c9e1d476'
down_revision: Union[str, Sequence[str], None] = 'a7c3e9d1f467'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'fill_events',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('account_id', sa.Uuid(), nullable=False),
        sa.Column('job_system', sa.String(length=24), nullable=False),
        sa.Column('engine_version', sa.String(length=64), nullable=False),
        sa.Column('extension_version', sa.String(length=32), nullable=False),
        sa.Column('mode', sa.String(length=8), nullable=False),
        sa.Column('fields', sa.Integer(), nullable=False),
        sa.Column('filled', sa.Integer(), nullable=False),
        sa.Column('guessed', sa.Integer(), nullable=False),
        sa.Column('needs_you', sa.Integer(), nullable=False),
        sa.Column('failed', sa.Integer(), nullable=False),
        sa.Column('errors', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('duration_ms', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['account_id'], ['auth.users.id'], name='fill_events_account_id_fkey', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_fill_events_created_at', 'fill_events', ['created_at'])
    op.create_index('ix_fill_events_account_id_created_at', 'fill_events', ['account_id', 'created_at'])
    op.execute('ALTER TABLE public.fill_events ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('fill_events')
