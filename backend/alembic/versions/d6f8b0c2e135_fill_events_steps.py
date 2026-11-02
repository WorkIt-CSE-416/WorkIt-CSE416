"""fill_events: a Workday step's number and last-step mark, and the fields skipped by choice (KAN-476)

Revision ID: d6f8b0c2e135
Revises: b3d9e2f7a581
Create Date: 2026-10-31 22:00:00.000000

Three columns (app/models/fill_events.py): `step` and `final_step`, which
Workday's one event per step carries so fill-health counts its walk once,
null on every other job system's single page; and `skipped_by_choice`, the
fields left blank because the student switched their category off, which
the needs-you rate leaves out (0 on the rows already stored). Old code
names none of them, so it is safe before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd6f8b0c2e135'
down_revision: Union[str, Sequence[str], None] = 'b3d9e2f7a581'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('fill_events', sa.Column('step', sa.Integer(), nullable=True))
    op.add_column('fill_events', sa.Column('final_step', sa.Boolean(), nullable=True))
    op.add_column('fill_events', sa.Column('skipped_by_choice', sa.Integer(), server_default='0', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('fill_events', 'skipped_by_choice')
    op.drop_column('fill_events', 'final_step')
    op.drop_column('fill_events', 'step')
