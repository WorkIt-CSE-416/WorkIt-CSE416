"""job roles

Revision ID: 362182aaa4fd
Revises: 98ab19cfe840
Create Date: 2026-10-10 15:48:28.481902

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '362182aaa4fd'
down_revision: Union[str, Sequence[str], None] = '98ab19cfe840'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # The tables only; the roles themselves are seeded by the next migration,
    # as a frozen copy of the list (docs/search.md).
    op.create_table(
        'job_roles',
        sa.Column('slug', sa.Text(), nullable=False),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('sort_order', sa.SmallInteger(), nullable=False),
        sa.PrimaryKeyConstraint('slug'),
        sa.UniqueConstraint('name'),
        sa.CheckConstraint("slug ~ '^[a-z][a-z0-9_]*$'", name='job_roles_slug_shape'),
    )
    op.create_table(
        'job_role_tags',
        sa.Column('job_id', sa.Uuid(), nullable=False),
        sa.Column('role_slug', sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint('job_id', 'role_slug'),
        sa.ForeignKeyConstraint(['job_id'], ['job_postings.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['role_slug'], ['job_roles.slug'], ondelete='RESTRICT'),
    )
    op.create_index('job_role_tags_role_idx', 'job_role_tags', ['role_slug', 'job_id'])
    # Autogenerate never emits this (alembic/CLAUDE.md).
    op.execute('ALTER TABLE public.job_roles ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE public.job_role_tags ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('job_role_tags_role_idx', table_name='job_role_tags')
    op.drop_table('job_role_tags')
    op.drop_table('job_roles')
