"""add password hash and onboarding tracking

Revision ID: b740d8d00619
Revises: 2d9b0e7c41c2
Create Date: 2026-09-22 18:15:51.439241

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b740d8d00619'
down_revision: Union[str, Sequence[str], None] = '2d9b0e7c41c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # password_hash is NOT NULL with no server_default — safe only because
    # applicant_profiles and company_memberships were both empty (0 rows)
    # when this migration was written. If either table has picked up real
    # rows by the time this actually runs, this ADD COLUMN will fail; add a
    # server_default (or a two-step backfill) before applying it then.
    op.add_column('applicant_profiles', sa.Column('password_hash', sa.String(length=255), nullable=False))
    op.add_column('applicant_profiles', sa.Column('onboarding_completed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('company_memberships', sa.Column('password_hash', sa.String(length=255), nullable=False))
    op.add_column('company_memberships', sa.Column('onboarding_completed_at', sa.DateTime(timezone=True), nullable=True))
    # Autogenerate also proposed changing job_postings.location_country from
    # VARCHAR to CHAR(2) — pre-existing drift between app/models/jobs.py and
    # what 2d9b0e7c41c2 actually applied, unrelated to auth. Deliberately
    # left out of this migration; whoever owns jobs.py should fix that in
    # its own migration, not have it ride in here.


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('company_memberships', 'onboarding_completed_at')
    op.drop_column('company_memberships', 'password_hash')
    op.drop_column('applicant_profiles', 'onboarding_completed_at')
    op.drop_column('applicant_profiles', 'password_hash')
