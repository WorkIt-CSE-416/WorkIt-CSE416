"""built resumes, their choices, and a default that can be a base resume

Revision ID: 5753545063f3
Revises: d3a8f61c2b47
Create Date: 2026-10-13 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5753545063f3'
down_revision: Union[str, Sequence[str], None] = 'd3a8f61c2b47'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ('built_resumes', 'built_resume_entries', 'built_resume_bullets', 'built_resume_skills')


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    ]


def _choice(name: str, item: str, item_table: str, *extra: sa.Column) -> None:
    # One row per item on one built resume. No row: the item is not on the
    # resume (it waits in the editor's tray). Deleting either side deletes it.
    op.create_table(
        name,
        sa.Column('built_resume_id', sa.Uuid(), nullable=False),
        sa.Column(item, sa.Uuid(), nullable=False),
        sa.Column('shown', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        *extra,
        *_timestamps(),
        sa.ForeignKeyConstraint(['built_resume_id'], ['built_resumes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint([item], [f'{item_table}.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('built_resume_id', item),
    )
    # The primary key serves lookups by resume; this one serves the cascade
    # from the bank row.
    op.create_index(f'ix_{name}_{item}', name, [item])


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'built_resumes',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('template', sa.String(), nullable=False),
        sa.Column('job_posting_id', sa.Uuid(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['job_posting_id'], ['job_postings.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        # At most one tailored resume per applicant and posting. Base resumes
        # (no posting) are many: NULLs are distinct here, on purpose.
        sa.UniqueConstraint('applicant_id', 'job_posting_id', name='built_resumes_applicant_posting_key'),
    )
    op.create_index('ix_built_resumes_applicant_id', 'built_resumes', ['applicant_id'])

    _choice(
        'built_resume_entries', 'entry_id', 'bank_entries',
        sa.Column('show_gpa', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('show_coursework', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    )
    _choice('built_resume_bullets', 'bullet_id', 'bank_bullets')
    _choice('built_resume_skills', 'skill_id', 'bank_skills')

    # The default resume is an uploaded resume or a base resume: a second
    # pointer beside default_resume_id, and at most one of the two is set.
    # Written by hand, like default_resume_id's: built_resumes points back at
    # applicant_profiles, so this is a reference cycle (use_alter).
    op.add_column('applicant_profiles', sa.Column('default_built_resume_id', sa.Uuid(), nullable=True))
    op.create_index(
        'ix_applicant_profiles_default_built_resume_id', 'applicant_profiles', ['default_built_resume_id'],
    )
    op.create_foreign_key(
        'applicant_profiles_default_built_resume_id_fkey', 'applicant_profiles', 'built_resumes',
        ['default_built_resume_id'], ['id'], ondelete='SET NULL',
    )
    op.create_check_constraint(
        'applicant_profiles_one_default_resume', 'applicant_profiles',
        'num_nonnulls(default_resume_id, default_built_resume_id) <= 1',
    )

    # By hand: autogenerate never emits RLS (alembic/CLAUDE.md). Deny-all
    # backstop against the anon key; ENABLE, never FORCE.
    for table in TABLES:
        op.execute(f'ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    # The cycle's FK goes first, or dropping built_resumes fails.
    op.drop_constraint('applicant_profiles_one_default_resume', 'applicant_profiles', type_='check')
    op.drop_constraint('applicant_profiles_default_built_resume_id_fkey', 'applicant_profiles', type_='foreignkey')
    op.drop_index('ix_applicant_profiles_default_built_resume_id', table_name='applicant_profiles')
    op.drop_column('applicant_profiles', 'default_built_resume_id')
    for table in reversed(TABLES):
        op.drop_table(table)
