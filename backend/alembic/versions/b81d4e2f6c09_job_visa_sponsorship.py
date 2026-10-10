"""job visa sponsorship: what a scraped posting says about visas

Revision ID: b81d4e2f6c09
Revises: 7c2e9a41d5b3
Create Date: 2026-10-09 16:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b81d4e2f6c09'
down_revision: Union[str, Sequence[str], None] = '7c2e9a41d5b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The three things a posting can say; saying nothing is NULL, not a fourth
# value (KAN-168, scraper/workit_scraper/details.py).
visa_sponsorship = postgresql.ENUM(
    'sponsors', 'no_sponsorship', 'citizens_only', name='visa_sponsorship'
)


def upgrade() -> None:
    """Upgrade schema."""
    visa_sponsorship.create(op.get_bind(), checkfirst=True)
    # Nullable and empty until the next import fills it, which the import does
    # for every job in the feed: a row the scraper says nothing about stays NULL.
    op.add_column(
        'job_postings',
        sa.Column('sponsorship', postgresql.ENUM(name='visa_sponsorship', create_type=False),
                  nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('job_postings', 'sponsorship')
    visa_sponsorship.drop(op.get_bind(), checkfirst=True)
