"""fill_reports.alerted_at: when an admin alert named the report's group (KAN-478)

Revision ID: c5e7a9b1d024
Revises: b2d4f6a8c013
Create Date: 2026-10-31 17:40:00.000000

app/services/fill_report_alerts.py emails the admins about a group (a
signature) none of whose reports an alert has named yet, then stamps them.
The reports already stored are stamped with when they were sent, so the
first run doesn't email about every old group. Nullable, so old code
ignores it; safe before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c5e7a9b1d024'
down_revision: Union[str, Sequence[str], None] = 'b2d4f6a8c013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('fill_reports', sa.Column('alerted_at', sa.DateTime(timezone=True), nullable=True))
    op.execute('UPDATE fill_reports SET alerted_at = created_at')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('fill_reports', 'alerted_at')
