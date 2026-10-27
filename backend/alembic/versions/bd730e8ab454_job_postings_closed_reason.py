"""job_postings.closed_reason: why the import closed a scraped job

KAN-412: the import closes every scraped job missing from the feed, and until
now nothing said why it went missing. The scraper now says (closings.json),
and the import writes it here: gone_from_board (two complete reads of its
board lacked it), board_gone (its board said "no such board" twice),
filtered_out (the shortlist no longer keeps its title), replaced (another
copy of its requisition leads its card), or unknown (no reason given: a lost
store cache, a local or older feed). A wrong close can then be found by
reason and run (closes_at), and its cause fixed.

Text with a CHECK, not an enum: a new reason is then one migration that
rolls back, where ALTER TYPE ... ADD VALUE does not (alembic/CLAUDE.md).
Null is a job still open, closed before this column, or closed by its
company. No backfill.

Apply it as soon as it merges: nothing reads or writes the column yet, so
every deploy is safe with it. The code that writes it follows in its own PR,
whose import fails on a database without it.

Revision ID: bd730e8ab454
Revises: c4e8a2f6d1b3
Create Date: 2026-10-27 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bd730e8ab454'
down_revision: Union[str, Sequence[str], None] = 'c4e8a2f6d1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('job_postings', sa.Column('closed_reason', sa.Text(), nullable=True))
    op.create_check_constraint(
        'job_postings_closed_reason',
        'job_postings',
        "closed_reason IS NULL OR closed_reason IN"
        " ('gone_from_board','board_gone','filtered_out','replaced','unknown')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('job_postings_closed_reason', 'job_postings', type_='check')
    op.drop_column('job_postings', 'closed_reason')
