"""fill_reports: an owner, a triage status and what a fix brief needs (KAN-369)

Revision ID: e5b8d2a7c914
Revises: 222a18d55bc2
Create Date: 2026-10-28 12:00:00.000000

A report now names the student who sent it (account_id, so they can list
their own; it goes with their account), carries what a coding agent needs to
fix the fill (context: versions, browser, the engine's recognition; timeline:
the fill's steps and errors; html: the form with every value taken out in the
student's browser; trigger: what opened the card), and the team's triage
(status new / triaged / fixed, admin_note, updated_at). Old rows keep a null
account and new columns. Additive only: old code ignores the new columns, so
it is safe to apply before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e5b8d2a7c914'
down_revision: Union[str, Sequence[str], None] = '222a18d55bc2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('fill_reports', sa.Column('account_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        'fill_reports_account_id_fkey', 'fill_reports', 'users', ['account_id'], ['id'],
        referent_schema='auth', ondelete='CASCADE',
    )
    op.add_column('fill_reports', sa.Column('status', sa.String(length=16), server_default='new', nullable=False))
    op.create_check_constraint('fill_reports_status_check', 'fill_reports', "status IN ('new', 'triaged', 'fixed')")
    op.add_column('fill_reports', sa.Column('admin_note', sa.Text(), nullable=True))
    op.add_column('fill_reports', sa.Column('trigger', sa.String(length=16), nullable=True))
    op.add_column('fill_reports', sa.Column('context', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('fill_reports', sa.Column('timeline', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('fill_reports', sa.Column('html', sa.Text(), nullable=True))
    op.add_column('fill_reports', sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_fill_reports_created_at', 'fill_reports', [sa.text('created_at DESC')])
    op.create_index('ix_fill_reports_account_id', 'fill_reports', ['account_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_fill_reports_account_id', table_name='fill_reports')
    op.drop_index('ix_fill_reports_created_at', table_name='fill_reports')
    for column in ('updated_at', 'html', 'timeline', 'context', 'trigger', 'admin_note'):
        op.drop_column('fill_reports', column)
    op.drop_constraint('fill_reports_status_check', 'fill_reports', type_='check')
    op.drop_column('fill_reports', 'status')
    op.drop_constraint('fill_reports_account_id_fkey', 'fill_reports', type_='foreignkey')
    op.drop_column('fill_reports', 'account_id')
