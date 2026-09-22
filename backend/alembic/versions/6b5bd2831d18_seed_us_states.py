"""seed US states

Revision ID: 6b5bd2831d18
Revises: cca905583de8
Create Date: 2026-09-22 12:56:42.435805

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6b5bd2831d18'
down_revision: Union[str, Sequence[str], None] = 'cca905583de8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Frozen copy of the ISO 3166-2:US subdivisions, generated from pycountry
# 26.2.16: 50 states, DC, and 6 outlying areas. The outlying areas
# (PR, GU, ...) are also ISO countries in their own right, though not seeded as
# countries; they are listed here because ISO lists them under US, and a posting
# may say "San Juan, PR".
# Other countries' subdivisions get their own migrations.
US_STATES = [
    ('US-AK', 'Alaska'),
    ('US-AL', 'Alabama'),
    ('US-AR', 'Arkansas'),
    ('US-AS', 'American Samoa'),
    ('US-AZ', 'Arizona'),
    ('US-CA', 'California'),
    ('US-CO', 'Colorado'),
    ('US-CT', 'Connecticut'),
    ('US-DC', 'District of Columbia'),
    ('US-DE', 'Delaware'),
    ('US-FL', 'Florida'),
    ('US-GA', 'Georgia'),
    ('US-GU', 'Guam'),
    ('US-HI', 'Hawaii'),
    ('US-IA', 'Iowa'),
    ('US-ID', 'Idaho'),
    ('US-IL', 'Illinois'),
    ('US-IN', 'Indiana'),
    ('US-KS', 'Kansas'),
    ('US-KY', 'Kentucky'),
    ('US-LA', 'Louisiana'),
    ('US-MA', 'Massachusetts'),
    ('US-MD', 'Maryland'),
    ('US-ME', 'Maine'),
    ('US-MI', 'Michigan'),
    ('US-MN', 'Minnesota'),
    ('US-MO', 'Missouri'),
    ('US-MP', 'Northern Mariana Islands'),
    ('US-MS', 'Mississippi'),
    ('US-MT', 'Montana'),
    ('US-NC', 'North Carolina'),
    ('US-ND', 'North Dakota'),
    ('US-NE', 'Nebraska'),
    ('US-NH', 'New Hampshire'),
    ('US-NJ', 'New Jersey'),
    ('US-NM', 'New Mexico'),
    ('US-NV', 'Nevada'),
    ('US-NY', 'New York'),
    ('US-OH', 'Ohio'),
    ('US-OK', 'Oklahoma'),
    ('US-OR', 'Oregon'),
    ('US-PA', 'Pennsylvania'),
    ('US-PR', 'Puerto Rico'),
    ('US-RI', 'Rhode Island'),
    ('US-SC', 'South Carolina'),
    ('US-SD', 'South Dakota'),
    ('US-TN', 'Tennessee'),
    ('US-TX', 'Texas'),
    ('US-UM', 'United States Minor Outlying Islands'),
    ('US-UT', 'Utah'),
    ('US-VA', 'Virginia'),
    ('US-VI', 'U.S. Virgin Islands'),
    ('US-VT', 'Vermont'),
    ('US-WA', 'Washington'),
    ('US-WI', 'Wisconsin'),
    ('US-WV', 'West Virginia'),
    ('US-WY', 'Wyoming'),
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
        [{"code": c, "country_code": "US", "name": n} for c, n in US_STATES],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(states.delete().where(states.c.code.in_([c for c, _ in US_STATES])))
