"""writing samples: imported, a sample the Apply import brought (KAN-369)

Revision ID: 3e24ae7b3905
Revises: e4a7c2f9b810
Create Date: 2026-10-25 23:30:00.000000

A new boolean, false for every row there now. The Apply import
(scripts/import_apply_writing.py) replaces only the samples it marked, so a
sample the student added in WorkIt is never deleted by it. Old code ignores
the column, so it is safe to apply before or after.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3e24ae7b3905'
down_revision: Union[str, Sequence[str], None] = 'e4a7c2f9b810'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('writing_samples', sa.Column('imported', sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('writing_samples', 'imported')
