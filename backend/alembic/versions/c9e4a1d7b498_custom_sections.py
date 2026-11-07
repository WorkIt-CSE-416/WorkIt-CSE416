"""custom sections in the experience bank (KAN-498)

A section the student names (Volunteering, Languages, a Summary):
`bank_section` gains `custom`, `bank_custom_sections` holds each section's
name, layout (`entries` or `lines`) and owner (an upload, as an entry's
`resume_id`, ADR 0005), and `bank_entries.custom_section_id` points a custom
entry at its section, set exactly when the section is `custom`.

It only adds: an enum value, a table and a nullable column every existing
row leaves empty (the CHECK holds for them), so the running code never meets
any of it and applying it early is safe. Apply it before the deploy that
maps them: the model names `custom_section_id` on every entry insert, so
deployed first, every upload, Import Again and Add entry answers 500.

ADD VALUE runs outside the migration's transaction, as 17ea74fa4573's does:
Postgres refuses a new enum value in the transaction that added it, and the
CHECK below names it.

Revision ID: c9e4a1d7b498
Revises: b6d2e8f4a1c7
Create Date: 2026-11-05 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9e4a1d7b498"
down_revision: str | Sequence[str] | None = "b6d2e8f4a1c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE bank_section ADD VALUE IF NOT EXISTS 'custom'")

    op.create_table(
        "bank_custom_sections",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("applicant_id", sa.Uuid(), nullable=False),
        sa.Column("resume_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("layout", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["applicant_id"], ["applicant_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["resume_id"], ["resumes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("layout IN ('entries', 'lines')", name="bank_custom_sections_layout_check"),
    )
    op.create_index(
        "ix_bank_custom_sections_applicant_id", "bank_custom_sections", ["applicant_id"], unique=False)
    # One name per owner, ignoring case; the student's own sections (no
    # upload) are one list, as bank_skills_applicant_name_key's
    op.create_index(
        "bank_custom_sections_owner_name_key",
        "bank_custom_sections",
        ["applicant_id", "resume_id", sa.text("lower(name)")],
        unique=True,
        postgresql_nulls_not_distinct=True,
    )
    # Every new table: RLS on, no policies (alembic/CLAUDE.md)
    op.execute("ALTER TABLE public.bank_custom_sections ENABLE ROW LEVEL SECURITY")

    op.add_column("bank_entries", sa.Column("custom_section_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "bank_entries_custom_section_id_fkey", "bank_entries", "bank_custom_sections",
        ["custom_section_id"], ["id"], ondelete="CASCADE",
    )
    op.create_index("ix_bank_entries_custom_section_id", "bank_entries", ["custom_section_id"], unique=False)
    op.create_check_constraint(
        "bank_entries_custom_section_check", "bank_entries",
        "(section = 'custom') = (custom_section_id IS NOT NULL)",
    )


def downgrade() -> None:
    """The custom entries and sections go, then the type is rebuilt without
    `custom`: Postgres can't drop an enum value."""
    op.drop_constraint("bank_entries_custom_section_check", "bank_entries", type_="check")
    op.execute("DELETE FROM bank_entries WHERE section = 'custom'")
    op.drop_index("ix_bank_entries_custom_section_id", table_name="bank_entries")
    op.drop_constraint("bank_entries_custom_section_id_fkey", "bank_entries", type_="foreignkey")
    op.drop_column("bank_entries", "custom_section_id")
    op.drop_index("bank_custom_sections_owner_name_key", table_name="bank_custom_sections")
    op.drop_index("ix_bank_custom_sections_applicant_id", table_name="bank_custom_sections")
    op.drop_table("bank_custom_sections")
    op.execute("ALTER TYPE bank_section RENAME TO bank_section_old")
    op.execute(
        "CREATE TYPE bank_section AS ENUM "
        "('education', 'experience', 'projects', 'leadership', 'awards', 'certifications')"
    )
    op.execute("ALTER TABLE bank_entries ALTER COLUMN section TYPE bank_section USING section::text::bank_section")
    op.execute("DROP TYPE bank_section_old")
