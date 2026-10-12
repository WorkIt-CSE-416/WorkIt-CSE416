"""experience bank: one row per entry an applicant has done, and resumes WorkIt builds

Revision ID: 81fe134e8719
Revises: 98ab19cfe840
Create Date: 2026-10-12 11:56:13.301437

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '81fe134e8719'
down_revision: Union[str, Sequence[str], None] = '98ab19cfe840'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # KAN-176. The bank is rows, one per entry, so an entry can be edited,
    # picked for a resume and (later) matched to jobs on its own. A resume
    # stays one frozen ParsedResume in resumes.parsed_json.
    op.create_table('experience_entries',
    sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('applicant_id', sa.Uuid(), nullable=False),
    sa.Column('section', sa.String(length=20), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('organization', sa.String(length=200), nullable=True),
    sa.Column('location', sa.String(length=100), nullable=True),
    sa.Column('start_date', sa.Date(), nullable=True),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('bullets', postgresql.ARRAY(sa.String()), server_default=sa.text("'{}'::varchar[]"), nullable=False),
    sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    # Text and a CHECK rather than an enum: a new section is a one-line
    # migration here, never a coordinated ALTER TYPE.
    sa.CheckConstraint("section IN ('education', 'experience', 'project', 'activity', 'award', 'certification')", name='experience_entries_section_known'),
    sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_experience_entries_applicant_id'), 'experience_entries', ['applicant_id'], unique=False)
    op.execute('ALTER TABLE public.experience_entries ENABLE ROW LEVEL SECURITY')

    op.create_table('applicant_skills',
    sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('applicant_id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('category', sa.String(length=100), nullable=True),
    sa.Column('sort_order', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    # One skill per name, whatever its case; it also serves the per-applicant
    # lookup, so applicant_id gets no index of its own.
    op.create_index('applicant_skills_name_unique', 'applicant_skills', ['applicant_id', sa.literal_column('lower(name)')], unique=True)
    op.execute('ALTER TABLE public.applicant_skills ENABLE ROW LEVEL SECURITY')

    # Nullable, so every resume already stored is an upload, as it is.
    op.add_column('resumes', sa.Column('template_key', sa.String(length=40), nullable=True))
    op.add_column('resumes', sa.Column('target_job_id', sa.Uuid(), nullable=True))
    op.create_foreign_key('resumes_target_job_id_fkey', 'resumes', 'job_postings', ['target_job_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('resumes_target_job_id_fkey', 'resumes', type_='foreignkey')
    op.drop_column('resumes', 'target_job_id')
    op.drop_column('resumes', 'template_key')
    op.drop_index('applicant_skills_name_unique', table_name='applicant_skills')
    op.drop_table('applicant_skills')
    op.drop_index(op.f('ix_experience_entries_applicant_id'), table_name='experience_entries')
    op.drop_table('experience_entries')
