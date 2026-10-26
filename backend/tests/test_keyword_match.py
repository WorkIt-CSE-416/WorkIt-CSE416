"""
Seam-1 tests for keyword extraction and the keyword match (KAN-215): a built
resume's match against a job posting, through the API on real Postgres, with
ScriptedLLM standing in for the model (seam 2). backend/CLAUDE.md's Tests
section has the setup.
"""

import json
import uuid

import httpx
import pytest
from openai import RateLimitError
from sqlalchemy import text
from workit_scout.testing import ScriptedLLM

from app.config import get_settings
from app.db import get_engine
from app.deps import get_current_account
from app.main import app
from app.models.dto import company_role, company_size_range, profile_status
from app.models.jobs import Job_Post
from app.models.profiles import Company_Membership, Company_Profile
from app.routers.scout import get_llm
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.schemas.jobs import JobListing
from app.scripts.import_jobs import _extract_keywords, import_feed

pytestmark = pytest.mark.anyio

APPLY_URL = "https://boards.example.com/acme/123"
DESCRIPTION = "Build services in Python and Go. Docker a plus. Kubernetes preferred."

KEYWORDS = [
    {"keyword": "Python", "kind": "required"},
    {"keyword": "Go", "kind": "required"},
    {"keyword": "Docker", "kind": "preferred"},
    {"keyword": "Kubernetes", "kind": "preferred"},
]


def reading(keywords) -> list[str]:
    """A ScriptedLLM script: the model's JSON reply with these keywords."""
    return [json.dumps({"keywords": keywords})]


def rate_limited() -> RateLimitError:
    request = httpx.Request("POST", "http://endpoint.test/v1/chat/completions")
    return RateLimitError("quota", response=httpx.Response(429, request=request), body=None)


async def _seed_applicant(session) -> uuid.UUID:
    applicant_id = uuid.uuid4()
    await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
    await session.execute(
        text("INSERT INTO applicant_profiles (id, email, full_name) VALUES (:id, :email, 'Sam Seeker')"),
        {"id": applicant_id, "email": f"sam{applicant_id.hex[:6]}@example.com"},
    )
    await session.commit()
    return applicant_id


def _sign_in(applicant_id: uuid.UUID) -> None:
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=applicant_id,
        email="sam@example.com",
        full_name="Sam Seeker",
        account_type=AccountType.APPLICANT,
        onboarding_completed=True,
    )


@pytest.fixture
async def student(database):
    """A signed-in applicant with a filled bank and a base resume.
    Yields (client, the resume's URL)."""
    async with database() as session:
        applicant_id = await _seed_applicant(session)
    _sign_in(applicant_id)
    me = f"/applicants/{applicant_id}"
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post(f"{me}/bank/entries", json={
                "section": "experience", "title": "Software Intern", "organization": "Acme",
                "start_month": "2025-06", "end_month": "2025-08",
                "bullets": ["Wrote billing services in python", "Fixed bugs in Django and MongoDB"],
            })
            assert res.status_code == 201, res.text
            res = await client.post(f"{me}/bank/skills", json={"name": "Docker", "group": "Tools"})
            assert res.status_code == 201, res.text
            res = await client.post(f"{me}/built-resumes", json={"name": "Base Resume"})
            assert res.status_code == 201, res.text
            yield client, f"{me}/built-resumes/{res.json()['id']}"
    finally:
        app.dependency_overrides.pop(get_current_account, None)


@pytest.fixture
def use_model():
    def install(*scripts) -> ScriptedLLM:
        fake = ScriptedLLM(*scripts)
        app.dependency_overrides[get_llm] = lambda: fake
        return fake

    yield install
    app.dependency_overrides.pop(get_llm, None)


async def _seed_posting(database, description: str | None = DESCRIPTION) -> str:
    async with database() as session:
        posting = await session.scalar(
            text(
                "INSERT INTO job_postings (title, status, company_name, apply_url, description)"
                " VALUES ('Backend Intern', 'published', 'Acme', :url, :description) RETURNING id"
            ),
            {"url": APPLY_URL, "description": description},
        )
        await session.commit()
    return str(posting)


async def _match(client, resume: str, posting: str) -> httpx.Response:
    return await client.get(f"{resume}/keyword-match", params={"job_posting_id": posting})


async def test_the_match_counts_keywords_in_the_shown_text_and_skills(student, database, use_model):
    client, resume = student
    posting = await _seed_posting(database)
    use_model(reading(KEYWORDS))

    res = await _match(client, resume, posting)

    assert res.status_code == 200, res.text
    body = res.json()
    # "python" in a bullet (any case) and Docker in the skills; "Go" is not
    # matched inside another word.
    assert body["matched"] == [
        {"keyword": "Python", "kind": "required"},
        {"keyword": "Docker", "kind": "preferred"},
    ]
    assert body["missing"] == [
        {"keyword": "Go", "kind": "required"},
        {"keyword": "Kubernetes", "kind": "preferred"},
    ]


async def test_keywords_are_extracted_once_and_cached_on_the_posting(student, database, use_model):
    client, resume = student
    posting = await _seed_posting(database)
    use_model(reading(KEYWORDS))
    first = (await _match(client, resume, posting)).json()
    assert first["uses_left"] == get_settings().ai_tailor_cap - 1

    # A model that would fail: the second match reads the cache, calls no
    # model and spends no use.
    fake = use_model(rate_limited())
    res = await _match(client, resume, posting)

    assert res.status_code == 200, res.text
    assert fake.prompts == []
    assert (res.json()["matched"], res.json()["missing"]) == (first["matched"], first["missing"])
    assert res.json()["uses_left"] == first["uses_left"]


async def test_another_students_match_reads_the_same_cache(student, database, use_model):
    client, resume = student
    posting = await _seed_posting(database)
    use_model(reading(KEYWORDS))
    await _match(client, resume, posting)

    async with database() as session:
        other = await _seed_applicant(session)
    _sign_in(other)
    made = await client.post(f"/applicants/{other}/built-resumes", json={})
    fake = use_model(rate_limited())
    res = await _match(client, f"/applicants/{other}/built-resumes/{made.json()['id']}", posting)

    assert res.status_code == 200, res.text
    assert fake.prompts == []
    assert len(res.json()["missing"]) == 4


def _listing(description: str, url: str = APPLY_URL) -> JobListing:
    return JobListing(
        id=url, title="Backend Intern", company="Acme", apply_url=url,
        experience_level="student", job_type="internship", work_style="onsite", location="Austin, TX",
        posted_at="2026-10-06T02:42:06+00:00", logo_url=None, description=description,
    )


async def _import(description: str) -> str:
    async with get_engine().begin() as conn:
        await import_feed(conn, [_listing(description)])
        return str(await conn.scalar(text("SELECT id FROM job_postings WHERE apply_url = :u"), {"u": APPLY_URL}))


async def _cache_cleared(posting: str) -> bool:
    async with get_engine().connect() as conn:
        return await conn.scalar(
            text("SELECT keywords IS NULL AND keywords_hash IS NULL FROM job_postings WHERE id = :id"),
            {"id": posting},
        )


async def test_a_re_import_that_changes_the_description_clears_the_keywords(student, use_model):
    client, resume = student
    posting = await _import(DESCRIPTION)
    use_model(reading(KEYWORDS))
    await _match(client, resume, posting)

    assert await _import(DESCRIPTION + " Rust required.") == posting
    # The cache itself is gone (the acceptance criterion), not just stale.
    assert await _cache_cleared(posting)
    use_model(reading([*KEYWORDS, {"keyword": "Rust", "kind": "required"}]))
    body = (await _match(client, resume, posting)).json()

    assert {"keyword": "Rust", "kind": "required"} in body["missing"]
    assert body["uses_left"] == get_settings().ai_tailor_cap - 2


async def test_a_re_import_with_the_same_description_keeps_the_keywords(student, use_model):
    client, resume = student
    posting = await _import(DESCRIPTION)
    use_model(reading(KEYWORDS))
    await _match(client, resume, posting)

    await _import(DESCRIPTION)
    assert not await _cache_cleared(posting)
    fake = use_model(rate_limited())
    res = await _match(client, resume, posting)

    assert res.status_code == 200
    assert fake.prompts == []


async def test_a_description_changed_elsewhere_is_extracted_again(student, database, use_model):
    client, resume = student
    posting = await _seed_posting(database)
    use_model(reading(KEYWORDS))
    await _match(client, resume, posting)

    # A company's edit goes through no import; the hash still tells.
    async with database() as session:
        await session.execute(
            text("UPDATE job_postings SET description = 'Now it wants Rust.' WHERE id = :id"), {"id": posting})
        await session.commit()
    use_model(reading([{"keyword": "Rust", "kind": "required"}]))
    body = (await _match(client, resume, posting)).json()

    assert (body["matched"], body["missing"]) == ([], [{"keyword": "Rust", "kind": "required"}])


async def test_at_most_20_keywords_without_repeats(student, database, use_model):
    client, resume = student
    posting = await _seed_posting(database)
    many = [{"keyword": "python", "kind": "required"}, {"keyword": "  ", "kind": "preferred"}]
    many += [{"keyword": f"Tool{i}", "kind": "preferred"} for i in range(30)]
    use_model(reading([{"keyword": "Python", "kind": "required"}, *many]))

    body = (await _match(client, resume, posting)).json()

    keywords = body["matched"] + body["missing"]
    assert len(keywords) == 20
    assert body["matched"] == [{"keyword": "Python", "kind": "required"}]
    assert keywords[-1] == {"keyword": "Tool18", "kind": "preferred"}


async def test_an_invalid_reply_answers_503_and_counts_no_use(student, database, use_model):
    client, resume = student
    posting = await _seed_posting(database)
    use_model([json.dumps({"keywords": [{"keyword": "Python", "kind": "essential"}]})])

    res = await _match(client, resume, posting)
    assert res.status_code == 503

    use_model(reading(KEYWORDS))
    assert (await _match(client, resume, posting)).json()["uses_left"] == get_settings().ai_tailor_cap - 1


async def test_a_failed_model_counts_no_use(student, database, use_model):
    client, resume = student
    posting = await _seed_posting(database)
    use_model(rate_limited())
    assert (await _match(client, resume, posting)).status_code == 503

    use_model(reading(KEYWORDS))
    assert (await _match(client, resume, posting)).json()["uses_left"] == get_settings().ai_tailor_cap - 1


async def test_extraction_answers_429_at_the_limit_but_a_cached_match_does_not(
    student, database, use_model, monkeypatch
):
    client, resume = student
    cached = await _seed_posting(database)
    use_model(reading(KEYWORDS))
    await _match(client, resume, cached)
    monkeypatch.setattr(get_settings(), "ai_tailor_cap", 1)

    async with database() as session:
        fresh = await session.scalar(text(
            "INSERT INTO job_postings (title, status, company_name, apply_url, description)"
            " VALUES ('Data Intern', 'published', 'Acme', 'https://boards.example.com/acme/456', 'SQL') RETURNING id"
        ))
        await session.commit()
    fake = use_model(reading(KEYWORDS))
    assert (await _match(client, resume, str(fresh))).status_code == 429
    assert fake.prompts == []
    res = await _match(client, resume, cached)
    assert (res.status_code, res.json()["uses_left"]) == (200, 0)


async def test_a_tailored_resume_matches_its_own_posting(student, database, use_model):
    client, resume = student
    posting = await _seed_posting(database)
    applicant_id = resume.split("/")[2]
    async with database() as session:
        tailored = await session.scalar(
            text(
                "INSERT INTO built_resumes (applicant_id, name, template, job_posting_id)"
                " VALUES (:a, 'Tailored', 'jakes', :p) RETURNING id"
            ),
            {"a": applicant_id, "p": posting},
        )
        await session.commit()
    use_model(reading(KEYWORDS))

    res = await client.get(f"/applicants/{applicant_id}/built-resumes/{tailored}/keyword-match")
    assert (res.status_code, res.json()["job_posting_id"]) == (200, posting)
    # A base resume needs a posting named.
    assert (await client.get(f"{resume}/keyword-match")).status_code == 422


async def _set_status(database, posting: str, status: str) -> None:
    async with database() as session:
        await session.execute(
            text("UPDATE job_postings SET status = CAST(:s AS job_post_status) WHERE id = :id"),
            {"s": status, "id": posting})
        await session.commit()


@pytest.mark.parametrize("status", ["draft", "paused", "closed"])
async def test_a_posting_the_jobs_page_does_not_list_is_404(student, database, use_model, status):
    client, resume = student
    posting = await _seed_posting(database)
    await _set_status(database, posting, status)
    fake = use_model(reading(KEYWORDS))

    assert (await _match(client, resume, posting)).status_code == 404
    assert fake.prompts == []


async def test_a_tailored_resume_still_matches_its_own_closed_posting(student, database, use_model):
    client, resume = student
    posting = await _seed_posting(database)
    applicant_id = resume.split("/")[2]
    use_model(reading(KEYWORDS))
    assert (await _match(client, resume, posting)).status_code == 200
    async with database() as session:
        tailored = await session.scalar(
            text(
                "INSERT INTO built_resumes (applicant_id, name, template, job_posting_id)"
                " VALUES (:a, 'Tailored', 'jakes', :p) RETURNING id"
            ),
            {"a": applicant_id, "p": posting},
        )
        await session.commit()
    await _set_status(database, posting, "closed")

    res = await client.get(f"/applicants/{applicant_id}/built-resumes/{tailored}/keyword-match")
    assert (res.status_code, res.json()["job_posting_id"]) == (200, posting)


async def test_unknown_posting_and_another_students_resume_are_404(student, database, use_model):
    client, resume = student
    use_model(reading(KEYWORDS))
    assert (await _match(client, resume, str(uuid.uuid4()))).status_code == 404

    posting = await _seed_posting(database)
    async with database() as session:
        other = await _seed_applicant(session)
    _sign_in(other)
    assert (await _match(client, resume, posting)).status_code == 403
    theirs = resume.replace(resume.split("/")[2], str(other))
    assert (await _match(client, theirs, posting)).status_code == 404


# Extraction ahead of any student: the feed import's pass and a company job's
# background task. Either way, a student's first match finds the cache.


async def _stored(posting: str):
    async with get_engine().connect() as conn:
        return await conn.scalar(text("SELECT keywords FROM job_postings WHERE id = :id"), {"id": posting})


async def _prefill(llm, *, limit: int = 10) -> int:
    async with get_engine().connect() as conn:
        return await _extract_keywords(conn, llm, limit=limit)


async def test_the_import_pass_fills_keywords_so_a_match_spends_nothing(student, use_model):
    client, resume = student
    posting = await _import(DESCRIPTION)

    assert await _prefill(ScriptedLLM(reading(KEYWORDS))) == 1
    assert await _stored(posting) == KEYWORDS
    fake = use_model(rate_limited())
    body = (await _match(client, resume, posting)).json()

    assert fake.prompts == []
    assert body["uses_left"] == get_settings().ai_tailor_cap


async def test_the_import_pass_skips_filled_closed_and_company_jobs(database):
    await _import(DESCRIPTION)
    assert await _prefill(ScriptedLLM(reading(KEYWORDS))) == 1
    closed = await _import(DESCRIPTION)
    await _set_status(database, closed, "closed")
    async with database() as session:
        company = await _seed_company(session)
        session.add(Job_Post(**_COMPANY_JOB, company_id=company, status="published"))
        await session.commit()

    fake = ScriptedLLM(reading(KEYWORDS))
    assert await _prefill(fake) == 0
    assert fake.prompts == []


async def test_the_import_pass_stops_when_no_model_answers():
    posting = (await _import_many(3))[0]
    fake = ScriptedLLM(rate_limited())

    assert await _prefill(fake) == 0
    assert len(fake.prompts) == 1
    assert await _cache_cleared(posting)


async def test_the_import_pass_skips_an_invalid_reply_and_ends():
    await _import_many(3)
    fake = ScriptedLLM(["not json"])

    # Each job is tried once: a reply that fails leaves its row NULL, and the
    # pass must not read that row again.
    assert await _prefill(fake) == 0
    assert len(fake.prompts) == 3


async def test_the_import_pass_keeps_to_its_limit():
    await _import_many(3)
    fake = ScriptedLLM(reading(KEYWORDS))

    assert await _prefill(fake, limit=2) == 2
    assert len(fake.prompts) == 2


async def _import_many(n: int) -> list[str]:
    """n published scraped jobs, in one feed: a later import would close
    the jobs it lacks."""
    urls = [f"https://boards.example.com/acme/{i}" for i in range(n)]
    async with get_engine().begin() as conn:
        await import_feed(conn, [_listing(DESCRIPTION, url) for url in urls])
        rows = await conn.execute(
            text("SELECT id FROM job_postings WHERE apply_url = ANY(:urls) ORDER BY id"), {"urls": urls})
        return [str(row.id) for row in rows]


_COMPANY_JOB = {
    "title": "Backend Intern", "description": DESCRIPTION, "job_type": "internship",
    "experience_level": "student", "work_style": "onsite", "salary": 30,
}
_COMPANY_FORM = {
    "title": "Backend Intern", "description": DESCRIPTION, "jobType": "internship",
    "experienceLevel": "student", "workStyle": "onsite", "salary": 30,
}


async def _seed_company(session) -> uuid.UUID:
    company = Company_Profile(
        company_name="Acme", contact_email=f"hr{uuid.uuid4().hex[:6]}@example.com",
        size_range=company_size_range.ONE_TO_FIFTY,
    )
    session.add(company)
    await session.flush()
    return company.id


@pytest.fixture
async def recruiter(database):
    """A signed-in active member of a company. Yields a client."""
    member_id = uuid.uuid4()
    async with database() as session:
        await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": member_id})
        company_id = await _seed_company(session)
        session.add(Company_Membership(
            id=member_id, email=f"r{member_id.hex[:6]}@example.com", full_name="Rae Recruiter",
            company_id=company_id, role=company_role.owner, status=profile_status.active,
        ))
        await session.commit()
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=member_id, email="rae@example.com", full_name="Rae Recruiter",
        account_type=AccountType.COMPANY, onboarding_completed=True,
        company_id=company_id, membership_status=profile_status.active,
    )
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_current_account, None)


async def test_a_company_job_published_gets_its_keywords(recruiter, use_model):
    use_model(reading(KEYWORDS))
    res = await recruiter.post("/company/jobs", json={**_COMPANY_FORM, "status": "published"})

    assert res.status_code == 201, res.text
    assert await _stored(res.json()["id"]) == KEYWORDS


async def test_a_company_draft_gets_none_until_it_is_published(recruiter, use_model):
    fake = use_model(reading(KEYWORDS))
    res = await recruiter.post("/company/jobs", json=_COMPANY_FORM)
    assert res.status_code == 201, res.text
    draft = res.json()
    assert fake.prompts == []
    assert await _stored(draft["id"]) is None

    res = await recruiter.put(f"/company/jobs/{draft['id']}", json={
        **_COMPANY_FORM, "status": "published", "updatedAt": draft["updated_at"],
    })
    assert res.status_code == 200, res.text
    assert await _stored(draft["id"]) == KEYWORDS


async def test_a_company_job_saves_when_no_model_answers(recruiter, use_model):
    use_model(rate_limited())
    res = await recruiter.post("/company/jobs", json={**_COMPANY_FORM, "status": "published"})

    assert res.status_code == 201, res.text
    assert await _stored(res.json()["id"]) is None
