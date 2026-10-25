"""writing samples: a student's own writing and the style card built from it (KAN-384)

Revision ID: c3e5a7b9d146
Revises: b4d6f8a0c223
Create Date: 2026-10-25 15:00:00.000000

New tables, so it is safe to apply before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3e5a7b9d146'
down_revision: Union[str, Sequence[str], None] = 'b4d6f8a0c223'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'writing_samples',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('length(btrim(text)) > 0', name='writing_samples_text_not_blank'),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_writing_samples_applicant_id'), 'writing_samples', ['applicant_id'], unique=False)
    op.execute('ALTER TABLE public.writing_samples ENABLE ROW LEVEL SECURITY')
    op.create_table(
        'style_cards',
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('card', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('applicant_id'),
    )
    op.execute('ALTER TABLE public.style_cards ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('style_cards')
    op.drop_index(op.f('ix_writing_samples_applicant_id'), table_name='writing_samples')
    op.drop_table('writing_samples')
