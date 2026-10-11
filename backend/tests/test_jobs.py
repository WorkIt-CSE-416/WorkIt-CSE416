"""
GET /jobs: job_postings rows served in the feed's shape. The queries need
Postgres, which tests don't have, so the route is tested with its fetch stood
in for, and the row-to-listing mapping on its own.
"""

import datetime
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from app.db import get_session
from app.main import app
from app.models import dto
from app.routers.jobs import (
    YEARLY,
    JobFilters,
    location_options,
    matching,
    offered_in,
    query_facts,
    season_is_over,
    season_of,
    to_listing,
)
from app.schemas.jobs import FacetCount, JobFacets, JobListing, JobRoleOption
from app.services.role_resolver import RoleResolver, raw_words
from tests.test_role_resolver import ROLES

ROW = SimpleNamespace(
    id=uuid.UUID("6f1c0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b"),
    title="Robot Software Intern",
    company_name="Rhoda AI",
    apply_url="https://jobs.example/1",
    experience_level=dto.experience_level.internship,
    work_style=dto.work_style.hybrid,
    location_raw="Mountain View, CA",
    location_label="Mountain View, CA",
    posted_at=datetime.datetime(2026, 10, 6, 2, 42, 6, tzinfo=datetime.UTC),
    company_logo_url=None,
    job_type=None,
    min_years_experience=None,
    start_term="Summer 2027",
    sponsorship=dto.visa_sponsorship.sponsors,
    salary=None,
    salary_min=40.0,
    salary_max=46.0,
    salary_currency="USD",
    salary_period=dto.salary_period.hour,
)


@pytest.fixture
def no_database(monkeypatch):
    app.dependency_overrides[get_session] = lambda: None
    # ?q= is read by a resolver the route builds from job_roles; here, from the
    # seed migration's roles instead.
    resolver = RoleResolver(ROLES)

    async def role_resolver(db):
        return resolver

    monkeypatch.setattr("app.routers.jobs.role_resolver", role_resolver)
    yield
    app.dependency_overrides.clear()


def test_row_becomes_the_feed_shape():
    listing = to_listing(ROW, "ROS nodes.")
    assert listing.model_dump() == {
        "id": "6f1c0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
        "title": "Robot Software Intern",
        "company": "Rhoda AI",
        "apply_url": "https://jobs.example/1",
        "experience_level": "internship",
        "work_style": dto.work_style.hybrid,
        "location": "Mountain View, CA",
        "location_label": "Mountain View, CA",
        # The same string feed.json carried, so the frontend's dates don't move.
        "posted_at": "2026-10-06T02:42:06+00:00",
        "logo_url": None,
        "description": "ROS nodes.",
        "job_type": None,
        "salary": None,
        "salary_min": 40.0,
        "salary_max": 46.0,
        "salary_currency": "USD",
        "salary_period": dto.salary_period.hour,
        "min_years_experience": None,
        "start_term": "Summer 2027",
        "sponsorship": dto.visa_sponsorship.sponsors,
    }


def test_column_defaults_are_not_pay():
    # salary_currency and salary_period are NOT NULL with defaults (USD, year): a
    # job stating no pay must not read as "USD per year".
    unpaid = SimpleNamespace(**{**vars(ROW), "salary_min": None, "salary_max": None,
                                "salary_period": dto.salary_period.year})
    listing = to_listing(unpaid)
    assert (listing.salary_currency, listing.salary_period) == (None, None)


def test_row_without_a_date():
    assert to_listing(SimpleNamespace(**{**vars(ROW), "posted_at": None})).posted_at is None


def test_route_leaves_descriptions_out(no_database, monkeypatch):
    async def fetch(db, limit, filters, offset=0):
        return [to_listing(ROW, "long text")]

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    rows = TestClient(app).get("/jobs").json()
    assert rows[0]["title"] == "Robot Software Intern"
    assert "description" not in rows[0]


def test_route_passes_the_offset(no_database, monkeypatch):
    # Load More asks for the page after the one the board shows.
    seen = []

    async def fetch(db, limit, filters, offset=0):
        seen.append(offset)
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    client = TestClient(app)
    assert client.get("/jobs").status_code == 200
    assert client.get("/jobs?offset=50").status_code == 200
    assert client.get("/jobs?offset=-1").status_code == 422
    assert seen == [0, 50]


def test_route_reads_the_search_words(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters, offset=0):
        seen.append((list(filters.query_roles), list(filters.query_words)))
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    client = TestClient(app)
    for q in ("  Stripe ", "   ", None):
        assert client.get("/jobs", params={"q": q} if q is not None else {}).status_code == 200
    # Read as words, folded; blank is no search at all.
    assert seen == [([], ["stripe"]), ([], []), ([], [])]
    assert client.get("/jobs", params={"q": "x" * 201}).status_code == 422


@pytest.mark.parametrize(("q", "roles", "levels", "styles", "words"), [
    # a role, a fact, and a word left for the text or the company's name
    ("swe intern stripe", ["software_engineer"], ["internship"], [], ["stripe"]),
    ("stripe intern", [], ["internship"], [], ["stripe"]),
    ("machine learning", ["ai_ml_engineer"], [], [], []),
    # a typo is corrected before it is read (read_query)
    ("sofware engineer google", ["software_engineer"], [], [], ["google"]),
    # two roles: each narrows, so a job must be tagged with both
    ("ml software engineer", ["ai_ml_engineer", "software_engineer"], [], [], []),
    # a fact counts though a role's alias used its word: "marketing intern"
    # is the marketing role and an internship both
    ("marketing intern", ["marketing_specialist"], ["internship"], [], []),
    ("software engineer new grad remote", ["software_engineer"], ["new_grad"], ["remote"], []),
    ("data scientist co-op hybrid", ["data_scientist"], ["internship"], ["hybrid"], []),
])
def test_a_search_is_read_in_its_three_parts(no_database, monkeypatch, q, roles, levels, styles, words):
    seen = []

    async def fetch(db, limit, filters, offset=0):
        seen.append(filters)
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    assert TestClient(app).get("/jobs", params={"q": q}).status_code == 200
    (filters,) = seen
    assert list(filters.query_roles) == roles
    assert list(filters.query_levels) == levels
    assert [style.value for style in filters.query_work_styles] == styles
    assert list(filters.query_words) == words
    assert filters.query_start_terms is None


def test_a_search_s_year_is_a_start_term(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters, offset=0):
        seen.append(filters)
        return []

    async def terms_in(db, seasons):
        # A bare year is every season of it, and the year alone.
        assert list(seasons) == [
            "winter-2027", "spring-2027", "summer-2027", "fall-2027", "2027",
        ]
        return ["Summer 2027", "January 2027", "2027"]

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    monkeypatch.setattr("app.routers.jobs.terms_in", terms_in)
    assert TestClient(app).get("/jobs", params={"q": "intern 2027"}).status_code == 200
    (filters,) = seen
    assert list(filters.query_start_terms) == ["Summer 2027", "January 2027", "2027"]
    assert list(filters.query_levels) == ["internship"] and list(filters.query_words) == []


@pytest.mark.parametrize(("q", "levels", "styles", "seasons", "left"), [
    ("summer 2027", [], [], ["summer-2027"], []),
    ("2027 summer", [], [], ["summer-2027"], []),          # either order
    ("fall 2026 internship", ["internship"], [], ["fall-2026"], []),
    ("co-op on-site", ["internship"], ["onsite"], [], []),  # punctuation is gone
    ("new grads in person", ["new_grad"], ["onsite"], [], []),
    ("entry level", ["new_grad"], [], [], []),
    # a season with no year names no season, as season_of reads one
    ("summer", [], [], [], ["summer"]),
    ("stripe interns remote", ["internship"], ["remote"], [], ["stripe"]),
])
def test_query_facts(q, levels, styles, seasons, left):
    words = raw_words(q)
    facts = query_facts(words)
    assert list(facts.levels) == levels
    assert [style.value for style in facts.work_styles] == styles
    assert list(facts.seasons) == seasons
    assert [w for i, w in enumerate(words) if i not in facts.used] == left


def test_a_search_s_roles_each_narrow_on_their_own():
    clauses = matching(JobFilters(query_roles=["ai_ml_engineer", "software_engineer"]))
    assert len(clauses) == 2
    assert "job_role_tags.role_slug IN ('ai_ml_engineer')" in _sql(clauses[0])
    assert "job_role_tags.role_slug IN ('software_engineer')" in _sql(clauses[1])


def test_a_search_s_facts_narrow_their_own_columns():
    filters = JobFilters(
        query_levels=["internship"],
        query_work_styles=[dto.work_style.remote],
        query_start_terms=["Summer 2027"],
    )
    assert [_sql(c) for c in matching(filters)] == [
        "job_postings.experience_level IN ('internship')",
        "job_postings.work_style IN ('remote')",
        "job_postings.start_term IN ('Summer 2027')",
    ]


def test_each_search_word_matches_the_text_or_the_company_on_its_own():
    clauses = matching(JobFilters(query_words=["stripe", "100%_on"]))
    assert len(clauses) == 2
    sql = str(clauses[1].compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    # A stop word's empty query passes; else the stemmed text, or the name as typed.
    assert "numnode(plainto_tsquery('english', '100%%_on')) = 0" in sql
    assert "job_postings.fts @@ plainto_tsquery('english', '100%%_on')" in sql
    assert "job_postings.company_name ILIKE" in sql
    assert "100/%%/_on" in sql   # % and _ as themselves in the name


def test_route_passes_the_limit(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters, offset=0):
        seen.append(limit)
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    client = TestClient(app)
    assert client.get("/jobs").json() == []
    assert client.get("/jobs?limit=7").status_code == 200
    assert client.get("/jobs?limit=501").status_code == 422
    assert seen == [50, 7]


def test_a_feed_written_before_descriptions_still_parses():
    # The import still reads feed.json through JobListing.
    row = {**to_listing(ROW).model_dump(exclude={"description"})}
    assert JobListing.model_validate(row).description is None


def test_route_passes_the_places(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters, offset=0):
        seen.append(filters.places)
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    client = TestClient(app)
    assert client.get("/jobs").status_code == 200
    assert client.get("/jobs?location=US-CA&location=US").status_code == 200
    assert seen == [[], ["US-CA", "US"]]


@pytest.mark.parametrize("code", ["us", "California", "US-", "USA", "US-CA;"])
def test_route_rejects_a_malformed_place(no_database, code):
    assert TestClient(app).get("/jobs", params={"location": code}).status_code == 422


def test_route_caps_the_places(no_database):
    params = [("location", "US")] * 61
    assert TestClient(app).get("/jobs", params=params).status_code == 422


def test_a_state_is_matched_with_its_country():
    # The country comes first so job_locations_place_idx serves a state too.
    sql = str(offered_in(["US-CA", "ZZ"]).compile(compile_kwargs={"literal_binds": True}))
    assert "job_locations.country = 'US' AND job_locations.state = 'US-CA'" in sql
    assert "job_locations.country = 'ZZ'" in sql


def test_a_place_keeps_remote_jobs_that_name_none():
    # "Remote" alone resolves to no place; such a job matches every place,
    # where it would otherwise vanish under any location filter.
    sql = _sql(offered_in(["US"]))
    assert "job_postings.work_style = 'remote'" in sql
    assert "NOT (EXISTS" in sql


def test_every_place_counts_the_remote_jobs_that_name_none():
    options = location_options(
        [_country("US", "United States", 900), _country("ZZ", "Other", 40)],
        [_state("US-CA", "California", 300)],
        anywhere=15,
    )
    assert [(o.code, o.jobs) for o in options] == [("US", 915), ("US-CA", 315), ("ZZ", 55)]


def _country(code, name, jobs):
    return SimpleNamespace(code=code, name=name, jobs=jobs)


def _state(code, name, jobs):
    return SimpleNamespace(code=code, country=code[:2], name=name, jobs=jobs)


def test_locations_read_as_places():
    options = location_options(
        [_country("ZZ", "Other", 40), _country("US", "United States", 900)],
        [_state("US-NY", "New York", 120), _state("US-CA", "California", 300),
         _state("ZZ-ZZ", "Other", 2)],
    )
    assert [(o.code, o.label, o.jobs) for o in options] == [
        ("US", "United States", 900),
        ("US-CA", "California", 300),
        ("US-NY", "New York", 120),
        # Last whatever its count, and without its placeholder state.
        ("ZZ", "Other", 40),
    ]


def test_route_lists_locations(no_database, monkeypatch):
    async def fetch(db):
        return location_options([_country("US", "United States", 3)], [])

    monkeypatch.setattr("app.routers.jobs.fetch_location_options", fetch)
    assert TestClient(app).get("/jobs/locations").json() == [
        {"code": "US", "label": "United States", "jobs": 3}
    ]


def _sql(clause):
    return str(clause.compile(compile_kwargs={"literal_binds": True}))


def test_no_filters_add_no_clauses():
    assert matching(JobFilters()) == []


def test_route_reads_every_filter(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters, offset=0):
        seen.append(filters)
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    params = [
        ("work_style", "remote"), ("work_style", "hybrid"),
        ("experience", "internship"),
        ("job_type", "full_time"),
        ("posted_within", "7"),
        ("min_pay", "45"), ("pay_per", "hour"),
    ]
    assert TestClient(app).get("/jobs", params=params).status_code == 200
    (filters,) = seen
    assert list(filters.work_styles) == [dto.work_style.remote, dto.work_style.hybrid]
    assert list(filters.levels) == ["internship"]
    assert list(filters.job_types) == [dto.job_type.full_time]
    # $45 an hour is a full-time year's 2,080 hours of it.
    assert filters.min_yearly_pay == 45 * 2080
    ago = datetime.datetime.now(datetime.UTC) - filters.posted_since
    assert datetime.timedelta(days=7) <= ago < datetime.timedelta(days=7, minutes=1)


def test_a_yearly_minimum_is_taken_as_given(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters, offset=0):
        seen.append(filters.min_yearly_pay)
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    assert TestClient(app).get("/jobs?min_pay=80000").status_code == 200
    assert seen == [80000]


@pytest.mark.parametrize(
    "query",
    [
        "work_style=anywhere",
        "experience=experienced",  # the feed holds intern and new-grad roles only
        "job_type=freelance",
        "posted_within=0",
        "min_pay=-5",
        "min_pay=45&pay_per=month",
    ],
)
def test_route_rejects_a_bad_filter(no_database, query):
    assert TestClient(app).get(f"/jobs?{query}").status_code == 422


def test_pay_compares_as_a_yearly_figure_in_dollars():
    sql = " ".join(_sql(c) for c in matching(JobFilters(min_yearly_pay=93600.0)))
    assert "job_postings.salary_currency = 'USD'" in sql
    # The top of the range first, then a single amount, then a floor alone.
    assert "coalesce(job_postings.salary_max, job_postings.salary, job_postings.salary_min)" in sql
    assert "WHEN (job_postings.salary_period = 'hour') THEN 2080" in sql
    assert "WHEN (job_postings.salary_period = 'month') THEN 12" in sql
    assert ">= 93600.0" in sql


def test_every_pay_period_has_a_yearly_factor():
    # A period added to the enum without a factor would never match a pay filter.
    assert set(YEARLY) == set(dto.salary_period)


def test_each_filter_narrows_its_own_column():
    sql = [
        _sql(c)
        for c in matching(
            JobFilters(
                work_styles=[dto.work_style.onsite],
                levels=["new_grad"],
                job_types=[dto.job_type.part_time, dto.job_type.contract],
            )
        )
    ]
    assert sql == [
        "job_postings.work_style IN ('onsite')",
        "job_postings.experience_level IN ('new_grad')",
        (
            "job_postings.experience_level != 'internship'"
            " AND job_postings.job_type IN ('part_time', 'contract')"
        ),
    ]


def test_internship_is_a_job_type_of_its_own():
    # The Jobs page shows "Internship" as every internship's job type, so the
    # filter's Internship is every internship, and Full-Time is only the rest.
    (clause,) = matching(JobFilters(job_types=["internship"]))
    assert _sql(clause) == "job_postings.experience_level = 'internship'"
    (clause,) = matching(JobFilters(job_types=["full_time", "internship"]))
    assert _sql(clause) == (
        "job_postings.experience_level = 'internship'"
        " OR job_postings.experience_level != 'internship'"
        " AND job_postings.job_type IN ('full_time')"
    )


def test_route_reads_internship_as_a_job_type(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters, offset=0):
        seen.append(filters.job_types)
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    assert TestClient(app).get("/jobs?job_type=internship&job_type=part_time").status_code == 200
    assert list(seen[0]) == ["internship", "part_time"]


def test_role_keeps_jobs_tagged_with_any_of_the_roles_asked_for():
    # job_role_tags (KAN-155), not the scraper's roles column (KAN-172).
    (clause,) = matching(JobFilters(roles=["quantitative_analyst", "data_scientist"]))
    sql = _sql(clause)
    assert sql.startswith("EXISTS (SELECT *")
    assert "job_role_tags.job_id = job_postings.id" in sql
    assert "job_role_tags.role_slug IN ('quantitative_analyst', 'data_scientist')" in sql


def test_route_reads_roles(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters, offset=0):
        seen.append(filters.roles)
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    client = TestClient(app)
    assert client.get("/jobs?role=data_scientist&role=hardware_engineer").status_code == 200
    assert client.get("/jobs").status_code == 200
    assert seen == [["data_scientist", "hardware_engineer"], []]


def test_route_takes_every_seeded_role_at_once(no_database, monkeypatch):
    async def fetch(db, limit, filters, offset=0):
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    params = [("role", slug) for slug in ROLES]
    assert TestClient(app).get("/jobs", params=params).status_code == 200
    # Capped, like ?location=, so a URL can't become a thousand-clause query.
    params = [("role", f"role_{i}") for i in range(61)]
    assert TestClient(app).get("/jobs", params=params).status_code == 422


# Only the shape is checked, as for a place: a well-formed slug no job has
# matches nothing. KAN-172's keys with a slash are refused, so an old link's
# "data_ai/ml" is a 422 the Jobs page drops before sending (filter-query.ts).
@pytest.mark.parametrize(
    "role", ["Software", "data_ai/ml", "software-engineer", "1st_role", "", "a" * 65]
)
def test_route_rejects_a_malformed_role(no_database, role):
    assert TestClient(app).get("/jobs", params={"role": role}).status_code == 422
    assert TestClient(app).get("/jobs/count", params={"role": role}).status_code == 422


def test_count_reads_roles(no_database, monkeypatch):
    seen = []

    async def count(db, filters):
        seen.append(filters.roles)
        return 3

    monkeypatch.setattr("app.routers.jobs.fetch_count", count)
    assert TestClient(app).get("/jobs/count?role=product_manager").json() == {"jobs": 3}
    assert seen == [["product_manager"]]


def test_visa_sponsors_keeps_only_stated_sponsors():
    (clause,) = matching(JobFilters(visa="sponsors"))
    assert _sql(clause) == "job_postings.sponsorship = 'sponsors'"


def test_visa_not_ruled_out_keeps_the_silent_majority():
    # Most postings say nothing about visas; hiding them would empty the feed.
    (clause,) = matching(JobFilters(visa="not_ruled_out"))
    assert _sql(clause) == (
        "job_postings.sponsorship IS NULL OR job_postings.sponsorship = 'sponsors'"
    )


def test_route_reads_seasons_and_visa(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters, offset=0):
        seen.append(filters)
        return []

    async def terms_in(db, seasons):
        # The raw terms the feed uses for those seasons.
        assert list(seasons) == ["summer-2027", "2027"]
        return ["Summer 2027", "June 2027", "2027"]

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    monkeypatch.setattr("app.routers.jobs.terms_in", terms_in)
    params = [("start_term", "summer-2027"), ("start_term", "2027"), ("visa", "sponsors")]
    assert TestClient(app).get("/jobs", params=params).status_code == 200
    (filters,) = seen
    assert list(filters.start_terms) == ["Summer 2027", "June 2027", "2027"]
    assert filters.visa == "sponsors"
    assert _sql(matching(filters)[0]) == (
        "job_postings.start_term IN ('Summer 2027', 'June 2027', '2027')"
    )


def test_a_season_no_posting_names_matches_nothing(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters, offset=0):
        seen.append(filters.start_terms)
        return []

    async def terms_in(db, seasons):
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    monkeypatch.setattr("app.routers.jobs.terms_in", terms_in)
    assert TestClient(app).get("/jobs?start_term=fall-2030").status_code == 200
    # An empty list, not None, which would mean "any start date".
    assert seen == [[]]
    # And it renders as an always-false clause, not a value Postgres refuses.
    sql = _sql(matching(JobFilters(start_terms=[]))[0])
    assert "\x00" not in sql and "start_term IN" in sql


def test_no_start_date_filter_adds_no_clause():
    assert matching(JobFilters(start_terms=None)) == []


@pytest.mark.parametrize("key", ["Summer 2027", "summer2027", "monsoon-2027", "27"])
def test_route_rejects_a_malformed_season(no_database, key):
    assert TestClient(app).get("/jobs", params={"start_term": key}).status_code == 422


def test_route_rejects_an_unknown_visa_option(no_database):
    assert TestClient(app).get("/jobs?visa=maybe").status_code == 422


@pytest.mark.parametrize(
    ("term", "season"),
    [
        ("Summer 2027", "summer-2027"),
        ("June 2027", "summer-2027"),
        ("January 2027", "winter-2027"),
        # December starts the next year's winter.
        ("December 2026", "winter-2027"),
        ("Autumn 2027", "fall-2027"),
        ("2027", "2027"),
        # No year: the scraper didn't guess one, and the filter doesn't either.
        ("Summer", None),
    ],
)
def test_terms_fall_into_seasons(term, season):
    assert season_of(term) == season


@pytest.mark.parametrize(
    ("key", "day", "over"),
    [
        ("winter-2027", "2027-02-28", False),
        ("winter-2027", "2027-03-01", True),
        ("fall-2026", "2026-11-30", False),
        ("fall-2026", "2026-12-01", True),
        ("2026", "2026-12-31", False),
        ("2026", "2027-01-01", True),
    ],
)
def test_a_season_is_over_once_the_next_begins(key, day, over):
    assert season_is_over(key, datetime.date.fromisoformat(day)) is over


def test_route_lists_facets(no_database, monkeypatch):
    facets = JobFacets(
        work_style=[FacetCount(value="remote", jobs=73)],
        role=[
            JobRoleOption(value="software_engineer", label="Software Engineer", jobs=957),
            JobRoleOption(value="quantitative_analyst", label="Quantitative Analyst", jobs=41),
        ],
        experience=[], job_type=[], posted_within=[], visa=[], start_term=[],
    )

    async def fetch(db):
        return facets

    monkeypatch.setattr("app.routers.jobs.fetch_facets", fetch)
    body = TestClient(app).get("/jobs/facets").json()
    assert body["work_style"] == [{"value": "remote", "jobs": 73}]
    # A role carries its name: the Role filter's options come from here.
    assert body["role"] == [
        {"value": "software_engineer", "label": "Software Engineer", "jobs": 957},
        {"value": "quantitative_analyst", "label": "Quantitative Analyst", "jobs": 41},
    ]


def test_route_lists_every_role(no_database, monkeypatch):
    seen = []

    async def fetch(db, *, with_jobs_only):
        seen.append(with_jobs_only)
        return [JobRoleOption(value="nurse", label="Nurse", jobs=0)]

    monkeypatch.setattr("app.routers.jobs.fetch_role_options", fetch)
    # Matched as itself, not read as a job id by GET /jobs/{job_id}.
    body = TestClient(app).get("/jobs/roles").json()
    # Every role, a role with no jobs too: onboarding offers them all.
    assert body == [{"value": "nurse", "label": "Nurse", "jobs": 0}]
    assert seen == [False]


def test_count_reads_the_same_filters(no_database, monkeypatch):
    seen = []

    async def count(db, filters):
        seen.append(filters)
        return 128

    monkeypatch.setattr("app.routers.jobs.fetch_count", count)
    body = TestClient(app).get("/jobs/count?work_style=remote&visa=not_ruled_out").json()
    assert body == {"jobs": 128}
    (filters,) = seen
    assert list(filters.work_styles) == [dto.work_style.remote]
    assert filters.visa == "not_ruled_out"


def test_count_rejects_what_the_list_rejects(no_database):
    assert TestClient(app).get("/jobs/count?job_type=freelance").status_code == 422


def test_a_pay_range_matches_postings_whose_range_overlaps_it():
    sql = " ".join(
        _sql(c) for c in matching(JobFilters(min_yearly_pay=62400.0, max_yearly_pay=104000.0))
    )
    # The posting's top reaches the minimum...
    assert "coalesce(job_postings.salary_max, job_postings.salary, job_postings.salary_min)" in sql
    assert ">= 62400.0" in sql
    # ...and its bottom is within the maximum.
    assert "coalesce(job_postings.salary_min, job_postings.salary, job_postings.salary_max)" in sql
    assert "<= 104000.0" in sql
    # One currency clause, not one per end.
    assert sql.count("salary_currency = 'USD'") == 1


def test_route_reads_a_pay_range(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters, offset=0):
        seen.append((filters.min_yearly_pay, filters.max_yearly_pay))
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    assert TestClient(app).get("/jobs?min_pay=30&max_pay=50&pay_per=hour").status_code == 200
    assert TestClient(app).get("/jobs?max_pay=90000").status_code == 200
    assert seen == [(30 * 2080, 50 * 2080), (None, 90000)]


def test_a_backwards_pay_range_is_the_range_meant(no_database, monkeypatch):
    seen = []

    async def count(db, filters):
        seen.append((filters.min_yearly_pay, filters.max_yearly_pay))
        return 0

    monkeypatch.setattr("app.routers.jobs.fetch_count", count)
    assert TestClient(app).get("/jobs/count?min_pay=100000&max_pay=50000").status_code == 200
    assert seen == [(50000, 100000)]


def test_one_job_comes_with_its_description(no_database, monkeypatch):
    async def fetch(db, job_id):
        assert job_id == "6f1c0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b"
        return to_listing(ROW, "Build robots.")

    monkeypatch.setattr("app.routers.jobs.fetch_listing", fetch)
    body = TestClient(app).get("/jobs/6f1c0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b").json()
    assert (body["title"], body["description"]) == ("Robot Software Intern", "Build robots.")


def test_a_job_that_is_not_open_is_a_404(no_database, monkeypatch):
    async def fetch(db, job_id):
        return None

    monkeypatch.setattr("app.routers.jobs.fetch_listing", fetch)
    assert TestClient(app).get("/jobs/not-a-job").status_code == 404


def test_the_named_paths_are_not_read_as_ids(no_database, monkeypatch):
    async def fetch(db, job_id):
        raise AssertionError(f"read {job_id!r} as an id")

    async def count(db, filters):
        return 0

    monkeypatch.setattr("app.routers.jobs.fetch_listing", fetch)
    monkeypatch.setattr("app.routers.jobs.fetch_count", count)
    assert TestClient(app).get("/jobs/count").json() == {"jobs": 0}
