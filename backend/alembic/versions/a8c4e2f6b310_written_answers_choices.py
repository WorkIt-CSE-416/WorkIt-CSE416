"""written answers: kind and options, a choice question's (KAN-369)

Revision ID: a8c4e2f6b310
Revises: 7f07adcaef4e
Create Date: 2026-10-25 18:00:00.000000

Two nullable columns, so it is safe to apply before or after the deploy:
NULL kind is a question written in words, as every row before this one.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a8c4e2f6b310'
down_revision: Union[str, Sequence[str], None] = '7f07adcaef4e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('written_answers', sa.Column('kind', sa.Text(), nullable=True))
    op.add_column('written_answers', sa.Column('options', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    # A choice always has its options, and a written question none.
    op.create_check_constraint(
        'written_answers_kind_options', 'written_answers',
        "(kind IS NULL AND options IS NULL) OR (kind IN ('choice', 'choices') AND jsonb_typeof(options) = 'array')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('written_answers_kind_options', 'written_answers', type_='check')
    op.drop_column('written_answers', 'options')
    op.drop_column('written_answers', 'kind')
