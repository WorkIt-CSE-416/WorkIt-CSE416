"""applicant contact email

Revision ID: 9d3f6b1e4a72
Revises: c785e96ac011
Create Date: 2026-10-20 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9d3f6b1e4a72'
down_revision: Union[str, Sequence[str], None] = 'c785e96ac011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# KAN-262. The email employers see, apart from the sign-in email that
# Supabase Auth owns. Nullable: NULL means "use the sign-in email", so every
# existing row keeps showing what it showed. Not unique, unlike `email`: it
# signs nobody in. applicant_profiles already has RLS (ce5b2e3f9b78).
#
# This merges and is applied before the model maps the column, so no deploy
# ever selects a column the database lacks.


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('applicant_profiles', sa.Column('contact_email', sa.String(length=100), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('applicant_profiles', 'contact_email')
