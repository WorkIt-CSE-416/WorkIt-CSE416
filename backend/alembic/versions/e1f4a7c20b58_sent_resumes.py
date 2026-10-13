"""sent resumes: the exact file a student downloaded or applied with

Revision ID: e1f4a7c20b58
Revises: e1c4a7b9d215
Create Date: 2026-10-13 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1f4a7c20b58'
down_revision: Union[str, Sequence[str], None] = 'e1c4a7b9d215'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'sent_resumes',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        # A file in the Resume bucket: the sent resume's own PDF, or an
        # uploaded resume's file, which then outlives that resume's row.
        sa.Column('storage_path', sa.String(), nullable=False),
        # The source's name at that moment: the source can be renamed or go.
        sa.Column('name', sa.String(), nullable=False),
        # The sources are a record, not an owner: deleting one keeps the
        # sent resume and nulls the link. At most one is set.
        sa.Column('built_resume_id', sa.Uuid(), nullable=True),
        sa.Column('uploaded_resume_id', sa.Uuid(), nullable=True),
        sa.Column('job_posting_id', sa.Uuid(), nullable=True),
        # sha256 of the view, template and header text before rendering; a
        # repeat for the same built resume returns the last sent resume.
        sa.Column('content_hash', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['built_resume_id'], ['built_resumes.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['uploaded_resume_id'], ['resumes.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['job_posting_id'], ['job_postings.id'], ondelete='SET NULL'),
        sa.CheckConstraint(
            'num_nonnulls(built_resume_id, uploaded_resume_id) <= 1', name='sent_resumes_one_source',
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_sent_resumes_applicant_id', 'sent_resumes', ['applicant_id'])
    # The repeat lookup, and the SET NULL from built_resumes
    op.create_index('ix_sent_resumes_built_resume_id', 'sent_resumes', ['built_resume_id', 'content_hash'])
    # The SET NULL from resumes and job_postings
    op.create_index('ix_sent_resumes_uploaded_resume_id', 'sent_resumes', ['uploaded_resume_id'])
    op.create_index('ix_sent_resumes_job_posting_id', 'sent_resumes', ['job_posting_id'])

    # By hand: autogenerate never emits RLS (alembic/CLAUDE.md). Deny-all
    # backstop against the anon key; ENABLE, never FORCE.
    op.execute('ALTER TABLE public.sent_resumes ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('sent_resumes')
