"""bank sources: the uploaded resumes each bank entry and skill was read from

Revision ID: 7c2e9a4b1f63
Revises: 3aa342c5a064
Create Date: 2026-10-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7c2e9a4b1f63'
down_revision: Union[str, Sequence[str], None] = '3aa342c5a064'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    for table, item, parent in (
        ('bank_entry_sources', 'entry_id', 'bank_entries'),
        ('bank_skill_sources', 'skill_id', 'bank_skills'),
    ):
        op.create_table(
            table,
            sa.Column(item, sa.Uuid(), nullable=False),
            sa.Column('resume_id', sa.Uuid(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.ForeignKeyConstraint([item], [f'{parent}.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['resume_id'], ['resumes.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint(item, 'resume_id'),
        )
        # The primary key serves the bank read; this one the cascade from
        # resumes and Import Updated Resume's clearing.
        op.create_index(f'ix_{table}_resume_id', table, ['resume_id'])
        # By hand: autogenerate never emits RLS (alembic/CLAUDE.md). ENABLE, never FORCE.
        op.execute(f'ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('bank_skill_sources')
    op.drop_table('bank_entry_sources')
