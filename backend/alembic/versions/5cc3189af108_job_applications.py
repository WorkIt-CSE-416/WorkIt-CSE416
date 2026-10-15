"""job applications

Revision ID: 5cc3189af108
Revises: 824f0b2e3d84
Create Date: 2026-10-15 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5cc3189af108'
down_revision: Union[str, Sequence[str], None] = '824f0b2e3d84'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'job_applications',
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('job_id', sa.Uuid(), nullable=False),
        sa.Column(
            'applied_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.PrimaryKeyConstraint('applicant_id', 'job_id'),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['job_id'], ['job_postings.id'], ondelete='CASCADE'),
    )
    op.create_index('job_applications_job_idx', 'job_applications', ['job_id', 'applicant_id'])
    # Autogenerate never emits this (alembic/CLAUDE.md).
    op.execute('ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('job_applications_job_idx', table_name='job_applications')
    op.drop_table('job_applications')
