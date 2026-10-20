"""autofill answers

KAN-283: one JSONB bank per applicant of their answers to the questions
hiring systems repeat (work authorization, sponsorship, citizenship and visa
status, clearance, veteran status, disability), which onboarding's second
step now asks. Nothing reads the table before the deploy that adds its
routes, so applying it early is safe; deployed first, onboarding's Continue
answers 500.

Revision ID: a7d3e5c1b942
Revises: c785e96ac011
Create Date: 2026-10-20 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a7d3e5c1b942'
down_revision: Union[str, Sequence[str], None] = 'c785e96ac011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'autofill_answers',
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column(
            'answers', postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"), nullable=False,
        ),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("jsonb_typeof(answers) = 'object'", name='autofill_answers_answers_object'),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('applicant_id'),
    )
    # By hand: autogenerate never emits RLS (alembic/CLAUDE.md). ENABLE, never FORCE.
    op.execute('ALTER TABLE public.autofill_answers ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('autofill_answers')
