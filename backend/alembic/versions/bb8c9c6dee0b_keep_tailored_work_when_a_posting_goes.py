"""keep tailored work when a posting goes: tailored resumes block the delete, variants keep their wording

Revision ID: bb8c9c6dee0b
Revises: f2b8d6c4a913
Create Date: 2026-10-13 22:00:00.000000

Postings close (status), never go, but a hard delete used to cascade: it
took the student's tailored resume and the posting's bullet variants with
it, and another resume sharing a variant fell back to the original wording
without notice. Now a tailored resume blocks the delete (RESTRICT), and a
variant outlives its posting (SET NULL), still shown wherever a choice
names it. RLS is untouched: no table is created.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'bb8c9c6dee0b'
down_revision: Union[str, Sequence[str], None] = 'f2b8d6c4a913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _repoint(table: str, ondelete: str) -> None:
    name = f'{table}_job_posting_id_fkey'
    op.drop_constraint(name, table, type_='foreignkey')
    op.create_foreign_key(name, table, 'job_postings', ['job_posting_id'], ['id'], ondelete=ondelete)


def upgrade() -> None:
    _repoint('built_resumes', 'RESTRICT')
    _repoint('bank_bullet_variants', 'SET NULL')


def downgrade() -> None:
    _repoint('bank_bullet_variants', 'CASCADE')
    _repoint('built_resumes', 'CASCADE')
