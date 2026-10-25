"""applicant profiles: the Fill engine's profile, policies and answers

Revision ID: 7f07adcaef4e
Revises: e5b7d9f1a334
Create Date: 2026-10-25 16:00:00.000000

Three columns with defaults on a table that already has RLS on, so it is
safe to apply before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '7f07adcaef4e'
down_revision: Union[str, Sequence[str], None] = 'e5b7d9f1a334'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = ('fill_profile', 'fill_policies', 'fill_answers')


def upgrade() -> None:
    """Upgrade schema."""
    for column in COLUMNS:
        op.add_column('applicant_profiles', sa.Column(
            column, postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False,
        ))
        # A reader looks keys up: an array or a string would answer nothing.
        op.create_check_constraint(
            f'applicant_profiles_{column}_object', 'applicant_profiles', f"jsonb_typeof({column}) = 'object'",
        )


def downgrade() -> None:
    """Downgrade schema."""
    for column in reversed(COLUMNS):
        op.drop_constraint(f'applicant_profiles_{column}_object', 'applicant_profiles', type_='check')
        op.drop_column('applicant_profiles', column)
