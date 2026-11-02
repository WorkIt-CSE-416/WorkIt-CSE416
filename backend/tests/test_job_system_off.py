"""
The per-job-system off switch (KAN-467): an admin turns one job system off
(Workday), the extension stops filling it (GET /extension/config), and no
new batch or Auto Apply click queues its postings. Turned back on, both
come back.
"""

import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select, text

from app.auto_apply import pipeline
from app.auto_apply.hosts import (
    JOB_SYSTEMS,
    SYSTEM_HOSTS,
    SYSTEM_URL_PATTERNS,
    job_system_of,
)
from app.config import get_settings
from app.deps import get_current_account
from app.main import app
from app.models.jobs import Job_Post
from app.queries.jobs.filters import JobFilters, matching
from app.schemas.auth import AccountType, AuthenticatedAccount
from tests import test_built_resumes

student = test_built_resumes.student

WORKDAY = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Remote/Engineer_R123"
GREENHOUSE = "https://job-boards.greenhouse.io/acme/jobs/7"


@pytest.mark.parametrize(
    "url, system",
    [
        (WORKDAY, "workday"),
        ("https://acme.wd1.myworkdaysite.com/recruiting/acme/External/job/1", "workday"),
        (GREENHOUSE, "greenhouse"),
        # A company's careers page showing a Greenhouse posting (?gh_jid=) is Greenhouse's form...
        ("https://stripe.com/jobs/search?gh_jid=8257892", "greenhouse"),
        # ...except Waymo's, which the engine fills with a filler of its own.
        ("https://careers.withwaymo.com/jobs/engineer?gh_jid=123", "waymo"),
        ("https://jobs.lever.co/acme/0b5e5a0c-6f0e-4a8e-9d1c-3c2f1f4b8a11", "lever"),
        ("https://explore.jobs.netflix.net/careers/job/790", "eightfold"),
        ("https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1", "oracle"),
        ("https://lifeattiktok.com/search/7350", "tiktok"),
        ("https://careers.tiktokusds.com/usds/position/7679251399185778949/detail", "tiktok"),
        ("https://career4.successfactors.com/career?company=acme&career_job_req_id=1", "successfactors"),
        ("https://careers-acme.icims.com/jobs/1/engineer/job", "icims"),
        ("https://www.linkedin.com/jobs/view/4012345678", None),
        ("https://careers.example.com/jobs/1", None),
    ],
)
def test_a_link_names_the_job_system_the_engine_fills_it_with(url, system):
    assert job_system_of(url) == system


def test_every_job_system_has_a_name_a_student_knows():
    # The names the extension's panel and the refusal show, by the engine's own ids (jobOf's `site`).
    assert JOB_SYSTEMS["workday"] == "Workday"
    assert JOB_SYSTEMS["smartrecruiters"] == "SmartRecruiters"
    assert set(JOB_SYSTEMS) == {
        "greenhouse", "lever", "ashby", "rippling", "workable", "eightfold", "smartrecruiters",
        "workday", "waymo", "tiktok", "oracle", "icims", "successfactors",
    }


def test_every_named_job_system_has_a_link_pattern_and_every_pattern_a_name():
    # Waymo has no host of its own (its careers site shows Greenhouse postings), so the
    # names are checked against the link patterns, not SYSTEM_HOSTS; hosts.py refuses to import otherwise.
    assert set(JOB_SYSTEMS) == set(SYSTEM_URL_PATTERNS)
    assert set(SYSTEM_HOSTS) == set(JOB_SYSTEMS) - {"waymo"}


# --- the list: GET /extension/config, and the admins' switch ---

ADMIN = "dev@example.com"


def _as(email: str | None) -> None:
    if email is None:
        app.dependency_overrides.pop(get_current_account, None)
        return
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=uuid.uuid4(), email=email, full_name="Dev", account_type=AccountType.APPLICANT, onboarding_completed=True,
    )


@pytest.fixture
async def api(database, monkeypatch):
    monkeypatch.setattr(get_settings(), "workit_admins", ADMIN)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client
    _as(None)


async def _config(api) -> list[dict]:
    _as(None)  # the extension asks it signed in or not
    res = await api.get("/extension/config")
    assert res.status_code == 200, res.text
    return res.json()["disabled_job_systems"]


@pytest.mark.anyio
async def test_an_admin_turns_a_job_system_off_and_on_and_the_config_says_so(api):
    assert await _config(api) == []

    _as(ADMIN)
    res = await api.put("/admin/disabled-job-systems/workday")
    assert res.status_code == 200, res.text
    assert await _config(api) == [{"job_system": "workday", "name": "Workday"}]

    _as(ADMIN)
    assert (await api.put("/admin/disabled-job-systems/workday")).status_code == 200  # again: no change
    assert (await api.delete("/admin/disabled-job-systems/workday")).status_code == 200
    assert await _config(api) == []


@pytest.mark.anyio
async def test_only_an_admin_changes_the_list_and_only_to_a_known_job_system(api):
    _as("sam@example.com")
    assert (await api.put("/admin/disabled-job-systems/workday")).status_code == 403
    assert (await api.delete("/admin/disabled-job-systems/workday")).status_code == 403
    _as(None)
    assert (await api.put("/admin/disabled-job-systems/workday")).status_code == 401
    _as(ADMIN)
    assert (await api.put("/admin/disabled-job-systems/myspace")).status_code == 422
    assert await _config(api) == []


# --- the queue: a job system turned off takes no new applications ---

async def _seed(database, apply_url: str) -> str:
    async with database() as session:
        posting = await session.scalar(text(
            "INSERT INTO job_postings (id, title, status, company_name, apply_url, experience_level)"
            " VALUES (gen_random_uuid(), 'Intern', 'published', 'Acme', :url, 'new_grad') RETURNING id"
        ), {"url": apply_url})
        await session.commit()
    return str(posting)


async def _switch(on: bool, system: str = "workday") -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as admin:
        saved = app.dependency_overrides.get(get_current_account)
        _as(ADMIN)
        res = await (admin.delete if on else admin.put)(f"/admin/disabled-job-systems/{system}")
        assert res.status_code == 200, res.text
        if saved:
            app.dependency_overrides[get_current_account] = saved


@pytest.mark.anyio
async def test_an_auto_apply_click_on_a_job_system_turned_off_is_refused_until_it_is_on(student, database, monkeypatch):
    monkeypatch.setattr(get_settings(), "workit_admins", ADMIN)
    client, me = student
    workday, greenhouse = await _seed(database, WORKDAY), await _seed(database, GREENHOUSE)
    await _switch(on=False)

    res = await client.post(f"{me}/applications", json={"job_id": workday})
    assert res.status_code == 404
    assert res.json()["detail"] == "WorkIt can't fill Workday right now. Try this job again later."
    assert (await client.post(f"{me}/applications", json={"job_id": greenhouse})).json()["stage"] == "queued"

    await _switch(on=True)
    assert (await client.post(f"{me}/applications", json={"job_id": workday})).json()["stage"] == "queued"


@pytest.mark.anyio
async def test_a_batch_matches_no_job_on_a_job_system_turned_off(database):
    # The matches' own filter, on real Postgres: its regex is Postgres's, not Python's.
    urls = {
        "workday": WORKDAY,
        "greenhouse": GREENHOUSE,
        "stripe": "https://stripe.com/jobs/search?gh_jid=8257892",
        "waymo": "https://careers.withwaymo.com/jobs/engineer?gh_jid=123",
        # A job board's posting that names a Workday form is that form.
        "linkedin": "https://www.linkedin.com/jobs/view/1",
    }
    ids = {name: await _seed(database, url) for name, url in urls.items()}
    async with database() as session:
        await session.execute(text("UPDATE job_postings SET description = :d WHERE id = :id"),
                              {"d": f'<a href="{WORKDAY}">Apply</a>', "id": ids["linkedin"]})
        await session.commit()

    async def matched(*off: str) -> set[str]:
        filters = JobFilters(auto_apply_only=True, disabled_job_systems=off)
        async with database() as session:
            found = await session.scalars(select(Job_Post.id).where(*matching(filters)))
        names = {v: k for k, v in ids.items()}
        return {names[str(i)] for i in found if str(i) in names}

    assert await matched() == set(urls)
    assert await matched("workday") == {"greenhouse", "stripe", "waymo"}
    assert await matched("greenhouse") == {"workday", "waymo", "linkedin"}
    assert await matched("waymo", "workday") == {"greenhouse", "stripe"}


def test_start_batch_leaves_out_the_job_systems_turned_off(monkeypatch):
    calls = []

    async def fetch_recommended(db, account, **kwargs):
        calls.append(kwargs)
        return []

    async def disabled(db):
        return ["workday"]

    monkeypatch.setattr(pipeline, "fetch_recommended", fetch_recommended)
    monkeypatch.setattr(pipeline, "fetch_disabled_job_systems", disabled)
    db = SimpleNamespace(commit=AsyncMock())
    monkeypatch.setattr(pipeline, "queue_applications", AsyncMock(return_value=set()))

    asyncio.run(pipeline.start_batch(db, SimpleNamespace(id=uuid.uuid4())))

    (kwargs,) = calls
    assert kwargs["filters"].disabled_job_systems == ("workday",)
