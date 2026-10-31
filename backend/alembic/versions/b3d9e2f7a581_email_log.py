"""email_log: the notice send log and the bounce/complaint suppressions (KAN-483)

Revision ID: b3d9e2f7a581
Revises: c5e7a9b1d024
Create Date: 2026-10-31 20:00:00.000000

Two new tables (app/models/email_log.py): `email_sends`, one row per
address a notice reached, so a re-run sends nothing twice, and
`email_suppressions`, addresses that bounced or complained. New tables, so
old code ignores them and it is safe to apply before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3d9e2f7a581'
down_revision: Union[str, Sequence[str], None] = 'c5e7a9b1d024'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'email_sends',
        sa.Column('id', sa.Integer(), sa.Identity(), nullable=False),
        sa.Column('campaign', sa.String(length=100), nullable=False),
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('sent_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('campaign', 'email', name='email_sends_campaign_email_key'),
    )
    op.create_table(
        'email_suppressions',
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('reason', sa.String(length=32), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('email'),
    )
    op.execute('ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('email_suppressions')
    op.drop_table('email_sends')
