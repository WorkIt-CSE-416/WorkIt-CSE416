"""add paused job status

Revision ID: 1ea834081a48
Revises: 1e28b55de51a
Create Date: 2026-10-02 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '1ea834081a48'
down_revision: Union[str, Sequence[str], None] = '1e28b55de51a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Autogenerate never emits enum values (alembic/CLAUDE.md). ADD VALUE runs
    # outside the migration's transaction: a value added inside one can't be
    # used until that transaction commits, and older Postgres refuses it there
    # outright.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE job_post_status ADD VALUE IF NOT EXISTS 'paused' AFTER 'published'")


def downgrade() -> None:
    """Downgrade schema."""
    # Postgres can't drop an enum value, so the type is rebuilt without it.
    # Paused jobs go back to published: pausing only ever happens to a
    # published job, so that is the state they came from.
    op.execute("UPDATE job_postings SET status = 'published' WHERE status = 'paused'")
    op.execute("ALTER TYPE job_post_status RENAME TO job_post_status_old")
    op.execute("CREATE TYPE job_post_status AS ENUM ('draft', 'published', 'closed')")
    op.execute("ALTER TABLE job_postings ALTER COLUMN status DROP DEFAULT")
    op.execute(
        "ALTER TABLE job_postings ALTER COLUMN status TYPE job_post_status "
        "USING status::text::job_post_status"
    )
    op.execute("ALTER TABLE job_postings ALTER COLUMN status SET DEFAULT 'draft'")
    op.execute("DROP TYPE job_post_status_old")
