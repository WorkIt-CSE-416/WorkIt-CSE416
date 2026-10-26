"""written answers: description, the help text the form shows under a question (KAN-369)

Revision ID: f4a8c1d6e273
Revises: b7d41c09e2a6
Create Date: 2026-10-26 12:00:00.000000

What the form says under a question's label ("3-4 sentences", "250 words
max"), as the Fill engine read it, so the student's Claude writes to the
form's own length. NULL for every row there now and for a question with
none. Old code ignores the column, so it is safe to apply before or after
the deploy; the new code writes it, so apply it before.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4a8c1d6e273'
down_revision: Union[str, Sequence[str], None] = 'b7d41c09e2a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('written_answers', sa.Column('description', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('written_answers', 'description')
