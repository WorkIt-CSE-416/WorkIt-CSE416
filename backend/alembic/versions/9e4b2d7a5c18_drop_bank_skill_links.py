"""drop bank_skill_links: a skill is one list per student, never tied to an entry

Revision ID: 9e4b2d7a5c18
Revises: 7c2e9a4b1f63
Create Date: 2026-10-22 18:00:00.000000

The contract half of removing KAN-216's skill links. Apply it only AFTER the
code that stopped reading the table is deployed: the code before it queries
`bank_skill_links` on every bank load, so applying this first makes the
Experiences page, Generate, Tailor and Scout answer 500.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9e4b2d7a5c18'
down_revision: Union[str, Sequence[str], None] = '7c2e9a4b1f63'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_table('bank_skill_links')


def downgrade() -> None:
    """Downgrade schema. The table comes back empty: the links are gone."""
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
    op.create_index('ix_bank_skill_links_entry_id', 'bank_skill_links', ['entry_id'])
    op.execute('ALTER TABLE public.bank_skill_links ENABLE ROW LEVEL SECURITY')
