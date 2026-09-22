"""seed countries

Revision ID: cca905583de8
Revises: dee263a84adb
Create Date: 2026-09-22 12:56:22.879856

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cca905583de8'
down_revision: Union[str, Sequence[str], None] = 'dee263a84adb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Frozen copy of ISO 3166-1 alpha-2, generated from pycountry 26.2.16.
# Inlined rather than read from pycountry at upgrade time so this migration
# inserts the same rows on every machine regardless of installed version.
# common_name is used where ISO's formal name reads badly ("Korea, Republic
# of"), plus a few hand overrides for names that still contained commas.
#
# Deliberately incomplete: 15 of ISO's 249 codes, the countries this job board
# expects most postings from. Everything else was cut; see app/models/CLAUDE.md
# before adding any back.
COUNTRIES = [
    ('AU', 'Australia'),
    ('CA', 'Canada'),
    ('CN', 'China'),
    ('DE', 'Germany'),
    ('DK', 'Denmark'),
    ('ES', 'Spain'),
    ('FR', 'France'),
    ('GB', 'United Kingdom'),
    ('HK', 'Hong Kong'),
    ('IT', 'Italy'),
    ('JP', 'Japan'),
    ('NZ', 'New Zealand'),
    ('SG', 'Singapore'),
    ('TW', 'Taiwan'),
    ('US', 'United States'),
]

countries = sa.table(
    "countries",
    sa.column("code", sa.CHAR(2)),
    sa.column("name", sa.Text),
)


def upgrade() -> None:
    """Upgrade schema."""
    op.bulk_insert(countries, [{"code": c, "name": n} for c, n in COUNTRIES])


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(countries.delete().where(countries.c.code.in_([c for c, _ in COUNTRIES])))
