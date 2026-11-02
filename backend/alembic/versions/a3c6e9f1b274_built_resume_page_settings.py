"""built_resumes.page_settings: how a built resume's page is set

KAN-435: a student can pick a built resume's font size, line spacing, margin
and alignment in the editor. The fields of resume_render's PageSettings, a
field left out at its default, so every resume already saved keeps Jake's own
page with the `{}` this adds.

Apply it as soon as it merges: nothing reads or writes the column yet, so
every deploy is safe with it. The code that reads it follows in its own PR,
and every built resume query fails on a database without it.

Revision ID: a3c6e9f1b274
Revises: d9b579e66623
Create Date: 2026-10-30 16:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a3c6e9f1b274'
down_revision: Union[str, Sequence[str], None] = 'd9b579e66623'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('built_resumes', sa.Column(
        'page_settings', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"),
        nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('built_resumes', 'page_settings')
