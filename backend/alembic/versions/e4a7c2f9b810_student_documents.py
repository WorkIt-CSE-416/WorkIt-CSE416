"""student documents: a student's unofficial transcript, as forms ask for it (KAN-369)

Revision ID: e4a7c2f9b810
Revises: c3e9a1d7f520
Create Date: 2026-10-25 23:00:00.000000

A new table, one row per student and kind ('transcript' only), naming the
file in the Resume bucket (or a local file in development). Nothing reads
it before this deploy, so it is safe to apply before or after.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e4a7c2f9b810'
down_revision: Union[str, Sequence[str], None] = 'c3e9a1d7f520'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'student_documents',
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('kind', sa.Text(), nullable=False),
        sa.Column('original_filename', sa.String(), nullable=False),
        sa.Column('storage_path', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("kind IN ('transcript')", name='student_documents_kind_check'),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('applicant_id', 'kind'),
    )
    op.execute('ALTER TABLE public.student_documents ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('student_documents')
