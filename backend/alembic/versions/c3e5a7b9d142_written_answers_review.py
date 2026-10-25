"""written answers: review, the passes Claude ran on its answer (KAN-369)

Revision ID: c3e5a7b9d142
Revises: d1f3b5a7c962
Create Date: 2026-10-25 22:00:00.000000

One nullable column, so it is safe to apply before or after the deploy:
NULL is an answer with no review (a choice, a paste, the student's own
words), as every row before this one.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c3e5a7b9d142'
down_revision: Union[str, Sequence[str], None] = 'd1f3b5a7c962'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('written_answers', sa.Column('review', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_check_constraint(
        'written_answers_review_object', 'written_answers',
        "review IS NULL OR jsonb_typeof(review) = 'object'",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('written_answers_review_object', 'written_answers', type_='check')
    op.drop_column('written_answers', 'review')
