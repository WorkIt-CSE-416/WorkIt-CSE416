"""application events: read_at, when the student read an email (KAN-427)

Revision ID: dc36d2d2321c
Revises: f4a8c1d6e273
Create Date: 2026-10-28 12:00:00.000000

The Inbox keeps read and unread as Gmail does: opening an email, or Mark
as Read, sets it; Mark as Unread clears it. NULL is unread, and it means
nothing on an event the student typed (source `manual`), which is never in
the Inbox.

Until now the list's dot meant "needs review" (status `proposed`), so the
backfill keeps every dot where it is: an email already accepted or
dismissed counts as read when it was decided (or stored, for one filed at
once), and a proposed one stays unread.

Old code ignores the column, so apply it BEFORE the deploy that maps it:
that code selects read_at with every event row, and deployed first, the
Inbox, the Calendar and every application's events fail ("column
application_events.read_at does not exist").
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dc36d2d2321c'
down_revision: Union[str, Sequence[str], None] = 'f4a8c1d6e273'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'application_events', sa.Column('read_at', sa.DateTime(timezone=True), nullable=True)
    )
    op.execute(
        "UPDATE application_events SET read_at = COALESCE(decided_at, created_at) "
        "WHERE source = 'gmail' AND status <> 'proposed'"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('application_events', 'read_at')
