"""written answers: own, the student's own words (KAN-379)

Revision ID: e5b7d9f1a334
Revises: c7e9a1b3d425
Create Date: 2026-10-25 14:00:00.000000

One column with a default, so it is safe to apply before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5b7d9f1a334'
down_revision: Union[str, Sequence[str], None] = 'c7e9a1b3d425'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('written_answers', sa.Column('own', sa.Boolean(), server_default=sa.text('false'), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('written_answers', 'own')
