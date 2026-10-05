"""remove non us countries

Revision ID: 4623ff1e8bb1
Revises: e6230622efb3
Create Date: 2026-10-05 18:33:17.190118

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4623ff1e8bb1'
down_revision: Union[str, Sequence[str], None] = 'e6230622efb3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Every country cca905583de8 seeded except US, copied from it so downgrade()
# puts back the same rows. ZZ ("Other", 4b3c00b5167d) stays: it is the
# catch-all for everywhere else, not a country.
REMOVED = [
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
]
CODES = [code for code, _ in REMOVED]

countries = sa.table(
    "countries",
    sa.column("code", sa.CHAR(2)),
    sa.column("name", sa.Text),
)

job_postings = sa.table(
    "job_postings",
    sa.column("location_country", sa.String),
)


def upgrade() -> None:
    """Upgrade schema."""
    # A posting in one of these countries would block the delete on its
    # foreign key. Move it to ZZ, which means a place the seed doesn't cover —
    # exactly what these become. Their state is already NULL: only US and ZZ
    # have states.
    op.execute(
        job_postings.update()
        .where(job_postings.c.location_country.in_(CODES))
        .values(location_country="ZZ")
    )
    op.execute(countries.delete().where(countries.c.code.in_(CODES)))


def downgrade() -> None:
    """Downgrade schema."""
    # The countries come back; which postings were in them does not. Those
    # stay on ZZ.
    op.bulk_insert(countries, [{"code": c, "name": n} for c, n in REMOVED])
