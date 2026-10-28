"""merge main's and batch apply's heads (KAN-369): no schema change

Revision ID: 222a18d55bc2
Revises: b9e2c4d6f8a1, d8a3f5c1e7b2
Create Date: 2026-10-27 13:15:59.064337

Main's chain (resume local skills, drop resumes.embedding) and batch apply's
(written answers, the connector, fill reports, job system requests and the
rest) touch different tables, so either order is safe; this only joins them.
"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = '222a18d55bc2'
down_revision: Union[str, Sequence[str], None] = ('b9e2c4d6f8a1', 'd8a3f5c1e7b2')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
