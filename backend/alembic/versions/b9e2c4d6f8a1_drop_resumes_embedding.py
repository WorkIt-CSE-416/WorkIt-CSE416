"""drop resumes.embedding: the contract half of KAN-212's move to the bank

Revision ID: b9e2c4d6f8a1
Revises: a3d7f1c9e2b4
Create Date: 2026-10-25 18:00:00.000000

KAN-212 moved the applicant's embedding to `experience_banks` and stopped
mapping `resumes.embedding` (`d89a4ef`, on main and deployed). Nothing reads
or writes the column, so it goes. Apply it AFTER that deploy, never before:
code that still maps the column names it in every upload's INSERT. Its
vectors are not kept; the recommender reads the bank's.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b9e2c4d6f8a1'
down_revision: Union[str, Sequence[str], None] = 'a3d7f1c9e2b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column('resumes', 'embedding')


def downgrade() -> None:
    """Downgrade schema. The column comes back empty, as `4485d7a7a712`
    made it (qualified: only Supabase puts `extensions` on the search path)."""
    op.execute('ALTER TABLE resumes ADD COLUMN embedding extensions.vector(768)')
