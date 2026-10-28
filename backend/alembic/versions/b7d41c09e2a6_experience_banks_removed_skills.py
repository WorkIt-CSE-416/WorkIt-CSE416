"""experience banks: removed_skills, the skills a student removed (KAN-369)

Revision ID: b7d41c09e2a6
Revises: 3e24ae7b3905
Create Date: 2026-10-25 23:50:00.000000

The catalog keys (services/skill_catalog.py `key`) of the skills the student
deleted from their bank. A resume reading and Tailor's "Have you used X?"
never add one of them again; the student adding it by hand takes it off the
list. Empty for every row there now. Old code ignores the column, so it is
safe to apply before or after.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b7d41c09e2a6'
down_revision: Union[str, Sequence[str], None] = '3e24ae7b3905'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('experience_banks', sa.Column(
        'removed_skills', postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'"), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('experience_banks', 'removed_skills')
