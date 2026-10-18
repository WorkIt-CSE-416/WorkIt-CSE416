"""drop resumes.parsed_json

KAN-240 (ADR 0003): an upload writes its reading into the experience bank,
so the parser's copy on the resume row is gone. Apply it AFTER the deploy
that stops mapping the column, never before: the code live until then names
`parsed_json` in every upload's INSERT, so dropping it first makes every
resume upload answer 500.

The downgrade puts the column back empty; nothing refills it.

Revision ID: 3f7a2c9d1e84
Revises: 188c8c2d7c14
Create Date: 2026-10-18 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '3f7a2c9d1e84'
down_revision: Union[str, Sequence[str], None] = '188c8c2d7c14'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('resumes', 'parsed_json')


def downgrade() -> None:
    op.add_column('resumes', sa.Column('parsed_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
