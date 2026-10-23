"""applicant location

Revision ID: 589ce7faebe4
Revises: 3aa342c5a064
Create Date: 2026-10-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '589ce7faebe4'
down_revision: Union[str, Sequence[str], None] = '3aa342c5a064'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# KAN-312. The applicant's own city ("Seattle, WA"), free text, never a job
# posting's location (job_locations/applicant_locations are search-preference
# data, not this). Nullable: every existing row has none yet. Before this,
# the autofiller had no real data source for an ATS's "Location (City)"
# field and stood in a hardcoded guess for one specific posting instead.
# applicant_profiles already has RLS (ce5b2e3f9b78).
#
# This merges and is applied before the model maps the column, so no deploy
# ever selects a column the database lacks (backend/app/models/CLAUDE.md,
# "A new column reaches the database before the model that maps it").


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('applicant_profiles', sa.Column('location', sa.String(length=100), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('applicant_profiles', 'location')
