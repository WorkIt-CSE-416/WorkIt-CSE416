"""drop the scraper role columns

Revision ID: 824f0b2e3d84
Revises: a70c641b2f99
Create Date: 2026-10-11 14:02:20.683841

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '824f0b2e3d84'
down_revision: Union[str, Sequence[str], None] = 'a70c641b2f99'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The contract half of KAN-172's expand, then contract: role_category
# (aa41fdc1ba80) and roles (98ab19cfe840) were the scraper's role keys. Since
# KAN-155 nothing reads them: GET /jobs?role=, ?q= and the Role filter read
# job_role_tags (362182aaa4fd), and the import stopped writing both.
#
# APPLY THIS ONLY ONCE THE CODE THAT STOPPED READING THEM IS DEPLOYED. The API
# and the scheduled import deployed before it select and write both columns;
# dropping them under that code fails GET /jobs and every import. So it is
# applied in its own step, after the deploy, never with `upgrade head` beside
# the role tables (backend/CLAUDE.md, Commands).
role_category = postgresql.ENUM(
    'software', 'data_ai', 'product', 'quant', 'hardware', name='role_category'
)


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_index('job_postings_roles_idx', table_name='job_postings', postgresql_using='gin')
    op.drop_column('job_postings', 'roles')
    op.drop_column('job_postings', 'role_category')
    role_category.drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    """Downgrade schema."""
    # The schema back, empty: the old import refills both on its next run.
    role_category.create(op.get_bind(), checkfirst=True)
    op.add_column(
        'job_postings',
        sa.Column('role_category', postgresql.ENUM(name='role_category', create_type=False),
                  nullable=True),
    )
    op.add_column(
        'job_postings',
        sa.Column('roles', postgresql.ARRAY(sa.Text()), nullable=False,
                  server_default=sa.text("'{}'::text[]")),
    )
    op.create_index('job_postings_roles_idx', 'job_postings', ['roles'], unique=False,
                    postgresql_using='gin')
