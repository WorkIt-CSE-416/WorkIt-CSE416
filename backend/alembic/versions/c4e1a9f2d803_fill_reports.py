"""fill_reports: problem reports from the extension's panel (KAN-403)

Revision ID: c4e1a9f2d803
Revises: b7d41c09e2a6
Create Date: 2026-10-26 12:00:00.000000

One row per report a student sent with Report a problem: the job system,
the posting's public link, the Fill engine's version, each failed field's
kind, label shape and error name (JSONB), and their note. No account
column: a report names no student. A new table, so old code ignores it and
it is safe to apply before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c4e1a9f2d803'
down_revision: Union[str, Sequence[str], None] = 'b7d41c09e2a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'fill_reports',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('job_system', sa.String(length=24), nullable=False),
        sa.Column('posting_url', sa.Text(), nullable=False),
        sa.Column('engine_version', sa.String(length=64), nullable=False),
        sa.Column('fields', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.execute('ALTER TABLE public.fill_reports ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('fill_reports')
