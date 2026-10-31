"""job_system_requests: Request this job system from the extension (KAN-369)

Revision ID: d8a3f5c1e7b2
Revises: c4e1a9f2d803
Create Date: 2026-10-26 18:00:00.000000

One row per press of the popup's Request this job system on a job page
WorkIt can't fill: the page's host and when. No account column: a request
names no student. A new table, so old code ignores it and it is safe to
apply before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8a3f5c1e7b2'
down_revision: Union[str, Sequence[str], None] = 'c4e1a9f2d803'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'job_system_requests',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('host', sa.String(length=253), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_job_system_requests_host'), 'job_system_requests', ['host'], unique=False)
    op.execute('ALTER TABLE public.job_system_requests ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_job_system_requests_host'), table_name='job_system_requests')
    op.drop_table('job_system_requests')
