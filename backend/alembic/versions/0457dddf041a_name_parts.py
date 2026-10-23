"""name parts

KAN-326: first_name, middle_name and last_name on both account tables,
which signup and Settings' Personal Details ask for. full_name stays, as
the parts joined (app/services/names.py), so every reader that prints it
is unchanged. Existing rows are split here the way split_name splits: the
first word, the words between, the last word.

Apply it BEFORE the deploy that maps the columns: that code selects them
with every account row, so deployed first, every signed-in request fails
("column applicant_profiles.first_name does not exist"). Applying it early
is safe: the columns are nullable and the code before them never writes
them; a row that code writes in between has only full_name, and the API
splits it when read.

Revision ID: 0457dddf041a
Revises: 7c2e9a4b1f63
Create Date: 2026-10-23 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0457dddf041a'
down_revision: Union[str, Sequence[str], None] = '7c2e9a4b1f63'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ('applicant_profiles', 'company_memberships')

# The first word, the words between, the last word, as split_name does; a
# one-word name is a first name alone, and runs of spaces become one. A
# constant so
# tests/test_name_parts.py runs this exact statement on real names.
BACKFILL = r"""
    UPDATE {table} SET
        first_name = split_part(btrim(full_name), ' ', 1),
        middle_name = NULLIF(btrim(regexp_replace(regexp_replace(
            regexp_replace(btrim(full_name), '^\S+\s*', ''), '\s*\S+$', ''), '\s+', ' ', 'g')), ''),
        last_name = CASE WHEN btrim(full_name) ~ '\s'
            THEN regexp_replace(btrim(full_name), '^.*\s', '') END
"""


def upgrade() -> None:
    """Upgrade schema."""
    for table in TABLES:
        op.add_column(table, sa.Column('first_name', sa.String(length=50), nullable=True))
        op.add_column(table, sa.Column('middle_name', sa.String(length=50), nullable=True))
        op.add_column(table, sa.Column('last_name', sa.String(length=50), nullable=True))
        # By hand: autogenerate never writes data.
        op.execute(BACKFILL.format(table=table))


def downgrade() -> None:
    """Downgrade schema."""
    for table in TABLES:
        op.drop_column(table, 'last_name')
        op.drop_column(table, 'middle_name')
        op.drop_column(table, 'first_name')
