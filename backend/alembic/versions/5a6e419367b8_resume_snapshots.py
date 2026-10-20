"""resume snapshots

KAN-267 (docs/sent_resume.md): a sent resume from a built resume keeps a
gzipped JSON snapshot of what its PDF is made from, rendered again on open,
in place of a PDF in Storage; one from an uploaded resume becomes a parsed
snapshot once that upload is replaced or deleted. `sent_resumes` gains
`snapshot_id`, `storage_path` becomes nullable, and a CHECK keeps exactly
one of the two.

Apply it before the deploy that writes it: the new code names
`snapshot_id` in every sent resume's INSERT, so deployed first, Apply and
auto apply answer 500. Applied early, the running code never meets it:
every row it writes has a `storage_path`, which the CHECK allows.

Revision ID: 5a6e419367b8
Revises: d642d93fcfbc
Create Date: 2026-10-20 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5a6e419367b8'
down_revision: Union[str, Sequence[str], None] = 'd642d93fcfbc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'resume_snapshots',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('content_hash', sa.String(), nullable=False),
        # built: a built resume's view, exact. upload: a replaced or deleted
        # upload's text as the parser read it, approximate.
        sa.Column('source', sa.String(), nullable=False),
        sa.Column('data', sa.LargeBinary(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('applicant_id', 'content_hash', name='resume_snapshots_applicant_hash_key'),
        sa.CheckConstraint("source IN ('built', 'upload')", name='resume_snapshots_source_check'),
    )
    # By hand: autogenerate never emits RLS (alembic/CLAUDE.md). Deny-all
    # backstop against the anon key; ENABLE, never FORCE.
    op.execute('ALTER TABLE public.resume_snapshots ENABLE ROW LEVEL SECURITY')

    op.add_column('sent_resumes', sa.Column('snapshot_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        'sent_resumes_snapshot_id_fkey', 'sent_resumes', 'resume_snapshots',
        ['snapshot_id'], ['id'], ondelete='RESTRICT',
    )
    op.create_index('ix_sent_resumes_snapshot_id', 'sent_resumes', ['snapshot_id'])
    op.alter_column('sent_resumes', 'storage_path', existing_type=sa.String(), nullable=True)
    op.create_check_constraint(
        'sent_resumes_one_file', 'sent_resumes', 'num_nonnulls(storage_path, snapshot_id) = 1',
    )


def downgrade() -> None:
    """Downgrade schema.

    The old table has no place for a snapshot, so the sent resumes kept as
    one are deleted before `storage_path` is required again.
    """
    op.drop_constraint('sent_resumes_one_file', 'sent_resumes', type_='check')
    op.execute('DELETE FROM sent_resumes WHERE snapshot_id IS NOT NULL')
    op.alter_column('sent_resumes', 'storage_path', existing_type=sa.String(), nullable=False)
    op.drop_index('ix_sent_resumes_snapshot_id', table_name='sent_resumes')
    op.drop_constraint('sent_resumes_snapshot_id_fkey', 'sent_resumes', type_='foreignkey')
    op.drop_column('sent_resumes', 'snapshot_id')
    op.drop_table('resume_snapshots')
