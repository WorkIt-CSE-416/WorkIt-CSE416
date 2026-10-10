"""job location label: a card's location, as "San Francisco, CA"

Revision ID: 5c8d6ee05a0c
Revises: aa41fdc1ba80
Create Date: 2026-10-10 18:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '5c8d6ee05a0c'
down_revision: Union[str, Sequence[str], None] = 'aa41fdc1ba80'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Display text only (KAN-171): the import writes it from the city the
    # location resolver already picks. Nothing filters on it, so no index,
    # and job_locations is unchanged. Nullable: the import leaves it empty
    # where it has nothing better than location_raw, and a company's own job
    # never has one.
    op.add_column('job_postings', sa.Column('location_label', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('job_postings', 'location_label')
