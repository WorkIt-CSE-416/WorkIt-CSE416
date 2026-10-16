"""job posting keywords: Tailor's keywords, cached with a hash of the description

Revision ID: e1c4a7b9d215
Revises: 5753545063f3
Create Date: 2026-10-13 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e1c4a7b9d215'
down_revision: Union[str, Sequence[str], None] = '5753545063f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('job_postings', sa.Column('keywords', postgresql.JSONB(), nullable=True))
    op.add_column('job_postings', sa.Column('keywords_hash', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('job_postings', 'keywords_hash')
    op.drop_column('job_postings', 'keywords')
