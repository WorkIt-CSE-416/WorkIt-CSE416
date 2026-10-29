"""company briefs: one checked brief per company, shared by every student (KAN-382)

Revision ID: c7e9a1b3d425
Revises: b4d6f8a0c223
Create Date: 2026-10-25 18:00:00.000000

A new table, so it is safe to apply before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c7e9a1b3d425'
down_revision: Union[str, Sequence[str], None] = 'b4d6f8a0c223'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'company_briefs',
        sa.Column('company_key', sa.Text(), nullable=False),
        sa.Column('company', sa.Text(), nullable=False),
        sa.Column('facts', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column('saved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('attempted_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('company_key'),
    )
    op.execute('ALTER TABLE public.company_briefs ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('company_briefs')
