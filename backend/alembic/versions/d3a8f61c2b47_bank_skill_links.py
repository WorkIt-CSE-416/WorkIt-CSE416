"""skill links: join a bank skill to the entries that show it

Revision ID: d3a8f61c2b47
Revises: b7e2a4c91d06
Create Date: 2026-10-13 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3a8f61c2b47'
down_revision: Union[str, Sequence[str], None] = 'b7e2a4c91d06'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'bank_skill_links',
        sa.Column('skill_id', sa.Uuid(), nullable=False),
        sa.Column('entry_id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['skill_id'], ['bank_skills.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['entry_id'], ['bank_entries.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('skill_id', 'entry_id'),
    )
    # The primary key serves lookups by skill; this one serves "skills of an entry".
    op.create_index('ix_bank_skill_links_entry_id', 'bank_skill_links', ['entry_id'])
    # By hand: autogenerate never emits RLS (alembic/CLAUDE.md). ENABLE, never FORCE.
    op.execute('ALTER TABLE public.bank_skill_links ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('bank_skill_links')
