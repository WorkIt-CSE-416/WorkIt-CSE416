"""desktop submitting stage

KAN-323 (auto-apply/desktop.md): a Desktop takes an approved application to
submit with one atomic claim, approved → submitting, leased like a fill's
claim. A submitting application is never submitted again: one its Desktop
no longer holds goes to needs_you, not back to approved, so a crash after
Submit can't send a form twice. `application_stage` gains `submitting`,
placed after `approved`.

Only adds: apply it before the deploy that writes the value.

Revision ID: c3d5f7a9b1e2
Revises: b7c1e9d4a2f0
Create Date: 2026-10-22 05:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c3d5f7a9b1e2'
down_revision: Union[str, Sequence[str], None] = 'b7c1e9d4a2f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Autogenerate never emits enum values (alembic/CLAUDE.md). ADD VALUE runs
    # outside the migration's transaction, as 40329c7aef62's does.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE application_stage ADD VALUE IF NOT EXISTS 'submitting' AFTER 'approved'")


def downgrade() -> None:
    """Downgrade schema.

    Postgres can't drop an enum value, so the type is rebuilt without it, as
    40329c7aef62's downgrade does. A submitting application may have been
    sent, so it goes to needs_you, never back to approved.
    """
    op.execute("UPDATE job_applications SET stage = 'needs_you' WHERE stage = 'submitting'")
    op.drop_constraint('job_applications_applied_dated', 'job_applications', type_='check')
    op.execute("ALTER TABLE job_applications ALTER COLUMN stage DROP DEFAULT")
    op.execute("ALTER TYPE application_stage RENAME TO application_stage_old")
    op.execute(
        "CREATE TYPE application_stage AS ENUM"
        " ('saved', 'queued', 'filling', 'review', 'approved', 'needs_you', 'skipped', 'applied')"
    )
    op.execute(
        "ALTER TABLE job_applications ALTER COLUMN stage TYPE application_stage "
        "USING stage::text::application_stage"
    )
    op.execute("DROP TYPE application_stage_old")
    op.execute("ALTER TABLE job_applications ALTER COLUMN stage SET DEFAULT 'applied'")
    op.create_check_constraint(
        'job_applications_applied_dated', 'job_applications',
        "stage <> 'applied' OR applied_at IS NOT NULL",
    )
