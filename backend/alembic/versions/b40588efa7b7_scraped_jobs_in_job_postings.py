"""scraped jobs in job_postings

Revision ID: b40588efa7b7
Revises: 4623ff1e8bb1
Create Date: 2026-10-06 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b40588efa7b7'
down_revision: Union[str, Sequence[str], None] = '4623ff1e8bb1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The enum columns made nullable below. Their types already exist, so these
# only describe them to alter_column and never create anything.
ENUM_COLUMNS = {
    'job_type': postgresql.ENUM('full_time', 'part_time', 'contract', name='job_type', create_type=False),
    'experience_level': postgresql.ENUM('internship', 'new_grad', 'other', name='experience_level', create_type=False),
    'work_style': postgresql.ENUM('remote', 'hybrid', 'onsite', name='work_style', create_type=False),
}


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('job_postings', sa.Column('company_name', sa.Text(), nullable=True))
    op.add_column('job_postings', sa.Column('company_logo_url', sa.Text(), nullable=True))
    op.add_column('job_postings', sa.Column('apply_url', sa.Text(), nullable=True))
    op.add_column('job_postings', sa.Column('location_raw', sa.Text(), nullable=True))
    op.add_column('job_postings', sa.Column('posted_at', sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint('job_postings_apply_url_key', 'job_postings', ['apply_url'])

    op.alter_column('job_postings', 'company_id', existing_type=sa.Uuid(), nullable=True)
    op.alter_column('job_postings', 'description', existing_type=sa.Text(), nullable=True)
    for column, type_ in ENUM_COLUMNS.items():
        op.alter_column('job_postings', column, existing_type=type_, nullable=True)

    # The company form always sends a status (draft unless published), so this
    # only decides what an import writes when it sends none.
    op.alter_column('job_postings', 'status', server_default='published')

    op.drop_constraint('salary_exist', 'job_postings', type_='check')
    # The NOT NULLs dropped above still hold for a company's job, here instead.
    op.create_check_constraint(
        'company_job_complete', 'job_postings',
        "company_id IS NULL OR (description IS NOT NULL AND job_type IS NOT NULL"
        " AND experience_level IS NOT NULL AND work_style IS NOT NULL)",
    )
    op.create_check_constraint(
        'external_job_complete', 'job_postings',
        "company_id IS NOT NULL OR (company_name IS NOT NULL AND apply_url IS NOT NULL)",
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Scraped rows can't satisfy the NOT NULLs restored below, and the next
    # import recreates them.
    op.execute("DELETE FROM job_postings WHERE company_id IS NULL")

    op.drop_constraint('external_job_complete', 'job_postings', type_='check')
    op.drop_constraint('company_job_complete', 'job_postings', type_='check')
    # Fails if a company's job has been saved without a salary by then; the
    # company form requires one, so only a change to that would allow it.
    op.create_check_constraint(
        'salary_exist', 'job_postings',
        'salary IS NOT NULL OR (salary_min IS NOT NULL AND salary_max IS NOT NULL)',
    )

    op.alter_column('job_postings', 'status', server_default='draft')

    for column, type_ in ENUM_COLUMNS.items():
        op.alter_column('job_postings', column, existing_type=type_, nullable=False)
    op.alter_column('job_postings', 'description', existing_type=sa.Text(), nullable=False)
    op.alter_column('job_postings', 'company_id', existing_type=sa.Uuid(), nullable=False)

    op.drop_constraint('job_postings_apply_url_key', 'job_postings', type_='unique')
    op.drop_column('job_postings', 'posted_at')
    op.drop_column('job_postings', 'location_raw')
    op.drop_column('job_postings', 'apply_url')
    op.drop_column('job_postings', 'company_logo_url')
    op.drop_column('job_postings', 'company_name')
