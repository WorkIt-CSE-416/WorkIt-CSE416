"""job_postings.company_domain: the employer's own website, for its logo

KAN-442: a scraped job's logo was the image the scraper found, and for half
the jobs that was the website's favicon through Google's favicon service
(16 to 128px, blurry in the 80px tile); a third had no logo at all. The
scraper already finds the employer's website for that favicon. It will keep
the website's registered domain here (`goldmansachs.com`, never a careers
subdomain or a hiring vendor's host), and the Jobs page will load the logo
from Brandfetch by it.

A bare lower-case host name or NULL, held by the CHECK
`job_postings_company_domain`: the page writes the value into an image URL,
so a scheme, path, port or space must never reach it. NULL is a job whose
website the scraper did not find, a company-posted job, or a row from
before this column. No backfill: the import fills it.

Apply it as soon as it merges: nothing reads or writes the column yet, so
every deploy is safe with it. The code that maps it follows in its own PR,
whose import and company job inserts fail on a database without it.

Revision ID: d9b579e66623
Revises: 0d8dd3b7d8fd
Create Date: 2026-10-29 16:03:37.292440

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd9b579e66623'
down_revision: Union[str, Sequence[str], None] = '0d8dd3b7d8fd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('job_postings', sa.Column('company_domain', sa.Text(), nullable=True))
    # Labels of letters, digits and inner hyphens, at least two of them:
    # "goldmansachs.com", "kimley-horn.com", "co.uk" hosts too.
    op.create_check_constraint(
        'job_postings_company_domain',
        'job_postings',
        "company_domain IS NULL OR company_domain ~ "
        "'^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('job_postings_company_domain', 'job_postings', type_='check')
    op.drop_column('job_postings', 'company_domain')
