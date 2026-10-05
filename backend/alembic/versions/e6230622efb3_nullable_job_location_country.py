"""nullable job location country

Revision ID: e6230622efb3
Revises: 4b3c00b5167d
Create Date: 2026-10-05 18:41:12.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e6230622efb3'
down_revision: Union[str, Sequence[str], None] = '4b3c00b5167d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # The country FK and the state_requires_country CHECK stay: a NULL country
    # passes the FK, and a state still can't be set without its country.
    op.alter_column("job_postings", "location_country", existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    # Fails if any posting has a NULL country by then; backfill those with ZZ
    # or delete them first rather than inventing a real country for them.
    op.alter_column("job_postings", "location_country", existing_type=sa.String(), nullable=False)
