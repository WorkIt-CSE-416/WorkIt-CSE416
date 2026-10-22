"""desktop leases

KAN-323 (auto-apply/desktop.md, "Leases"): a claim stamps its application
with when it was claimed and which running Desktop claimed it, so a claim can
send back to queued every `filling` application that Desktop no longer holds:
claimed by an earlier run of Desktop (a restart), or held past its lease (a
fill whose review or finish never reached WorkIt).
`job_applications` gains `claimed_at` and `claimed_by`; `desktop_heartbeats`
gains `instance`, the running Desktop's id.

Only adds nullable columns: the code before the deploy never reads them.

Revision ID: b7c1e9d4a2f0
Revises: 40329c7aef62
Create Date: 2026-10-22 04:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c1e9d4a2f0'
down_revision: Union[str, Sequence[str], None] = '40329c7aef62'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('job_applications', sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('job_applications', sa.Column('claimed_by', sa.Uuid(), nullable=True))
    op.add_column('desktop_heartbeats', sa.Column('instance', sa.Uuid(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('desktop_heartbeats', 'instance')
    op.drop_column('job_applications', 'claimed_by')
    op.drop_column('job_applications', 'claimed_at')
