"""rename avatar_url to avatar_path

Revision ID: 4f1a9c2e7b30
Revises: ce5b2e3f9b78
Create Date: 2026-09-28 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '4f1a9c2e7b30'
down_revision: Union[str, Sequence[str], None] = 'ce5b2e3f9b78'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Hand-written. Autogenerate sees a rename as one column dropped and another
# added, which would discard whatever the column holds. It holds nothing yet,
# but the rename is the honest DDL. Both tables get the column from the
# shared Profile mixin in app/models/profiles.py, so both change together.
#
# The column stores a path in the private Avatar Storage bucket, not a URL —
# see backend/db/avatar.md.
TABLES = ('applicant_profiles', 'company_memberships')


def upgrade() -> None:
    """Upgrade schema."""
    for table in TABLES:
        op.alter_column(table, 'avatar_url', new_column_name='avatar_path')


def downgrade() -> None:
    """Downgrade schema."""
    for table in TABLES:
        op.alter_column(table, 'avatar_path', new_column_name='avatar_url')
