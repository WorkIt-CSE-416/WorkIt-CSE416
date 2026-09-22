"""seed GB states

Revision ID: 60e294868d57
Revises: 2d9b0e7c41c2
Create Date: 2026-09-22 13:08:46.830375

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '60e294868d57'
down_revision: Union[str, Sequence[str], None] = '2d9b0e7c41c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Frozen top-level ISO 3166-2:GB subdivisions, generated from pycountry
# 26.2.16. Top level only: the four nations. Postings write "London, England,
# United Kingdom", naming the nation, and states is one level deep; the
# counties and boroughs below them are left out.
STATES = [
    ('GB-ENG', 'GB', 'England'),
    ('GB-NIR', 'GB', 'Northern Ireland'),
    ('GB-SCT', 'GB', 'Scotland'),
    ('GB-WLS', 'GB', 'Wales'),
]

states = sa.table(
    "states",
    sa.column("code", sa.String(6)),
    sa.column("country_code", sa.CHAR(2)),
    sa.column("name", sa.Text),
)


def upgrade() -> None:
    """Upgrade schema."""
    op.bulk_insert(
        states,
        [{"code": c, "country_code": cc, "name": n} for c, cc, n in STATES],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(states.delete().where(states.c.code.in_([c for c, _, _ in STATES])))
