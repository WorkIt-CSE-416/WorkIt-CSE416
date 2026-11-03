"""unlisted job postings

KAN-542 (ADR 0008): a job that WorkIt does not list, added by one student
by its link so the Applications Tracker can hold it. Only that student sees
it; the feed import publishes it when the scraper finds the same job.

Revision ID: c2e4a6b8d051
Revises: e1a7c3d5b9f2
Create Date: 2026-11-02 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c2e4a6b8d051'
down_revision: Union[str, Sequence[str], None] = 'e1a7c3d5b9f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Autogenerate never emits enum values (alembic/CLAUDE.md). ADD VALUE runs
    # outside the migration's transaction, as 1ea834081a48's does.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE job_post_status ADD VALUE IF NOT EXISTS 'unlisted' AFTER 'closed'")


def downgrade() -> None:
    """Downgrade schema."""
    # Postgres can't drop an enum value, so the type is rebuilt without it.
    # An unlisted posting has no listed state to go back to; it closes, so
    # the applications on it stay and no student sees it in search.
    op.execute("UPDATE job_postings SET status = 'closed' WHERE status = 'unlisted'")
    op.execute("ALTER TYPE job_post_status RENAME TO job_post_status_old")
    op.execute("CREATE TYPE job_post_status AS ENUM ('draft', 'published', 'paused', 'closed')")
    op.execute("ALTER TABLE job_postings ALTER COLUMN status DROP DEFAULT")
    op.execute(
        "ALTER TABLE job_postings ALTER COLUMN status TYPE job_post_status "
        "USING status::text::job_post_status"
    )
    op.execute("ALTER TABLE job_postings ALTER COLUMN status SET DEFAULT 'published'")
    op.execute("DROP TYPE job_post_status_old")
