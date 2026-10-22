"""desktop paused

KAN-323 (auto-apply/desktop.md): Desktop stops taking applications near the
student's Claude plan limit; its heartbeat now says so, so the website can
show it instead of looking idle. `desktop_heartbeats` gains `paused` and
`paused_reason`.

Only adds a column with a default and a nullable one: the code before the
deploy never reads them.

Revision ID: d4e6a8b0c2f3
Revises: c3d5f7a9b1e2
Create Date: 2026-10-22 05:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e6a8b0c2f3'
down_revision: Union[str, Sequence[str], None] = 'c3d5f7a9b1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'desktop_heartbeats',
        sa.Column('paused', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    op.add_column('desktop_heartbeats', sa.Column('paused_reason', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('desktop_heartbeats', 'paused_reason')
    op.drop_column('desktop_heartbeats', 'paused')
