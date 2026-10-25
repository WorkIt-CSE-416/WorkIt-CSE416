"""job applications: answer_review, the pre-submit review's verdict (KAN-369)

Revision ID: c3e9a1d7f520
Revises: d1f3b5a7c962
Create Date: 2026-10-25 21:00:00.000000

One nullable column, so it is safe to apply before or after the deploy:
NULL is an application no review has been saved for, as every row before.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c3e9a1d7f520'
down_revision: Union[str, Sequence[str], None] = 'd1f3b5a7c962'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('job_applications', sa.Column('answer_review', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('job_applications', 'answer_review')
