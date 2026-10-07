"""trigram search indexes

Revision ID: 55f3c813be50
Revises: b40588efa7b7
Create Date: 2026-10-06 19:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '55f3c813be50'
down_revision: Union[str, Sequence[str], None] = 'b40588efa7b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Autogenerate emits neither the extension nor the operator class
    # (alembic/CLAUDE.md), so all of this is by hand.
    # Supabase keeps extensions in its own `extensions` schema, and its Security
    # Advisor flags one installed in public. A plain Postgres has no such schema,
    # hence the CREATE SCHEMA; on Supabase it already exists and this is a no-op.
    op.execute('CREATE SCHEMA IF NOT EXISTS extensions')
    op.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions')
    # Qualified, because only Supabase puts `extensions` on the search path.
    op.execute(
        'CREATE INDEX job_postings_title_trgm_idx ON job_postings '
        'USING gin (title extensions.gin_trgm_ops)'
    )
    op.execute(
        'CREATE INDEX job_postings_company_name_trgm_idx ON job_postings '
        'USING gin (company_name extensions.gin_trgm_ops)'
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('job_postings_company_name_trgm_idx', table_name='job_postings')
    op.drop_index('job_postings_title_trgm_idx', table_name='job_postings')
    # This revision installed it, so this revision removes it. The schema
    # stays: Supabase owns it.
    op.execute('DROP EXTENSION IF EXISTS pg_trgm')
