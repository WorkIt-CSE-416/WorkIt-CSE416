"""resume text hash

KAN-267: each uploaded resume's text hash, so an upload of a resume the
student already has is refused ("Duplicate Resume found: <name>"). The
partial unique index backs the check in the API, so two uploads at once
cannot both pass it. Rows from before have NULL and are never matched: no
backfill (docs/sent_resume.md).

Apply it before the deploy that writes it: the new code names `text_hash`
in every upload's INSERT, so deployed first, every upload answers 500.
Applied early, the running code never meets the column (nullable, no
default needed).

Revision ID: d642d93fcfbc
Revises: a7d3e5c1b942
Create Date: 2026-10-20 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd642d93fcfbc'
down_revision: Union[str, Sequence[str], None] = 'a7d3e5c1b942'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('resumes', sa.Column('text_hash', sa.String(), nullable=True))
    op.create_index(
        'resumes_text_hash_key', 'resumes', ['applicant_id', 'text_hash'],
        unique=True, postgresql_where=sa.text('text_hash IS NOT NULL'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('resumes_text_hash_key', table_name='resumes')
    op.drop_column('resumes', 'text_hash')
