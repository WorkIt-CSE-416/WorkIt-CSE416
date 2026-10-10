"""job matching embeddings and full-text search

Revision ID: 4485d7a7a712
Revises: b81d4e2f6c09
Create Date: 2026-10-09 23:10:03.100364

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4485d7a7a712'
down_revision: Union[str, Sequence[str], None] = 'b81d4e2f6c09'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # By hand: autogenerate emits no extension, and would write the vector
    # type unqualified (alembic/CLAUDE.md). pgvector goes into `extensions`
    # like pg_trgm (55f3c813be50), and the type is qualified because only
    # Supabase puts that schema on the search path.
    op.execute('CREATE SCHEMA IF NOT EXISTS extensions')
    op.execute('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions')
    # 768 is dto.EMBEDDING_DIMENSIONS; Postgres refuses a vector of another size.
    op.execute('ALTER TABLE job_postings ADD COLUMN embedding extensions.vector(768)')
    op.execute('ALTER TABLE resumes ADD COLUMN embedding extensions.vector(768)')
    # Generated: filled for every existing row now and kept current on every
    # write, so nothing in the import has to change for it.
    op.execute(
        "ALTER TABLE job_postings ADD COLUMN fts tsvector GENERATED ALWAYS AS "
        "(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))) STORED"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('job_postings', 'fts')
    op.drop_column('resumes', 'embedding')
    op.drop_column('job_postings', 'embedding')
    # This revision installed it, so this revision removes it, like 55f3c813be50.
    op.execute('DROP EXTENSION IF EXISTS vector')
