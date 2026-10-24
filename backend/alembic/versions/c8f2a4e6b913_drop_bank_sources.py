"""drop bank_entry_sources and bank_skill_sources: the owner column replaced them (ADR 0005)

Revision ID: c8f2a4e6b913
Revises: b5e1c3a7d920
Create Date: 2026-10-23 12:30:00.000000

The contract half of ADR 0005. Apply it only AFTER the code that stopped
reading the tables is deployed: the code before it reads them on every
GET /bank and writes them on every upload, so applying this first makes the
Experiences page and every upload answer 500. The order: `uv run alembic
upgrade b5e1c3a7d920`, merge and deploy, then `uv run alembic upgrade head`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c8f2a4e6b913'
down_revision: Union[str, Sequence[str], None] = 'b5e1c3a7d920'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_table('bank_skill_sources')
    op.drop_table('bank_entry_sources')


def downgrade() -> None:
    """Downgrade schema. The tables come back filled from the owner column:
    one source per owned item."""
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
        op.create_index(f'ix_{table}_resume_id', table, ['resume_id'])
        op.execute(f'ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY')
        op.execute(
            f'INSERT INTO {table} ({item}, resume_id) SELECT id, resume_id FROM {parent} WHERE resume_id IS NOT NULL')
