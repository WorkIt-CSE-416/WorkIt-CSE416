"""resume-local skills: a skill one built resume owns, outside the bank (docs/tailor_resume.md)

Revision ID: a3d7f1c9e2b4
Revises: c8f2a4e6b913
Create Date: 2026-10-25 12:00:00.000000

Tailor's picked skills go on the tailored resume only, never into the
experience bank. A resume shows a skill through `built_resume_skills`, whose
`skill_id` points at `bank_skills`, so the skill keeps a row there, owned by
the built resume (`built_resume_id`), as `bank_bullet_variants` already has
resume-local wording. Deleting the resume deletes its skills.

Apply it BEFORE the deploy that maps the column: every skill insert names
it, so deployed first, uploads, Import Again and Add skill answer 500. It
only adds a nullable column, a check every row meets, and indexes, so the
running code never meets them and applying it early is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3d7f1c9e2b4'
down_revision: Union[str, Sequence[str], None] = 'c8f2a4e6b913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('bank_skills', sa.Column('built_resume_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        'bank_skills_built_resume_id_fkey', 'bank_skills', 'built_resumes',
        ['built_resume_id'], ['id'], ondelete='CASCADE')
    # Serves the cascade from built_resumes and "this resume's own skills".
    op.create_index(
        'bank_skills_built_resume_idx', 'bank_skills', ['built_resume_id'],
        postgresql_where=sa.text('built_resume_id IS NOT NULL'))
    # At most one owner: an upload, a built resume, or neither (the student's).
    op.create_check_constraint(
        'bank_skills_one_owner_check', 'bank_skills', 'resume_id IS NULL OR built_resume_id IS NULL')
    # One name per owner: a tailored resume's "Go" never clashes with the
    # bank's. Every row has a null built_resume_id now, so the new index holds.
    op.drop_index('bank_skills_applicant_name_key', table_name='bank_skills')
    op.execute(
        'CREATE UNIQUE INDEX bank_skills_applicant_name_key '
        'ON bank_skills (applicant_id, resume_id, built_resume_id, lower(name)) NULLS NOT DISTINCT'
    )


def downgrade() -> None:
    """Downgrade schema. Deletes every resume-local skill first: the old
    name index cannot hold a local "Go" beside the bank's, and the rows
    would have no owner left."""
    op.execute('DELETE FROM bank_skills WHERE built_resume_id IS NOT NULL')
    op.drop_index('bank_skills_applicant_name_key', table_name='bank_skills')
    op.execute(
        'CREATE UNIQUE INDEX bank_skills_applicant_name_key '
        'ON bank_skills (applicant_id, resume_id, lower(name)) NULLS NOT DISTINCT'
    )
    op.drop_constraint('bank_skills_one_owner_check', 'bank_skills', type_='check')
    op.drop_index('bank_skills_built_resume_idx', table_name='bank_skills')
    op.drop_constraint('bank_skills_built_resume_id_fkey', 'bank_skills', type_='foreignkey')
    op.drop_column('bank_skills', 'built_resume_id')
