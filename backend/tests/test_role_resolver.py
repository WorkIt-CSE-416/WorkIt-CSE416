"""Regression tests for the role resolver.

Most cases are real titles from the scraped feed, each in a shape that needs a
rule or an alias of its own; the rest are titles from fields the feed doesn't
hold yet but will. The aliases interact (a short one fires inside a longer
title, an outright role drops the others), so when a title resolves wrong, add
it here with what it should give before touching
app/services/role_resolver.py.
"""
import importlib.util
import json
from pathlib import Path

import pytest

from app.services.role_resolver import ALIASES, NOT_ROLES, OUTRIGHT, RoleResolver

# The roles the database holds, read from the migration that seeds them, so
# these tests follow the seed rather than a copy of it.
_SEED = Path(__file__).parents[1] / "alembic" / "versions" / "ab07572bba38_seed_job_roles.py"
_spec = importlib.util.spec_from_file_location("seed_job_roles", _SEED)
_seed = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_seed)
ROLES = {slug: name for slug, name, _ in _seed.JOB_ROLES}

FEED = Path(__file__).parents[1] / "data" / "feed.json"


@pytest.fixture(scope="module")
def resolver():
    return RoleResolver(ROLES)


CASES = [
    # the plain title, and with the noise a job board adds around it
    ("Software Engineer Intern", {"software_engineer"}),
    ("2027 Software Engineer Intern", {"software_engineer"}),
    ("Software Engineer, New Grad (2027)", {"software_engineer"}),
    # word forms: "engineering" is "engineer", "fullstack" is "full stack"
    ("Software Engineering Intern (Summer 2027)", {"software_engineer"}),
    ("Intern, Software Engineering", {"software_engineer"}),
    ("Full-Stack Engineer - Early Career", {"software_engineer"}),
    ("Fullstack Engineer", {"software_engineer"}),
    ("AI SW Intern, Infrastructure & Data Centre Deployment",
     {"software_engineer", "infrastructure_engineer"}),
    # reversed: the comma is gone, so "engineer data" is its own alias
    ("Engineer, Data (New Grad)", {"data_engineer"}),
    # one-word aliases, which also cover the reversed "Engineer, Software"
    ("New Graduate Engineer, Software", {"software_engineer"}),
    ("Junior Java Developer", {"software_engineer"}),
    ("Flight Software Intern (Summer 2027)", {"software_engineer"}),
    ("Junior Tools Programmer", {"software_engineer"}),
    # whole words, never substrings: "salesforce" is not "sales"
    (("Junior Application Specialist - Salesforce Developer, Strategic Partnerships "
      "(Bangkok-based, Relocation Provided)"), {"software_engineer"}),
    # the longest alias wins where two start: sales before "developer"
    ("Business Developer Junior - CDI - H/F", {"sales_representative"}),
    # a role's own name is an alias, so it beats the shorter ones inside it
    ("Internship: Embedded Software Engineer", {"embedded_engineer"}),
    # several roles in one title
    ("Software Engineer (Machine Learning) Intern (Summer 2027)",
     {"software_engineer", "ai_ml_engineer"}),
    ("AI/ML PhD Intern (Summer 2027)", {"ai_ml_engineer"}),
    ("Forward Deployed Software Engineer, Internship - US Government",
     {"solutions_engineer", "software_engineer"}),
    ("Internship: Forward Deployed Engineer, Software",
     {"solutions_engineer", "software_engineer"}),
    ("Junior Engineer, FDE (Agentic & Eco-System)", {"solutions_engineer"}),
    # research: engineer, scientist, and quant research is quant
    ("Campus ML Research Engineer (Intern)", {"ai_ml_engineer", "research_engineer"}),
    ("Campus AI Research Engineer - Deep Learning (Intern)",
     {"ai_ml_engineer", "research_engineer"}),
    ("Machine Learning Research Intern 2027", {"ai_ml_engineer", "research_scientist"}),
    ("Quant Developer / Quant Research Intern - 2026/2027", {"quantitative_analyst"}),
    ("Junior Quant Researcher - ML Alpha Research", {"quantitative_analyst", "ai_ml_engineer"}),
    # "development" and "programming" are processes, not a developer or programmer
    ("AI Engineer - Graduate Development Program", {"ai_ml_engineer"}),
    ("Hardware Platform Development Intern", {"hardware_engineer"}),
    ("Systems Research Engineer Intern - GPU Programming (Summer 2027)",
     {"research_engineer"}),
    ("Intern - Software Development", {"software_engineer"}),
    # NOT_ROLES: a place, a kind of testing, a team
    ("Embedded Systems Software Engineering Intern at UIUC Research Park (January- August 2027)",
     {"embedded_engineer", "software_engineer"}),
    ("Flight Software Engineering Intern (Simulation/Hardware-In-The-Loop) - Spring & Summer 2027",
     {"software_engineer"}),
    ("Pioneering Intelligence: Data Science Co-Op (Embedded Science Team)", {"data_scientist"}),
    # QA is software testing, Quality is manufacturing
    ("Junior Software Quality Engineer", {"qa_engineer"}),
    ("QA Engineer Intern (6 months)", {"qa_engineer"}),
    ("Quality Engineering Intern", {"quality_engineer"}),
    ("Supplier Quality Engineer", {"quality_engineer"}),
    # an outright role drops the field words around it
    ("Technical Recruiter, Software Engineering", {"recruiter"}),
    ("Product Manager, Machine Learning Platform", {"product_manager"}),
    ("Software Sales Representative", {"sales_representative"}),
    # ... and its field alone is no alias, so it can't take a title from another role
    ("Software Engineer, Sales Platform", {"software_engineer"}),
    ("Software Engineer, Recruiting Platform", {"software_engineer"}),
    ("Junior Software Engineer with Accounting Experience (Mexico)", {"software_engineer"}),
    # the categories the scraper keeps beyond tech (KAN-172), from the titles in
    # scraper/tests/test_shortlist.py: every one needs a role here, or it drops
    # out of the Role filter
    ("Investment Banking Summer Analyst - Infrastructure M&A Advisory - Summer 2027",
     {"investment_banking_analyst"}),
    ("Private Equity Investment Intern", {"investment_analyst"}),
    ("Venture Capital Analyst Intern", {"investment_analyst"}),
    ("Actuarial Intern  - Summer 2027", {"actuary"}),
    ("Credit Analyst Intern (Jan 2027)", {"risk_analyst"}),
    ("Corporate Finance Intern", {"financial_analyst"}),
    ("Supply Chain Intern Summer 2027", {"supply_chain_analyst"}),
    ("Business Operations Intern - Summer 2027", {"operations_analyst"}),
    ("Deployment Strategist, Internship", {"operations_analyst"}),
    ("Junior Project Manager", {"project_manager"}),
    ("Hardware Technical Program Management Intern", {"project_manager"}),
    ("2027 New Graduate - Materials Engineer", {"chemical_engineer"}),
    ("Propulsion Manufacturing Intern (Summer 2027)",
     {"aerospace_engineer", "manufacturing_engineer"}),
    ("2027 Systems Engineer Intern", {"systems_engineer"}),
    ("Entry-Level Roadway Engineer", {"civil_engineer"}),
    ("Survey Internship", {"civil_engineer"}),   # "internship" is "intern"
    ("Water Infrastructure Engineering Intern", {"civil_engineer"}),
    ("Mechatronics Intern", {"robotics_engineer"}),
    ("Robot Learning Engineer Intern", {"ai_ml_engineer"}),
    ("Digital IC Design Engineer Intern", {"hardware_engineer"}),
    ("Product Design Engineering Intern Opportunities", {"mechanical_engineer"}),
    ("Graphic Design Intern", {"graphic_designer"}),
    ("Visual Design Co-op 2027", {"graphic_designer"}),
    ("Fall 2026: Industrial Design Co-op (October through December)", {"industrial_designer"}),
    ("Junior Copywriter", {"marketing_specialist"}),
    ("Media Planning Internship", {"marketing_specialist"}),
    ("Junior Video Buyer (Mensch)", {"marketing_specialist"}),   # a buyer of ads, not supplies
    ("People Operations Intern", {"hr_specialist"}),
    ("Partnerships Intern", {"sales_representative"}),
    # ... and their fields alone name no role, so a tech job serving one keeps its tag
    ("Forward Deployed Engineer Intern (HR Technology)", {"solutions_engineer"}),
    ("Software Engineer Intern, Finance Platform", {"software_engineer"}),
    ("Graduate Software Engineer (Supply Chain + Operations)", {"software_engineer"}),
    ("PMO Data Engineering Intern", {"data_engineer"}),
    # a test engineer is software, hardware or a lab: no one role, so no tag
    ("Test Engineering Intern Summer 2027", set()),
    # fields beyond the feed, for onboarding
    ("Registered Nurse - ICU", {"nurse"}),
    ("Clinical Psychologist", {"psychologist"}),
    ("Physical Therapist", {"clinician"}),
    ("High School Math Teacher", {"teacher"}),
    ("Assistant Store Manager", {"store_manager"}),
    ("Licensed Real Estate Agent", {"real_estate_agent"}),
    ("Structural Engineer I", {"structural_engineer"}),
    # names no role: nothing is forced into a nearest one
    ("Entry-Level AI Data Rater - Swedish (Poland)", set()),
    ("AI Labs Intern", set()),
    ("Engineer", set()),
    ("Intern", set()),
    ("", set()),
]


@pytest.mark.parametrize("title, expected", CASES)
def test_resolve(resolver, title, expected):
    assert resolver.resolve(title) == expected


@pytest.mark.parametrize("slug, name", ROLES.items())
def test_every_role_resolves_its_own_name(resolver, slug, name):
    assert resolver.resolve(name) == {slug}


@pytest.mark.parametrize(
    "slug, alias", [(slug, alias) for slug, aliases in ALIASES.items() for alias in aliases]
)
def test_every_alias_resolves_to_its_role(resolver, slug, alias):
    assert resolver.resolve(alias) == {slug}


@pytest.mark.parametrize("phrase", NOT_ROLES)
def test_not_roles_resolve_to_nothing(resolver, phrase):
    assert resolver.resolve(phrase) == set()


def test_outright_roles_are_seeded():
    assert OUTRIGHT <= set(ROLES)


def test_feed_coverage(resolver):
    # A floor, not a target: 95.7% of the 1,096-job snapshot on 2026-10-11.
    # Falling under it after a feed refresh means titles the aliases miss;
    # the untagged ones are the place to start.
    jobs = json.loads(FEED.read_text(encoding="utf-8"))
    titles = [job["title"] for job in (jobs if isinstance(jobs, list) else jobs["jobs"])]
    tagged = sum(1 for title in titles if resolver.resolve(title))
    assert tagged / len(titles) >= 0.9


# The construction checks, which make a bad alias fail the import instead of
# writing a tag the foreign key rejects or picking a winner silently.

def test_alias_for_an_unseeded_slug_is_refused():
    with pytest.raises(ValueError, match="doesn't hold"):
        RoleResolver(ROLES, aliases={**ALIASES, "astronaut": ("astronaut",)})


def test_outright_for_an_unseeded_slug_is_refused():
    with pytest.raises(ValueError, match="doesn't hold"):
        RoleResolver(ROLES, outright={"astronaut"})


def test_a_phrase_two_roles_claim_is_refused():
    # "Software Engineering" is "software engineer" once word forms apply
    aliases = {**ALIASES, "data_engineer": ("Software Engineering",)}
    with pytest.raises(ValueError, match="claimed by both"):
        RoleResolver(ROLES, aliases=aliases)


def test_a_not_role_that_is_an_alias_is_refused():
    with pytest.raises(ValueError, match="claimed by both"):
        RoleResolver(ROLES, not_roles=("machine learning",))


def test_an_alias_with_no_words_is_refused():
    with pytest.raises(ValueError, match="no words"):
        RoleResolver(ROLES, aliases={**ALIASES, "nurse": ("--",)})


# Search reads a query with the same aliases, and keeps what they didn't use.

@pytest.mark.parametrize("query, roles, rest", [
    ("swe intern stripe", {"software_engineer"}, ("intern", "stripe")),
    ("Stripe", set(), ("stripe",)),
    ("machine learning", {"ai_ml_engineer"}, ()),
    ("full-stack react", {"software_engineer"}, ("react",)),
    # one typed word that is two after word forms is used whole
    ("fullstack react", {"software_engineer"}, ("react",)),
    # a role dropped for an outright one gives its words back
    ("software recruiter", {"recruiter"}, ("software",)),
    # NOT_ROLES words stay searchable
    ("research park", set(), ("research", "park")),
    ("", set(), ()),
    # typos snap to the nearest alias word, and are used up like any other
    ("software engingger", {"software_engineer"}, ()),
    ("sofware enginer intern", {"software_engineer"}, ("intern",)),
    ("machne lerning", {"ai_ml_engineer"}, ()),
    ("fulstack react", {"software_engineer"}, ("react",)),   # then word forms
    ("registred nurse", {"nurse"}, ()),
    # a correction that completes no alias leaves the word as typed:
    # "scale" is close to "sales", which alone names no role
    ("scale", set(), ("scale",)),
    ("engine", set(), ("engine",)),
])
def test_read_query(resolver, query, roles, rest):
    result = resolver.read_query(query)
    assert result.roles == roles
    assert result.rest == rest


# Company and keyword searches must reach rest untouched; a name that fuzzy
# matched into an alias would silently stop being searched for.
@pytest.mark.parametrize("name", [
    "stripe", "google", "amazon", "nvidia", "databricks", "anthropic", "palantir",
    "microsoft", "salesforce", "citadel", "coinbase", "rippling", "react", "python",
    "remote", "internship",
])
def test_read_query_leaves_names_alone(resolver, name):
    result = resolver.read_query(name)
    assert result.roles == set()
    assert result.rest == (name,)


def test_short_words_are_never_corrected(resolver):
    # "mle" is one edit from "ml", but at that length every word is close to one
    assert resolver.read_query("mle").rest == ("mle",)


def test_titles_are_never_corrected(resolver):
    # fuzzy matching is for what a user types; a stored tag is never a guess
    assert resolver.resolve("Sofware Engineer") == set()
