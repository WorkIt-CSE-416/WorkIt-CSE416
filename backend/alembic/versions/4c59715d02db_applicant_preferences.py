"""applicant preferences

A seeker's saved job preferences (KAN-231): what onboarding asks, in the
values GET /jobs filters on, plus the roles they picked as foreign keys to
job_roles (docs/search.md's planned profile_job_roles) and the places as
rows like job_locations'. Written by hand:
autogenerate never emits the RLS lines, and the CHECKs read clearer spelled
out.

Revision ID: 4c59715d02db
Revises: 027620538860
Create Date: 2026-10-14 22:50:28.874149

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '4c59715d02db'
down_revision: Union[str, Sequence[str], None] = '027620538860'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _list(name: str) -> sa.Column:
    return sa.Column(
        name, postgresql.ARRAY(sa.Text()), nullable=False, server_default=sa.text("'{}'")
    )


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'applicant_preferences',
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        _list('work_styles'),
        _list('levels'),
        _list('job_types'),
        _list('start_terms'),
        sa.Column('min_pay', sa.Numeric(12, 2), nullable=True),
        sa.Column('max_pay', sa.Numeric(12, 2), nullable=True),
        sa.Column('pay_per', sa.Text(), nullable=False, server_default=sa.text("'year'")),
        sa.Column('visa', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('applicant_id'),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.CheckConstraint("work_styles <@ ARRAY['remote','hybrid','onsite']::text[]",
                           name='applicant_preferences_work_styles'),
        sa.CheckConstraint("levels <@ ARRAY['student','new_grad','experienced']::text[]",
                           name='applicant_preferences_levels'),
        sa.CheckConstraint(
            "job_types <@ ARRAY['full_time','part_time','contract','internship']::text[]",
            name='applicant_preferences_job_types'),
        sa.CheckConstraint('cardinality(start_terms) <= 12',
                           name='applicant_preferences_start_terms_cap'),
        sa.CheckConstraint('min_pay IS NULL OR min_pay > 0', name='applicant_preferences_min_pay'),
        sa.CheckConstraint('max_pay IS NULL OR max_pay > 0', name='applicant_preferences_max_pay'),
        sa.CheckConstraint("pay_per IN ('hour','year')", name='applicant_preferences_pay_per'),
        sa.CheckConstraint("visa IS NULL OR visa IN ('sponsors','not_ruled_out')",
                           name='applicant_preferences_visa'),
    )
    op.create_table(
        'applicant_job_roles',
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('role_slug', sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint('applicant_id', 'role_slug'),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        # RESTRICT, as job_role_tags: a picked role can't be deleted from under
        # anyone (models/CLAUDE.md).
        sa.ForeignKeyConstraint(['role_slug'], ['job_roles.slug'], ondelete='RESTRICT'),
    )
    op.create_index('applicant_job_roles_role_idx', 'applicant_job_roles',
                    ['role_slug', 'applicant_id'])
    # Built like job_locations: a country, and the state when one was picked.
    op.create_table(
        'applicant_locations',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'),
                  nullable=False),
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('country', sa.CHAR(2), nullable=False),
        sa.Column('state', sa.String(6), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['country'], ['countries.code'],
                                name='applicant_locations_country_fkey'),
        # Postgres skips a composite FK when state is NULL; the country FK
        # above covers that row.
        sa.ForeignKeyConstraint(['state', 'country'], ['states.code', 'states.country_code'],
                                name='applicant_locations_state_country_fkey'),
        sa.UniqueConstraint('applicant_id', 'country', 'state',
                            name='applicant_locations_applicant_place_key',
                            postgresql_nulls_not_distinct=True),
    )
    # Autogenerate never emits this (alembic/CLAUDE.md).
    op.execute('ALTER TABLE public.applicant_preferences ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE public.applicant_job_roles ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE public.applicant_locations ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('applicant_locations')
    op.drop_index('applicant_job_roles_role_idx', table_name='applicant_job_roles')
    op.drop_table('applicant_job_roles')
    op.drop_table('applicant_preferences')
