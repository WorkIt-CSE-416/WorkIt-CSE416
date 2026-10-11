"""weighted fts and its index

Revision ID: a70c641b2f99
Revises: ab07572bba38
Create Date: 2026-10-11 13:48:32.152264

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a70c641b2f99'
down_revision: Union[str, Sequence[str], None] = 'ab07572bba38'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The title weighted A and the description D, so ts_rank puts a job whose
# title holds the words above one whose description only mentions them: a
# mechanical job that says "you'll work with our software engineers" no longer
# ranks for "software engineer" beside the software jobs (docs/search.md). The
# same expression as Job_Post.fts in app/models/jobs.py.
WEIGHTED = (
    "setweight(to_tsvector('english', coalesce(title, '')), 'A') || "
    "setweight(to_tsvector('english', coalesce(description, '')), 'D')"
)
UNWEIGHTED = "to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))"


def upgrade() -> None:
    """Upgrade schema."""
    # By hand: a generated column's expression can't be altered in place on
    # every Postgres version, so it is dropped and added again, which
    # computes it for every row. @@ ignores weights, so matching's skill
    # overlap (services/matching) reads it unchanged.
    op.drop_column('job_postings', 'fts')
    op.execute(f"ALTER TABLE job_postings ADD COLUMN fts tsvector GENERATED ALWAYS AS ({WEIGHTED}) STORED")
    # GIN, so a search's fts @@ query looks rows up rather than reading every
    # posting's text. Built after the column is filled.
    op.create_index('job_postings_fts_idx', 'job_postings', ['fts'], postgresql_using='gin')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('job_postings_fts_idx', table_name='job_postings', postgresql_using='gin')
    op.drop_column('job_postings', 'fts')
    op.execute(f"ALTER TABLE job_postings ADD COLUMN fts tsvector GENERATED ALWAYS AS ({UNWEIGHTED}) STORED")
