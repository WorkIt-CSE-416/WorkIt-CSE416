"""enable row level security on every public table

Revision ID: ce5b2e3f9b78
Revises: 197cfcdecdb8
Create Date: 2026-09-25 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'ce5b2e3f9b78'
down_revision: Union[str, Sequence[str], None] = '197cfcdecdb8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Listed by hand, not read from Base.metadata: a migration must do the same
# thing on every machine forever, and the model list will grow. A table added
# later enables RLS in its own migration — see alembic/CLAUDE.md.
#
# alembic_version is Alembic's own bookkeeping table. It is in `public` too,
# so without this anyone with the anon key could read it — or rewrite it
# and break every teammate's migrations.
TABLES = (
    'applicant_profiles',
    'company_profiles',
    'company_memberships',
    'resumes',
    'countries',
    'states',
    'job_postings',
    'alembic_version',
)


def upgrade() -> None:
    """Upgrade schema.

    RLS with no policies denies every row to `anon` and `authenticated` —
    the roles Supabase's Data API uses for the anon key and for signed-in
    users. It is a backstop in case the `public` schema is ever re-exposed
    through the Data API; nothing in this app reads through that path.

    FastAPI and Alembic are unaffected: they connect as `postgres`, which owns
    these tables and has BYPASSRLS on Supabase. Deliberately ENABLE, not
    FORCE — FORCE would apply the policies to the owner too and lock FastAPI
    out of its own tables.
    """
    for table in TABLES:
        op.execute(f'ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    for table in TABLES:
        op.execute(f'ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY')
