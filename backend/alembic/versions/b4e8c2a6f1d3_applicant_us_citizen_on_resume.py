"""applicant us citizen on resume

Revision ID: b4e8c2a6f1d3
Revises: 3aa342c5a064
Create Date: 2026-10-21 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4e8c2a6f1d3'
down_revision: Union[str, Sequence[str], None] = '3aa342c5a064'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# My Profile's "Show U.S. Citizen on my resumes" check box: the resume
# header prints "U.S. Citizen" when it is set. NOT NULL with a server default
# of false, so every existing row keeps the header it printed and an insert
# from code that does not map the column still succeeds. applicant_profiles
# already has RLS (ce5b2e3f9b78).


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'applicant_profiles',
        sa.Column('us_citizen_on_resume', sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('applicant_profiles', 'us_citizen_on_resume')
