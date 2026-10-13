"""job roles: a scraped job's categories and specialties, filtered with array overlap

Revision ID: 98ab19cfe840
Revises: 5c8d6ee05a0c
Create Date: 2026-10-10 21:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '98ab19cfe840'
down_revision: Union[str, Sequence[str], None] = '5c8d6ee05a0c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # KAN-172: twelve categories and their specialties, up to two categories a
    # job, as the keys the scraper writes ("software", "data_ai/ml"). Plain text,
    # not an enum: a new key is a scraper and API change, never a migration.
    # NOT NULL with an empty default, so a company's own job and any insert that
    # names no roles store {} and an overlap filter simply never matches them.
    op.add_column(
        'job_postings',
        sa.Column('roles', postgresql.ARRAY(sa.Text()), nullable=False,
                  server_default=sa.text("'{}'::text[]")),
    )
    # Expand, then contract: role_category stays, because the API deployed when
    # this is applied still reads and writes it, and the import keeps writing it
    # until a later cleanup drops it. Seed roles from it so the new API filters
    # every job by its category from the start; the next import rewrites each
    # job's roles whole, specialties included.
    op.execute(
        "UPDATE job_postings SET roles = ARRAY[role_category::text]"
        " WHERE role_category IS NOT NULL"
    )
    # GIN, so `roles && ARRAY[...]` (GET /jobs?role=) looks rows up rather than
    # scanning. Built after the backfill, which then writes no index entries.
    op.create_index('job_postings_roles_idx', 'job_postings', ['roles'], unique=False,
                    postgresql_using='gin')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('job_postings_roles_idx', table_name='job_postings',
                  postgresql_using='gin')
    op.drop_column('job_postings', 'roles')
