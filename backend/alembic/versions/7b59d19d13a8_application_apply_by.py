"""job applications: apply_by, the student's own date to apply by (KAN-429)

Revision ID: 7b59d19d13a8
Revises: dc36d2d2321c
Create Date: 2026-10-28 12:00:00.000000

A saved job's target date, which the Calendar shows as Apply by. It is
the student's own, usually earlier than the posting's closing date
(`job_postings.closes_at`), which most scraped postings never publish. A
date, not an instant: a day to apply by reads the same in every zone, as
an assessment's `on_day` does. NULL while none is set; nothing fills it.

Old code ignores the column, so apply it BEFORE the deploy that maps it:
that code selects apply_by with every application row, and deployed
first, the Applications Tracker, the Calendar, Home and auto apply's queue
fail ("column job_applications.apply_by does not exist").
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7b59d19d13a8'
down_revision: Union[str, Sequence[str], None] = 'dc36d2d2321c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('job_applications', sa.Column('apply_by', sa.Date(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('job_applications', 'apply_by')
