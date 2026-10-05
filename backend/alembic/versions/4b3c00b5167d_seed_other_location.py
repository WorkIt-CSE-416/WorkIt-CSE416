"""seed other location

Revision ID: 4b3c00b5167d
Revises: 1ea834081a48
Create Date: 2026-10-05 18:22:06.906335

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4b3c00b5167d'
down_revision: Union[str, Sequence[str], None] = '1ea834081a48'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# "Other" catch-all for places the trimmed seed does not cover. ZZ is ISO
# 3166-1's user-assigned code for an unknown country, so ISO will never give
# it to a real one. The state is ZZ-ZZ rather than a bare ZZ because the API
# only accepts state codes shaped <country>-<sub> that start with their
# country (app/schemas/company_jobs.py).
OTHER_COUNTRY = {"code": "ZZ", "name": "Other"}
OTHER_STATE = {"code": "ZZ-ZZ", "country_code": "ZZ", "name": "Other"}

countries = sa.table(
    "countries",
    sa.column("code", sa.CHAR(2)),
    sa.column("name", sa.Text),
)

states = sa.table(
    "states",
    sa.column("code", sa.String(6)),
    sa.column("country_code", sa.CHAR(2)),
    sa.column("name", sa.Text),
)


def upgrade() -> None:
    """Upgrade schema."""
    # country first: states.country_code references it
    op.bulk_insert(countries, [OTHER_COUNTRY])
    op.bulk_insert(states, [OTHER_STATE])


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(states.delete().where(states.c.code == OTHER_STATE["code"]))
    op.execute(countries.delete().where(countries.c.code == OTHER_COUNTRY["code"]))
