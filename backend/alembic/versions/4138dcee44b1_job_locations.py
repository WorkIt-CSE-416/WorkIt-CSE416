"""job locations

Revision ID: 4138dcee44b1
Revises: 55f3c813be50
Create Date: 2026-10-07 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4138dcee44b1'
down_revision: Union[str, Sequence[str], None] = '55f3c813be50'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'job_locations',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('job_id', sa.Uuid(), nullable=False),
        sa.Column('country', sa.CHAR(length=2), nullable=False),
        sa.Column('state', sa.String(length=6), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['job_id'], ['job_postings.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['country'], ['countries.code'], name='job_locations_country_fkey'),
        sa.ForeignKeyConstraint(
            ['state', 'country'], ['states.code', 'states.country_code'],
            name='job_locations_state_country_fkey',
        ),
        sa.UniqueConstraint(
            'job_id', 'country', 'state',
            name='job_locations_job_place_key', postgresql_nulls_not_distinct=True,
        ),
    )
    op.create_index('job_locations_place_idx', 'job_locations', ['country', 'state'])
    # Autogenerate never emits this (alembic/CLAUDE.md).
    op.execute('ALTER TABLE public.job_locations ENABLE ROW LEVEL SECURITY')

    # Every job keeps the one place it had.
    op.execute(
        'INSERT INTO job_locations (job_id, country, state) '
        'SELECT id, location_country, location_state FROM job_postings '
        'WHERE location_country IS NOT NULL'
    )

    op.drop_index('job_postings_loc_idx', table_name='job_postings')
    op.drop_constraint('country_state_reference_exist', 'job_postings', type_='foreignkey')
    op.drop_constraint('job_postings_location_country_fkey', 'job_postings', type_='foreignkey')
    op.drop_constraint('state_requires_country', 'job_postings', type_='check')
    op.drop_column('job_postings', 'location_state')
    op.drop_column('job_postings', 'location_country')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('job_postings', sa.Column('location_country', sa.CHAR(length=2), nullable=True))
    op.add_column('job_postings', sa.Column('location_state', sa.String(), nullable=True))

    # One place per job is all the old columns can hold. A job offered in
    # several keeps one of them, picked the same way every run.
    op.execute(
        'UPDATE job_postings j SET location_country = l.country, location_state = l.state '
        'FROM (SELECT DISTINCT ON (job_id) job_id, country, state FROM job_locations '
        'ORDER BY job_id, country, state NULLS LAST) l '
        'WHERE l.job_id = j.id'
    )

    op.create_check_constraint(
        'state_requires_country', 'job_postings',
        'location_state IS NULL OR location_country IS NOT NULL',
    )
    op.create_foreign_key(
        'job_postings_location_country_fkey', 'job_postings', 'countries',
        ['location_country'], ['code'],
    )
    op.create_foreign_key(
        'country_state_reference_exist', 'job_postings', 'states',
        ['location_state', 'location_country'], ['code', 'country_code'],
    )
    op.create_index('job_postings_loc_idx', 'job_postings', ['location_country', 'location_state'])

    op.drop_index('job_locations_place_idx', table_name='job_locations')
    op.drop_table('job_locations')
