"""disabled_job_systems: the per-job-system off switch (KAN-467)

Revision ID: a7c3e9d1f467
Revises: d9b579e66623
Create Date: 2026-10-31 18:00:00.000000

One row per job system WorkIt has turned off, by the Fill engine's id
("workday"). The extension reads the list (GET /extension/config) and stops
filling those job systems, and the queue stops taking their postings, with
no Store release. A new table, so old code ignores it and it is safe to
apply before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c3e9d1f467'
down_revision: Union[str, Sequence[str], None] = 'd9b579e66623'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'disabled_job_systems',
        sa.Column('job_system', sa.String(length=24), nullable=False),
        sa.Column('disabled_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('disabled_by', sa.String(length=320), nullable=False),
        sa.PrimaryKeyConstraint('job_system'),
    )
    op.execute('ALTER TABLE public.disabled_job_systems ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('disabled_job_systems')
