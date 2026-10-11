"""job role category: which of the five disciplines a scraped role is in

Revision ID: aa41fdc1ba80
Revises: 4485d7a7a712
Create Date: 2026-10-10 15:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'aa41fdc1ba80'
down_revision: Union[str, Sequence[str], None] = '4485d7a7a712'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The SimplifyJobs lists' five categories, which the scraper's boards come
# from (KAN-171, scraper/workit_scraper/shortlist.py). One per scraped role.
role_category = postgresql.ENUM(
    'software', 'data_ai', 'product', 'quant', 'hardware', name='role_category'
)


def upgrade() -> None:
    """Upgrade schema."""
    role_category.create(op.get_bind(), checkfirst=True)
    # Nullable: a company's own job has none, and a scraped row has none until
    # the next import fills it, which the import does for every job in the feed.
    op.add_column(
        'job_postings',
        sa.Column('role_category', postgresql.ENUM(name='role_category', create_type=False),
                  nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('job_postings', 'role_category')
    role_category.drop(op.get_bind(), checkfirst=True)
