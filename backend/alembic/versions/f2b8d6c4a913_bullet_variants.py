"""bullet variants, and the variant a built resume's bullet shows

Revision ID: f2b8d6c4a913
Revises: e1f4a7c20b58
Create Date: 2026-10-13 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2b8d6c4a913'
down_revision: Union[str, Sequence[str], None] = 'e1f4a7c20b58'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'bank_bullet_variants',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('bullet_id', sa.Uuid(), nullable=False),
        sa.Column('text', sa.String(), nullable=False),
        sa.Column('job_posting_id', sa.Uuid(), nullable=True),
        sa.Column('built_resume_id', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint(
            'job_posting_id IS NULL OR built_resume_id IS NULL', name='bank_bullet_variants_one_owner_check'),
        sa.ForeignKeyConstraint(['bullet_id'], ['bank_bullets.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['job_posting_id'], ['job_postings.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['built_resume_id'], ['built_resumes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_bank_bullet_variants_bullet_id', 'bank_bullet_variants', ['bullet_id'])
    op.create_index(
        'bank_bullet_variants_local_key', 'bank_bullet_variants', ['built_resume_id', 'bullet_id'],
        unique=True, postgresql_where=sa.text('built_resume_id IS NOT NULL'),
    )
    # By hand: autogenerate never emits RLS (alembic/CLAUDE.md). ENABLE, never FORCE.
    op.execute('ALTER TABLE public.bank_bullet_variants ENABLE ROW LEVEL SECURITY')

    op.add_column('built_resume_bullets', sa.Column('variant_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        'built_resume_bullets_variant_id_fkey', 'built_resume_bullets', 'bank_bullet_variants',
        ['variant_id'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('built_resume_bullets_variant_id_fkey', 'built_resume_bullets', type_='foreignkey')
    op.drop_column('built_resume_bullets', 'variant_id')
    op.drop_table('bank_bullet_variants')
