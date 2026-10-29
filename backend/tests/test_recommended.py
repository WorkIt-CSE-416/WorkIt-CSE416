"""
Seam-1 tests for GET /jobs/recommended (KAN-212): the recommender reads the
experience bank, never an uploaded resume. The bank embedding is made on the
first request after a change and kept until the next change; what is sent to
Gemini is checked at `embed`, which the route calls, so no network is needed.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount

pytestmark = pytest.mark.anyio

VECTOR = [0.1] * 768


async def _seed_applicant(session) -> uuid.UUID:
    applicant_id = uuid.uuid4()
    await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
    await session.execute(
        text(
            "INSERT INTO applicant_profiles (id, email, full_name, phone_number)"
            " VALUES (:id, :email, 'Sam Seeker', '631-555-0100')"
        ),
        {"id": applicant_id, "email": f"sam{applicant_id.hex[:6]}@example.com"},
    )
    await session.commit()
    return applicant_id


@pytest.fixture
def gemini(monkeypatch):
    """Stands in for Gemini: records each text sent and answers one vector."""
    sent: list[str] = []

    async def embed(texts, *, timeout=None):
        sent.extend(texts)
        return [VECTOR for _ in texts]

    monkeypatch.setattr("app.queries.jobs.recommendations.embed", embed)
    return sent


@pytest.fixture
async def student(database):
    """A signed-in applicant and an API client. Yields (client, applicant id, email)."""
    async with database() as session:
        applicant_id = await _seed_applicant(session)
    email = f"sam{applicant_id.hex[:6]}@example.com"
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=applicant_id,
        email=email,
        full_name="Sam Seeker",
        account_type=AccountType.APPLICANT,
        onboarding_completed=True,
    )
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, applicant_id, email
    finally:
        app.dependency_overrides.pop(get_current_account, None)


async def _add(client, applicant_id, path: str, body: dict) -> None:
    res = await client.post(f"/applicants/{applicant_id}/bank/{path}", json=body)
    assert res.status_code == 201, res.text


def _recommended(client, applicant_id):
    return client.get(f"/jobs/recommended/{applicant_id}")


async def test_the_bank_is_embedded_once_and_remade_after_a_change(student, gemini):
    client, me, _ = student
    await _add(client, me, "skills", {"name": "Python"})

    assert (await _recommended(client, me)).status_code == 200
    assert (await _recommended(client, me)).status_code == 200
    assert len(gemini) == 1  # kept, not remade, while the bank is unchanged

    await _add(client, me, "skills", {"name": "ROS"})
    assert (await _recommended(client, me)).status_code == 200
    assert len(gemini) == 2
    assert "ROS" in gemini[1]


async def test_the_embedding_input_follows_the_spec(student, gemini, database):
    client, me, email = student
    # An upload the recommender must ignore.
    async with database() as session:
        await session.execute(
            text(
                "INSERT INTO resumes (id, applicant_id, status, raw_text)"
                " VALUES (:id, :a, 'parsed', 'Sam Seeker. Skills: COBOL')"
            ),
            {"id": uuid.uuid4(), "a": me},
        )
        await session.commit()

    await _add(client, me, "skills", {"name": "Python", "group": "Languages"})
    await _add(client, me, "skills", {"name": "ROS"})
    await _add(client, me, "entries", {
        "section": "education", "title": "Stony Brook University", "location": "Stony Brook, NY",
        "degree": "BS", "field_of_study": "Computer Science", "gpa": 3.7,
        "start_month": "2023-09", "end_month": "2027-05", "end_kind": "expected",
    })
    await _add(client, me, "entries", {
        "section": "experience", "title": "Robotics Intern", "organization": "Acme",
        "location": "Austin, TX", "start_month": "2025-06", "end_kind": "present",
        "bullets": ["Wrote ROS nodes for arms.", f"Mailed {email} weekly reports."],
    })
    await _add(client, me, "entries", {
        "section": "projects", "title": "WorkIt", "link": "https://github.com/sam/workit",
        "start_month": "2024-01", "end_month": "2024-05",
        "bullets": ["Built a job board."],
    })

    assert (await _recommended(client, me)).status_code == 200
    assert gemini == [(
        "Skills: Python, ROS\n"
        "Experience: Robotics Intern, Acme\n"
        "- Wrote ROS nodes for arms.\n"
        "- Mailed [email] weekly reports.\n"
        "Projects: WorkIt\n"
        "- Built a job board."
    )]


async def test_the_embedding_input_is_cut_at_6000_characters(student, gemini):
    client, me, _ = student
    for i in range(20):
        await _add(client, me, "entries", {
            "section": "experience", "title": f"Role {i}", "organization": f"Org {i}",
            "bullets": ["Did a long and detailed piece of work " * 10] * 3,
        })
    assert (await _recommended(client, me)).status_code == 200
    (sent,) = gemini
    assert 5900 < len(sent) <= 6000


async def test_only_experience_entries_count_toward_years(student, gemini, database):
    client, me, _ = student
    async with database() as session:
        await session.execute(
            text(
                "INSERT INTO job_postings (title, company_name, apply_url, status, experience_level, min_years_experience)"
                " VALUES ('Engineer', 'Acme', 'https://jobs.example/e', 'published', 'new_grad', 3)"
            )
        )
        await session.commit()
    # Two years of Experience, plus three of Leadership that must not count.
    await _add(client, me, "entries", {
        "section": "experience", "title": "Engineer", "organization": "Acme",
        "start_month": "2023-01", "end_month": "2024-12",
    })
    await _add(client, me, "entries", {
        "section": "leadership", "title": "President", "organization": "Club",
        "start_month": "2020-01", "end_month": "2022-12",
    })

    (job,) = (await _recommended(client, me)).json()
    assert {"text": "Asks for 3+ years experience", "met": False} in job["highlights"]


async def test_an_empty_bank_has_no_recommendations(student, gemini):
    client, me, _ = student
    res = await _recommended(client, me)
    assert res.status_code == 404
    assert "experience bank" in res.json()["detail"]
    assert gemini == []


async def test_another_students_recommendations_are_forbidden(student, database):
    client, _, _ = student
    async with database() as session:
        other = await _seed_applicant(session)
    assert (await _recommended(client, other)).status_code == 403


async def _seed_postings(database) -> dict[str, str]:
    """Three listed postings: one auto apply fills, posted today; one it
    can't, posted today; one it can't, posted 200 days ago. Ids by name."""
    ids = {}
    async with database() as session:
        for name, url, days in [
            ("filled", "https://boards.greenhouse.io/acme/jobs/1", 0),
            ("recent", "https://jobs.example/recent", 0),
            ("old", "https://jobs.example/old", 200),
        ]:
            ids[name] = str((await session.execute(
                text(
                    "INSERT INTO job_postings (title, company_name, apply_url, status, experience_level, posted_at)"
                    " VALUES ('Python Engineer', 'Acme', :url, 'published', 'new_grad',"
                    " now() - make_interval(days => :days)) RETURNING id"
                ),
                {"url": url, "days": days},
            )).scalar())
        await session.commit()
    return ids


def _home(client, applicant_id):
    return client.get(f"/jobs/recommended/{applicant_id}/home?posted_within=30&min_match=0")


async def test_home_matches_are_the_three_recommended_lists(student, gemini, database):
    # One pass (KAN-425) must give each list its own GET /jobs/recommended
    # call: the top, the ones auto apply fills, and the recent ones' dates.
    client, me, _ = student
    ids = await _seed_postings(database)
    await _add(client, me, "skills", {"name": "Python"})

    res = await _home(client, me)
    assert res.status_code == 200, res.text
    home = res.json()

    def listed(query: str):
        return client.get(f"/jobs/recommended/{me}?{query}")

    top, filled, recent = [(await listed(q)).json() for q in (
        "limit=12", "limit=12&auto_apply=true", "posted_within=30&min_match=0&limit=500",
    )]
    assert [j["id"] for j in home["top"]] == [j["id"] for j in top]
    assert [j["match"] for j in home["top"]] == [j["match"] for j in top]
    assert [j["id"] for j in home["auto_apply"]] == [j["id"] for j in filled] == [ids["filled"]]
    assert home["strong_posted"] == [j["posted_at"] for j in recent]
    assert len(home["strong_posted"]) == 2


async def test_home_matches_are_kept_until_the_bank_or_applied_jobs_change(
    student, gemini, database, monkeypatch
):
    from app.queries.jobs import home

    client, me, _ = student
    ids = await _seed_postings(database)
    await _add(client, me, "skills", {"name": "Python"})
    passes = []
    score_job_sets = home.score_job_sets

    async def counted(*args, **kwargs):
        passes.append(1)
        return await score_job_sets(*args, **kwargs)

    monkeypatch.setattr(home, "score_job_sets", counted)

    assert (await _home(client, me)).status_code == 200
    assert (await _home(client, me)).status_code == 200
    assert len(passes) == 1  # the return visit is served from the kept result

    await _add(client, me, "skills", {"name": "SQL"})
    assert (await _home(client, me)).status_code == 200
    assert len(passes) == 2  # a bank change scores again

    async with database() as session:
        await session.execute(
            text("INSERT INTO job_applications (applicant_id, job_id, stage) VALUES (:a, :j, 'applied')"),
            {"a": me, "j": ids["recent"]},
        )
        await session.commit()
    res = await _home(client, me)
    assert len(passes) == 3  # so does marking a job applied, which drops out
    assert ids["recent"] not in [j["id"] for j in res.json()["top"]]


async def test_another_students_home_matches_are_forbidden(student, database):
    client, _, _ = student
    async with database() as session:
        other = await _seed_applicant(session)
    assert (await _home(client, other)).status_code == 403
