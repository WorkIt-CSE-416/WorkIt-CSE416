"""each student's own company and title for an unlisted posting

KAN-542 (ADR 0008): one unlisted posting per link, but the company and title
each student typed stay on that student's application, so a second student
on the same link never sees the first one's text.

Revision ID: d3f5a7c9e162
Revises: c2e4a6b8d051
Create Date: 2026-11-02 23:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd3f5a7c9e162'
down_revision: Union[str, Sequence[str], None] = 'c2e4a6b8d051'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('job_applications', sa.Column('company_name', sa.Text(), nullable=True))
    op.add_column('job_applications', sa.Column('title', sa.Text(), nullable=True))
    # The unlisted postings made before this: their one student typed the posting's text.
    op.execute(
        "UPDATE job_applications a SET company_name = p.company_name, title = p.title"
        " FROM job_postings p WHERE p.id = a.job_id AND p.status::text = 'unlisted'"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('job_applications', 'title')
    op.drop_column('job_applications', 'company_name')
