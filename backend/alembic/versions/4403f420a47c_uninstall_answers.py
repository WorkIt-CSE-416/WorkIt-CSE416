"""uninstall_answers: the extension's uninstall survey (KAN-471)

Revision ID: 4403f420a47c
Revises: a7c3e9d1f467
Create Date: 2026-10-31 18:00:00.000000

One row per answer to the webapp's /uninstalled page, which removing the
extension opens: the reason picked, an optional line and the version
removed. No account or address column: an answer names no student. A new
table, so old code ignores it and it is safe to apply before or after the
deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4403f420a47c'
down_revision: Union[str, Sequence[str], None] = 'a7c3e9d1f467'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'uninstall_answers',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('reason', sa.String(length=32), nullable=False),
        sa.Column('detail', sa.String(length=500), nullable=True),
        sa.Column('extension_version', sa.String(length=32), nullable=True),
        sa.CheckConstraint(
            "reason IN ('bad_fills', 'missing_sites', 'found_job', 'other_tool', 'privacy', 'other')",
            name='uninstall_answers_reason_check',
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_uninstall_answers_created_at'), 'uninstall_answers', ['created_at'], unique=False)
    op.execute('ALTER TABLE public.uninstall_answers ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_uninstall_answers_created_at'), table_name='uninstall_answers')
    op.drop_table('uninstall_answers')
