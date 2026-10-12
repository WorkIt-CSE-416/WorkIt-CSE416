"""latex resumes: an applicant's own LaTeX source, kept on its resume row

Revision ID: c23812df9bf8
Revises: 81fe134e8719
Create Date: 2026-10-12 18:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c23812df9bf8'
down_revision: Union[str, Sequence[str], None] = '81fe134e8719'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # KAN-176. A pasted LaTeX resume is an ordinary resumes row
    # (template_key 'latex') whose PDF is this source, compiled on request.
    # Nullable: every other resume has none. No new table, so no RLS step.
    op.add_column('resumes', sa.Column('latex_source', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('resumes', 'latex_source')
