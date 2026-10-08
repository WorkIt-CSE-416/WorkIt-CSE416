"""drop title trigram index

Revision ID: 4cfa4c1836cd
Revises: 4138dcee44b1
Create Date: 2026-10-07 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '4cfa4c1836cd'
down_revision: Union[str, Sequence[str], None] = '4138dcee44b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Title search isn't trigram-based any more; the company_name index stays,
    # and so does pg_trgm, which it still needs.
    op.drop_index('job_postings_title_trgm_idx', table_name='job_postings')


def downgrade() -> None:
    """Downgrade schema."""
    # Qualified for the same reason as in 55f3c813be50: only Supabase puts
    # `extensions` on the search path.
    op.execute(
        'CREATE INDEX job_postings_title_trgm_idx ON job_postings '
        'USING gin (title extensions.gin_trgm_ops)'
    )
