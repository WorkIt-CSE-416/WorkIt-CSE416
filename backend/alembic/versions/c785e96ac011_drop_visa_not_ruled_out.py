"""drop the not_ruled_out visa preference

KAN-275: the Jobs page's visa filter keeps one option, Sponsors Visas. "Hide
Jobs That Rule Me Out" (not_ruled_out) is gone from GET /jobs and from saved
preferences, so a saved one is cleared, leaving that seeker no visa filter,
and the CHECK stops accepting it.

Apply it just before the deploy that drops the option. Until that deploy, the
old onboarding can still send not_ruled_out, and that save fails on the
CHECK. The other order is worse: the new API refuses to read a saved
not_ruled_out, so every such seeker's Jobs page would fail until this ran.

Revision ID: c785e96ac011
Revises: 17ea74fa4573
Create Date: 2026-10-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c785e96ac011'
down_revision: Union[str, Sequence[str], None] = '17ea74fa4573'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("UPDATE applicant_preferences SET visa = NULL WHERE visa = 'not_ruled_out'")
    op.drop_constraint('applicant_preferences_visa', 'applicant_preferences', type_='check')
    op.create_check_constraint(
        'applicant_preferences_visa', 'applicant_preferences', "visa IS NULL OR visa = 'sponsors'"
    )


def downgrade() -> None:
    """Downgrade schema.

    The CHECK accepts not_ruled_out again; the preferences cleared on upgrade
    stay cleared.
    """
    op.drop_constraint('applicant_preferences_visa', 'applicant_preferences', type_='check')
    op.create_check_constraint(
        'applicant_preferences_visa',
        'applicant_preferences',
        "visa IS NULL OR visa IN ('sponsors','not_ruled_out')",
    )
