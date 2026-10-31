"""written answers: an application's questions that need writing, and the answers the student's Claude saves (KAN-377)

Revision ID: a3c5e7f9b112
Revises: d1a7c3e5f902
Create Date: 2026-10-25 12:00:00.000000

A new table, so it is safe to apply before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3c5e7f9b112'
down_revision: Union[str, Sequence[str], None] = 'd1a7c3e5f902'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'written_answers',
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('job_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('label', sa.Text(), nullable=False),
        sa.Column('required', sa.Boolean(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('max_length', sa.Integer(), nullable=True),
        sa.Column('answer', sa.Text(), nullable=True),
        sa.Column('answered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(
            ['applicant_id', 'job_id'], ['job_applications.applicant_id', 'job_applications.job_id'],
            name='written_answers_application_fkey', ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('applicant_id', 'job_id', 'name'),
    )
    op.execute('ALTER TABLE public.written_answers ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('written_answers')
