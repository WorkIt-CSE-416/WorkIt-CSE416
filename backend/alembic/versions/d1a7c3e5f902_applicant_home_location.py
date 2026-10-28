"""applicant home location: the city and state application forms ask for (KAN-372)

Revision ID: d1a7c3e5f902
Revises: c8f2a4e6b913
Create Date: 2026-10-25 12:00:00.000000

Additive and nullable, so it is safe to apply before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1a7c3e5f902'
down_revision: Union[str, Sequence[str], None] = 'c8f2a4e6b913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('applicant_profiles', sa.Column('location', sa.String(length=100), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('applicant_profiles', 'location')
