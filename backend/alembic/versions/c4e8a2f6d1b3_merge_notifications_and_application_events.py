"""merge notifications and application events

Joins two heads that branched off b9e2c4d6f8a1 on their own: KAN-298's
89d598a1667d (notifications, job_alerts_enabled) and KAN-413's
a7d3e5f1c2b4 (the stages after applied, application_events). It changes
no schema.

89d598a1667d reached the shared database from KAN-298's branch before its
file was on main, so on 2026-10-27 every `alembic upgrade` from main failed
with "Can't locate revision identified by '89d598a1667d'"
(alembic/CLAUDE.md, "Commit the migration in the same PR that applies
it"). Its file came to main unchanged, beside this merge, so the shared
database (at 89d598a1667d) upgrades through a7d3e5f1c2b4 to here, and a
fresh database runs both. Never re-parent 89d598a1667d onto a7d3e5f1c2b4
instead: it is applied, and Alembic would then take a7d3e5f1c2b4 as applied
too and never create application_events.

Revision ID: c4e8a2f6d1b3
Revises: a7d3e5f1c2b4, 89d598a1667d
Create Date: 2026-10-27 17:00:00.000000

"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = 'c4e8a2f6d1b3'
down_revision: Union[str, Sequence[str], None] = ('a7d3e5f1c2b4', '89d598a1667d')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
