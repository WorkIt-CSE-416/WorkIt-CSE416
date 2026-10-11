"""seed job roles

Revision ID: ab07572bba38
Revises: 362182aaa4fd
Create Date: 2026-10-10 15:57:25.335140

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ab07572bba38'
down_revision: Union[str, Sequence[str], None] = '362182aaa4fd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Frozen copy of the first role list (docs/search.md). Flat: no role has a
# parent. A later change to the list is its own migration; never edit this one
# or import a constant into it. A slug never changes once shipped; a rename
# updates `name`.
#
# (slug, name, sort_order). Ordered for the onboarding picker and the board's
# filter, by group: engineering (software first, then hardware and the other
# fields), data and research, product, business, healthcare, education, then
# retail and real estate. Gaps of 10 leave room to insert a role without
# renumbering. Most roles past product have no scraped jobs yet; they are here
# so onboarding works for students outside CS.
#
# QA Engineer is software testing; Quality Engineer is manufacturing and
# product quality. Their aliases in role_resolver.py must keep them apart.
JOB_ROLES = [
    # engineering
    ('software_engineer', 'Software Engineer', 10),
    ('ai_ml_engineer', 'AI Machine Learning Engineer', 20),
    ('data_engineer', 'Data Engineer', 30),
    ('infrastructure_engineer', 'Infrastructure Engineer', 40),
    ('security_engineer', 'Security Engineer', 50),
    ('qa_engineer', 'QA Engineer', 60),
    ('quality_engineer', 'Quality Engineer', 70),
    ('solutions_engineer', 'Solutions Engineer', 80),
    ('hardware_engineer', 'Hardware Engineer', 90),
    ('embedded_engineer', 'Embedded Software Engineer', 100),
    ('electrical_engineer', 'Electrical Engineer', 110),
    ('mechanical_engineer', 'Mechanical Engineer', 120),
    ('civil_engineer', 'Civil Engineer', 130),
    ('structural_engineer', 'Structural Engineer', 140),
    # data and research
    ('data_scientist', 'Data Scientist', 150),
    ('data_analyst', 'Data Analyst', 160),
    ('research_scientist', 'Research Scientist', 170),
    ('research_engineer', 'Research Engineer', 180),
    ('quantitative_analyst', 'Quantitative Analyst', 190),
    # product
    ('product_manager', 'Product Manager', 200),
    ('product_designer', 'Product Designer', 210),
    # business
    ('business_analyst', 'Business Analyst', 220),
    ('accountant', 'Accountant', 230),
    ('marketing_specialist', 'Marketing Specialist', 240),
    ('sales_representative', 'Sales Representative', 250),
    ('recruiter', 'Recruiter', 260),
    # healthcare
    ('nurse', 'Nurse', 270),
    ('psychologist', 'Psychologist', 280),
    ('clinician', 'Clinician', 290),
    # education
    ('teacher', 'Teacher', 300),
    # retail and real estate
    ('store_manager', 'Store Manager', 310),
    ('real_estate_agent', 'Real Estate Agent', 320),
]

job_roles = sa.table(
    "job_roles",
    sa.column("slug", sa.Text),
    sa.column("name", sa.Text),
    sa.column("sort_order", sa.SmallInteger),
)
job_role_tags = sa.table(
    "job_role_tags",
    sa.column("role_slug", sa.Text),
)


def upgrade() -> None:
    """Upgrade schema."""
    op.bulk_insert(
        job_roles,
        [{"slug": s, "name": n, "sort_order": o} for s, n, o in JOB_ROLES],
    )


def downgrade() -> None:
    """Downgrade schema."""
    slugs = [s for s, _, _ in JOB_ROLES]
    # The tags first: job_role_tags RESTRICTs deleting a role still in use.
    # The import writes them, and writes them again once the roles are back.
    op.execute(job_role_tags.delete().where(job_role_tags.c.role_slug.in_(slugs)))
    op.execute(job_roles.delete().where(job_roles.c.slug.in_(slugs)))
