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
# fields), data and research, product and design, business, finance,
# marketing, sales and people, healthcare, education, then retail and real
# estate. Gaps of 10 leave room to insert a role without renumbering.
#
# The groups cover the twelve categories the scraper keeps (KAN-172,
# scraper/workit_scraper/shortlist.py), so a job it keeps finds a role here;
# healthcare, education, retail and real estate have no scraped jobs (the
# scraper holds those fields off) and are here for onboarding.
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
    ('robotics_engineer', 'Robotics Engineer', 110),
    ('electrical_engineer', 'Electrical Engineer', 120),
    ('mechanical_engineer', 'Mechanical Engineer', 130),
    ('aerospace_engineer', 'Aerospace Engineer', 140),
    ('manufacturing_engineer', 'Manufacturing Engineer', 150),
    ('industrial_engineer', 'Industrial Engineer', 160),
    ('systems_engineer', 'Systems Engineer', 170),
    ('chemical_engineer', 'Chemical Engineer', 180),
    ('civil_engineer', 'Civil Engineer', 190),
    ('structural_engineer', 'Structural Engineer', 200),
    # data and research
    ('data_scientist', 'Data Scientist', 210),
    ('data_analyst', 'Data Analyst', 220),
    ('research_scientist', 'Research Scientist', 230),
    ('research_engineer', 'Research Engineer', 240),
    ('quantitative_analyst', 'Quantitative Analyst', 250),
    # product and design
    ('product_manager', 'Product Manager', 260),
    ('product_designer', 'Product Designer', 270),
    ('graphic_designer', 'Graphic Designer', 280),
    ('industrial_designer', 'Industrial Designer', 290),
    # business
    ('business_analyst', 'Business Analyst', 300),
    ('operations_analyst', 'Operations Analyst', 310),
    ('project_manager', 'Project Manager', 320),
    ('supply_chain_analyst', 'Supply Chain Analyst', 330),
    # finance
    ('financial_analyst', 'Financial Analyst', 340),
    ('investment_banking_analyst', 'Investment Banking Analyst', 350),
    ('investment_analyst', 'Investment Analyst', 360),
    ('risk_analyst', 'Risk Analyst', 370),
    ('actuary', 'Actuary', 380),
    ('accountant', 'Accountant', 390),
    # marketing, sales and people
    ('marketing_specialist', 'Marketing Specialist', 400),
    ('sales_representative', 'Sales Representative', 410),
    ('recruiter', 'Recruiter', 420),
    ('hr_specialist', 'HR Specialist', 430),
    # healthcare
    ('nurse', 'Nurse', 440),
    ('psychologist', 'Psychologist', 450),
    ('clinician', 'Clinician', 460),
    # education
    ('teacher', 'Teacher', 470),
    # retail and real estate
    ('store_manager', 'Store Manager', 480),
    ('real_estate_agent', 'Real Estate Agent', 490),
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
