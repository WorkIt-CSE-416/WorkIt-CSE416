"""ai usage counters

Revision ID: c804ee165f66
Revises: 824f0b2e3d84
Create Date: 2026-10-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c804ee165f66'
down_revision: Union[str, Sequence[str], None] = '824f0b2e3d84'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# KAN-210: one row per account (or the global pool, account_id NULL), AI
# feature and UTC day, with a count. NULLS NOT DISTINCT (Postgres 15+) makes
# the pool row unique per feature and day, so the upsert's ON CONFLICT finds
# it. Applying it before the code is deployed is safe: nothing reads it yet,
# and Scout's old in-memory cap ignores it.


def upgrade() -> None:
    op.create_table(
        'ai_usage_counters',
        sa.Column('id', sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column('account_id', sa.Uuid(), nullable=True),
        sa.Column('feature', sa.String(length=16), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('count', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ['account_id'], ['auth.users.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'account_id', 'feature', 'day', postgresql_nulls_not_distinct=True
        ),
    )
    # Every new table: deny-all to the anon key (../CLAUDE.md).
    op.execute('ALTER TABLE public.ai_usage_counters ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    op.drop_table('ai_usage_counters')
