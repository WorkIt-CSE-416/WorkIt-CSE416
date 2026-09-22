"""nullable job location state, country FK, location index

Revision ID: 2d9b0e7c41c2
Revises: 6b5bd2831d18
Create Date: 2026-09-22 12:56:46.958954

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2d9b0e7c41c2'
down_revision: Union[str, Sequence[str], None] = '6b5bd2831d18'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Named explicitly, matching what Postgres would generate for the model's
# unnamed ForeignKey, so downgrade() has a name to drop.
COUNTRY_FK = "job_postings_location_country_fkey"


def upgrade() -> None:
    """Upgrade schema."""
    # Only the state loosens: every posting has a country, but "United States"
    # or a country with no ISO subdivisions has no state.
    op.alter_column("job_postings", "location_state", existing_type=sa.String(), nullable=True)
    op.create_foreign_key(COUNTRY_FK, "job_postings", "countries", ["location_country"], ["code"])
    op.create_index("job_postings_loc_idx", "job_postings", ["location_country", "location_state"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("job_postings_loc_idx", table_name="job_postings")
    op.drop_constraint(COUNTRY_FK, "job_postings", type_="foreignkey")
    # Fails if any posting has a NULL state by then; backfill or delete those
    # rows first rather than inventing a state for them.
    op.alter_column("job_postings", "location_state", existing_type=sa.String(), nullable=False)
