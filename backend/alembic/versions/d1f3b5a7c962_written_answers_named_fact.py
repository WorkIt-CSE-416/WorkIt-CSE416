"""written answers: named_fact, the company brief fact an answer uses (KAN-369)

Revision ID: d1f3b5a7c962
Revises: a8c4e2f6b310
Create Date: 2026-10-25 20:00:00.000000

One nullable column, so it is safe to apply before or after the deploy:
NULL is an answer that names no fact, as every row before this one.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd1f3b5a7c962'
down_revision: Union[str, Sequence[str], None] = 'a8c4e2f6b310'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('written_answers', sa.Column('named_fact', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    # The page reads its fact and url: an array or a string would show nothing.
    op.create_check_constraint(
        'written_answers_named_fact_object', 'written_answers',
        "named_fact IS NULL OR jsonb_typeof(named_fact) = 'object'",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('written_answers_named_fact_object', 'written_answers', type_='check')
    op.drop_column('written_answers', 'named_fact')
