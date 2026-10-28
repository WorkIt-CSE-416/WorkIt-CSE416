"""merge main's and batch apply's heads again (KAN-369): no schema change

Revision ID: 6f4275279ffb
Revises: bd730e8ab454, e5b8d2a7c914
Create Date: 2026-10-28 11:29:32.287889

Main's chain since 222a18d55bc2 (notifications, application events and
their stages, job_postings.closed_reason) and batch apply's (fill report
briefs) touch different tables and columns, so either order is safe; this
only joins them.
"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = '6f4275279ffb'
down_revision: Union[str, Sequence[str], None] = ('bd730e8ab454', 'e5b8d2a7c914')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
