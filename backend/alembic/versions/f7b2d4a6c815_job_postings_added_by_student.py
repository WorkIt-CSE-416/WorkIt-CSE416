"""job_postings.added_by_student: a job a student added from its form

KAN-515: on a form whose job WorkIt doesn't list, the extension's Write with
Claude adds the job from the page (company, title, link) with the student's
application at needs_you, so their Claude can write its questions through
the connector. This column marks such a job: no Jobs feed, count, filter,
recommendation or link lookup reads it (services/postings.py LISTED), and
the feed import neither closes it nor claims it unless the feed lists its
link. Every existing row is false: none was added by a student.

Apply it before the code that reads it deploys: LISTED names the column, so
every Jobs page query fails on a database without it. Adding a NOT NULL
column with a constant default is metadata only on Postgres 11+, so it takes
no table rewrite.

Revision ID: f7b2d4a6c815
Revises: d3f5a7c9e162
Create Date: 2026-11-01 22:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7b2d4a6c815'
down_revision: Union[str, Sequence[str], None] = 'd3f5a7c9e162'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'job_postings',
        sa.Column('added_by_student', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('job_postings', 'added_by_student')
