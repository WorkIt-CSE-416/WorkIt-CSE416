"""experience bank: bank row, entries, bullets and skills

Revision ID: b7e2a4c91d06
Revises: 824f0b2e3d84
Create Date: 2026-10-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b7e2a4c91d06'
down_revision: Union[str, Sequence[str], None] = '824f0b2e3d84'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ('experience_banks', 'bank_entries', 'bank_bullets', 'bank_skills')


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    ]


def upgrade() -> None:
    """Upgrade schema."""
    section = postgresql.ENUM(
        'education', 'experience', 'projects', 'leadership', 'awards', 'certifications',
        name='bank_section',
    )
    end_kind = postgresql.ENUM('month', 'present', 'expected', name='entry_end_kind')

    op.create_table(
        'experience_banks',
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('embedded_at', sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('applicant_id'),
    )
    # By hand: the vector type is qualified, as in 4485d7a7a712, because only
    # Supabase puts `extensions` on the search path. 768 is
    # dto.EMBEDDING_DIMENSIONS.
    op.execute('ALTER TABLE experience_banks ADD COLUMN embedding extensions.vector(768)')

    op.create_table(
        'bank_entries',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('section', section, nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('organization', sa.String(), nullable=True),
        sa.Column('location', sa.String(), nullable=True),
        sa.Column('start_month', sa.Date(), nullable=True),
        sa.Column('end_month', sa.Date(), nullable=True),
        sa.Column('end_kind', end_kind, nullable=True),
        sa.Column('degree', sa.String(), nullable=True),
        sa.Column('field_of_study', sa.String(), nullable=True),
        sa.Column('gpa', sa.Numeric(5, 2), nullable=True),
        sa.Column('gpa_scale', sa.Numeric(5, 2), nullable=True),
        sa.Column('coursework', postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'"), nullable=False),
        sa.Column('honors', sa.String(), nullable=True),
        sa.Column('link', sa.String(), nullable=True),
        sa.Column('issuer', sa.String(), nullable=True),
        sa.Column('award_date', sa.Date(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        # Present has no end month; a month or an expected end has one. The
        # API checks this too; this keeps a hand-written row honest.
        sa.CheckConstraint(
            "(end_kind IS NULL AND end_month IS NULL)"
            " OR (end_kind = 'present' AND end_month IS NULL)"
            " OR (end_kind IN ('month', 'expected') AND end_month IS NOT NULL)",
            name='bank_entries_end_check',
        ),
    )
    op.create_index('ix_bank_entries_applicant_id', 'bank_entries', ['applicant_id'])

    op.create_table(
        'bank_bullets',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('entry_id', sa.Uuid(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('text', sa.String(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(['entry_id'], ['bank_entries.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_bank_bullets_entry_id', 'bank_bullets', ['entry_id'])

    op.create_table(
        'bank_skills',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('group', sa.String(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    # Also serves lookups by applicant_id, so that column has no index of its own.
    op.create_index(
        'bank_skills_applicant_name_key', 'bank_skills',
        ['applicant_id', sa.text('lower(name)')], unique=True,
    )

    # By hand: autogenerate never emits RLS (alembic/CLAUDE.md). Deny-all
    # backstop against the anon key; ENABLE, never FORCE.
    for table in TABLES:
        op.execute(f'ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    for table in reversed(TABLES):
        op.drop_table(table)
    op.execute('DROP TYPE entry_end_kind')
    op.execute('DROP TYPE bank_section')
