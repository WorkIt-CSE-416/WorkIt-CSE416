"""merge page settings and fill events

Joins two heads that branched off d9b579e66623 on their own: KAN-435's
a3c6e9f1b274 (built_resumes.page_settings) and KAN-452's d6f8b0c2e135 (the
end of its chain: disabled_job_systems, uninstall_answers, fill-report caps,
fill_events, email sends). It changes no schema.

With both heads on main, `alembic upgrade head` stops with "Multiple head
revisions are present", so the shared database could not be upgraded past
either one with the usual command.

Revision ID: e1a7c3d5b9f2
Revises: a3c6e9f1b274, d6f8b0c2e135
Create Date: 2026-11-01 21:00:00.000000

"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = 'e1a7c3d5b9f2'
down_revision: Union[str, Sequence[str], None] = ('a3c6e9f1b274', 'd6f8b0c2e135')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
