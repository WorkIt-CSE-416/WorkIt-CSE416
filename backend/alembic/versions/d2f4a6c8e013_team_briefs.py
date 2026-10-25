"""team briefs: a brief per team a posting names, and each posting's team (KAN-369)

Revision ID: d2f4a6c8e013
Revises: d1f3b5a7c962
Create Date: 2026-10-25 21:00:00.000000

company_briefs gains `team` (the team's folded name, '' for the company's
own brief) in its primary key, so a team's brief is shared by every student
whose posting names that team. posting_teams holds the team each posting
names, once named, for every student applying to it. Existing rows become
company briefs (team ''), so it is safe to apply before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2f4a6c8e013'
down_revision: Union[str, Sequence[str], None] = 'd1f3b5a7c962'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('company_briefs', sa.Column('team', sa.Text(), server_default=sa.text("''"), nullable=False))
    op.drop_constraint('company_briefs_pkey', 'company_briefs', type_='primary')
    op.create_primary_key('company_briefs_pkey', 'company_briefs', ['company_key', 'team'])
    op.create_table(
        'posting_teams',
        sa.Column('job_id', sa.Uuid(), nullable=False),
        sa.Column('team', sa.Text(), nullable=False),
        sa.Column('named_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['job_id'], ['job_postings.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('job_id'),
    )
    op.execute('ALTER TABLE public.posting_teams ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('posting_teams')
    op.execute("DELETE FROM company_briefs WHERE team <> ''")
    op.drop_constraint('company_briefs_pkey', 'company_briefs', type_='primary')
    op.create_primary_key('company_briefs_pkey', 'company_briefs', ['company_key'])
    op.drop_column('company_briefs', 'team')
