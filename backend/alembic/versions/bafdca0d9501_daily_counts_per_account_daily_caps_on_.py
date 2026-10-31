"""daily_counts: per-account daily caps on the extension's writes (KAN-478)

Revision ID: bafdca0d9501
Revises: d9b579e66623
Create Date: 2026-10-31 17:04:10.798101

One row per account, kind of write (fill_report, job_system_request) and
UTC day: how many it made (app/services/daily_caps.py). A new table, so old
code ignores it and it is safe to apply before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bafdca0d9501'
down_revision: Union[str, Sequence[str], None] = 'd9b579e66623'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'daily_counts',
        sa.Column('account_id', sa.Uuid(), nullable=False),
        sa.Column('kind', sa.String(length=24), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('count', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['account_id'], ['auth.users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('account_id', 'kind', 'day'),
    )
    op.execute('ALTER TABLE public.daily_counts ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('daily_counts')
