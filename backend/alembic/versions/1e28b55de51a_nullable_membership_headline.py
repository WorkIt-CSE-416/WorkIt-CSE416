"""nullable membership headline

Revision ID: 1e28b55de51a
Revises: ce5b2e3f9b78
Create Date: 2026-09-28 17:23:17.104778

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1e28b55de51a'
down_revision: Union[str, Sequence[str], None] = 'ce5b2e3f9b78'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Company signup creates the owner's membership row, and the signup form
    # collects no headline — NOT NULL would fail that insert.
    op.alter_column(
        "company_memberships", "headline", existing_type=sa.String(length=50), nullable=True
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Fails if any membership has a NULL headline by then; backfill those rows
    # first rather than inventing a headline for them.
    op.alter_column(
        "company_memberships", "headline", existing_type=sa.String(length=50), nullable=False
    )
