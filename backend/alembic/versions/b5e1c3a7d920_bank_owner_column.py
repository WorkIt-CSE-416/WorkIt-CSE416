"""bank owner column: each upload owns the entries and skills it imported (ADR 0005)

Revision ID: b5e1c3a7d920
Revises: 0457dddf041a
Create Date: 2026-10-23 12:00:00.000000

The expand half of ADR 0005. Apply it BEFORE the deploy that writes the
column: the models map `resume_id`, so deployed first, every bank read,
upload and Import Again answers 500. It only adds nullable columns, so the
running code never meets them and applying it early is safe.

An item read from exactly one upload (one `bank_entry_sources` or
`bank_skill_sources` row) takes that upload as its owner. An item with no
source, or with several, stays unowned: plain SQL cannot split a merged
entry into one copy per upload, and a migration must not run the parser.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b5e1c3a7d920'
down_revision: Union[str, Sequence[str], None] = '0457dddf041a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TABLES = (
    ('bank_entries', 'bank_entry_sources', 'entry_id'),
    ('bank_skills', 'bank_skill_sources', 'skill_id'),
)


def upgrade() -> None:
    """Upgrade schema."""
    for table, sources, item in _TABLES:
        op.add_column(table, sa.Column('resume_id', sa.Uuid(), nullable=True))
        op.create_foreign_key(
            f'{table}_resume_id_fkey', table, 'resumes', ['resume_id'], ['id'], ondelete='CASCADE')
        # Serves "the items this upload owns" and the cascade from resumes.
        op.create_index(f'{table}_applicant_resume_idx', table, ['applicant_id', 'resume_id'])
        op.execute(f"""
            UPDATE {table} AS t SET resume_id = s.resume_id
            FROM (
                SELECT {item} AS id, (array_agg(resume_id))[1] AS resume_id
                FROM {sources} GROUP BY {item} HAVING count(*) = 1
            ) AS s
            WHERE t.id = s.id
        """)
    # One name per owner: once per upload, and once among the student's own.
    # The old index (one name per student) already held, so the new one does.
    op.drop_index('bank_skills_applicant_name_key', table_name='bank_skills')
    op.execute(
        'CREATE UNIQUE INDEX bank_skills_applicant_name_key '
        'ON bank_skills (applicant_id, resume_id, lower(name)) NULLS NOT DISTINCT'
    )


def downgrade() -> None:
    """Downgrade schema. Fails while two uploads own a skill of one name:
    the old index allowed a name once per student."""
    op.drop_index('bank_skills_applicant_name_key', table_name='bank_skills')
    op.create_index(
        'bank_skills_applicant_name_key', 'bank_skills', ['applicant_id', sa.text('lower(name)')], unique=True)
    for table, _, _ in reversed(_TABLES):
        op.drop_index(f'{table}_applicant_resume_idx', table_name=table)
        op.drop_constraint(f'{table}_resume_id_fkey', table, type_='foreignkey')
        op.drop_column(table, 'resume_id')
