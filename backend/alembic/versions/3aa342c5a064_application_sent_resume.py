"""application sent resume

KAN-267 (docs/sent_resume.md, step 4): each application names the sent
resume it went out with, `job_applications.sent_resume_id`. One row per
(applicant, job) already; this adds what was sent.

The foreign key is composite, (sent_resume_id, applicant_id) to
sent_resumes (id, applicant_id), so the database refuses a link to another
applicant's sent resume; `sent_resumes_id_applicant_key` is what it points
at. Deleting the sent resume clears the link alone: SET NULL on that column
only (Postgres 15), since nulling applicant_id too would break the primary
key. Deleting the application leaves the sent resume.

Backfill: an applied application gets its job posting's last sent resume,
which the tracker showed until now, so no existing record loses its
resume. Queued, saved and skipped rows stay NULL.

Apply it before the deploy that writes it: the model maps the column, so
deployed first, every application insert answers 500. Applied early, the
running code never meets it (nullable, no default).

Revision ID: 3aa342c5a064
Revises: 5a6e419367b8
Create Date: 2026-10-21 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3aa342c5a064'
down_revision: Union[str, Sequence[str], None] = '5a6e419367b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_unique_constraint('sent_resumes_id_applicant_key', 'sent_resumes', ['id', 'applicant_id'])
    op.add_column('job_applications', sa.Column('sent_resume_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        'job_applications_sent_resume_fkey', 'job_applications', 'sent_resumes',
        ['sent_resume_id', 'applicant_id'], ['id', 'applicant_id'],
        ondelete='SET NULL (sent_resume_id)',
    )
    # The SET NULL looks rows up by it when a sent resume is deleted.
    op.create_index('ix_job_applications_sent_resume_id', 'job_applications', ['sent_resume_id'])
    op.execute("""
        UPDATE job_applications a
        SET sent_resume_id = (
            SELECT s.id FROM sent_resumes s
            WHERE s.applicant_id = a.applicant_id AND s.job_posting_id = a.job_id
            ORDER BY s.created_at DESC, s.id
            LIMIT 1
        )
        WHERE a.stage = 'applied'
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_job_applications_sent_resume_id', table_name='job_applications')
    op.drop_constraint('job_applications_sent_resume_fkey', 'job_applications', type_='foreignkey')
    op.drop_column('job_applications', 'sent_resume_id')
    op.drop_constraint('sent_resumes_id_applicant_key', 'sent_resumes', type_='unique')
