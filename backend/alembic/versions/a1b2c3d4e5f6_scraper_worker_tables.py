"""scraper_schedules and scraper_tasks for the backend-owned scraper worker
(KAN-605).

Two tables for Postgres-backed board schedules and task leasing. The worker
checkpoints per board and recovers from interruption.

Apply before the code that maps these tables deploys: the models name every
column, so every INSERT fails on a database without them. They only add tables,
so the running code never meets them and applying early is safe.

Revision ID: a1b2c3d4e5f6
Revises: f7b2d4a6c815
Create Date: 2026-11-04 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "f7b2d4a6c815"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # -- scraper_schedules: board catalog + read history + health --
    op.create_table(
        "scraper_schedules",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("ats", sa.Text(), nullable=False),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("company", sa.Text(), nullable=False),
        sa.Column(
            "enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column("last_read_at", sa.DateTime(timezone=True)),
        sa.Column("prior_read_at", sa.DateTime(timezone=True)),
        sa.Column("missing_at", sa.DateTime(timezone=True)),
        sa.Column(
            "consecutive_failures",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("rest_until", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ats", "token"),
    )

    # -- scraper_tasks: per-board work items with leases --
    op.create_table(
        "scraper_tasks",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("schedule_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status", sa.Text(), server_default=sa.text("'pending'"), nullable=False
        ),
        sa.Column("claimed_by", sa.Text()),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True)),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("boards_s", sa.Float()),
        sa.Column("pages_s", sa.Float()),
        sa.Column("error", sa.Text()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["schedule_id"], ["scraper_schedules.id"], ondelete="CASCADE"
        ),
    )
    op.create_index("ix_scraper_tasks_schedule_id", "scraper_tasks", ["schedule_id"])

    # -- RLS: deny-all backstop on every new table --
    op.execute("ALTER TABLE public.scraper_schedules ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.scraper_tasks ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("scraper_tasks")
    op.drop_table("scraper_schedules")
