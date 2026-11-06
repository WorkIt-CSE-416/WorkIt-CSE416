"""job_sources: per-board source tracking for two-read closure detection
(KAN-619).

One row per (board, apply_url) records when each board last listed each job.
The worker uses this to close jobs missing from two complete reads of every
board that ever listed them, without affecting jobs still listed elsewhere.

Apply before the code that maps this table deploys: the model names every
column, so every INSERT fails on a database without them. It only adds a
table, so the running code never meets it and applying early is safe.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-11-05 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: str | Sequence[str] | None = "b6d2e8f4a1c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "job_sources",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("schedule_id", sa.Uuid(), nullable=False),
        sa.Column("apply_url", sa.Text(), nullable=False),
        sa.Column(
            "first_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("schedule_id", "apply_url"),
        sa.ForeignKeyConstraint(
            ["schedule_id"], ["scraper_schedules.id"], ondelete="CASCADE"
        ),
    )
    op.create_index("ix_job_sources_apply_url", "job_sources", ["apply_url"])

    op.execute("ALTER TABLE public.job_sources ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("job_sources")
