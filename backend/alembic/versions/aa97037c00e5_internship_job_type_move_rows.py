"""internship job type: move the old rows

KAN-233, contract step 1 of 2. Apply it BEFORE the deploy that drops
queries/jobs/legacy_levels.py: that code can't read an old value, and one
published company job still held one when this was written.

Moves the rows an older import or the company form wrote with the old values:
- an internship level becomes the internship job type for a student (its
  stated hours, which the cards never showed, go);
- `other` becomes `experienced`.

It leaves `experience_level`'s type alone. The code live before that deploy
still names `internship` and `other` in its queries (`experience_level IN
('student', 'internship')`), and Postgres refuses a query that names a value
its enum lacks, so the type keeps them until 188c8c2d7c14, after the deploy.

Revision ID: aa97037c00e5
Revises: 4c59715d02db
Create Date: 2026-10-16 17:05:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'aa97037c00e5'
down_revision: Union[str, Sequence[str], None] = '4c59715d02db'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        "UPDATE job_postings SET job_type = 'internship', experience_level = 'student' "
        "WHERE experience_level = 'internship'"
    )
    op.execute(
        "UPDATE job_postings SET experience_level = 'experienced' "
        "WHERE experience_level = 'other'"
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Nothing to undo: the rows keep the new values, which the code before
    # this revision reads too, and an internship's stated hours are gone.
