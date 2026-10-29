"""application events: ends_at, when a timed event ends (KAN-429)

Revision ID: 0d8dd3b7d8fd
Revises: 7b59d19d13a8
Create Date: 2026-10-28 13:00:00.000000

The Calendar's Day and Week views draw a timed event (an interview, an
assessment with a cut-off) as a block from `at` to its end, as Google
Calendar does. NULL for a day-only event (`on_day`), for one with no end
given, and for every row there now: the Calendar draws those an hour long.
A CHECK keeps an end after its start and only on a timed event.

Old code ignores the column, so apply it BEFORE the deploy that maps it:
that code selects ends_at with every event row, and deployed first, the
Applications Tracker, the Calendar and every application's events fail
("column application_events.ends_at does not exist").
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0d8dd3b7d8fd'
down_revision: Union[str, Sequence[str], None] = '7b59d19d13a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'application_events', sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True)
    )
    op.create_check_constraint(
        'application_events_ends_after_start',
        'application_events',
        'ends_at IS NULL OR (at IS NOT NULL AND ends_at > at)',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('application_events_ends_after_start', 'application_events', type_='check')
    op.drop_column('application_events', 'ends_at')
