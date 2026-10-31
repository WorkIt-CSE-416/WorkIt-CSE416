"""
The per-job-system off switch (KAN-467): an admin turns one job system off
(Workday), the extension stops filling it (GET /extension/config), and no
new batch or Auto Apply click queues its postings. Turned back on, both
come back.
"""

import uuid

import httpx
import pytest

from app.auto_apply.hosts import JOB_SYSTEMS, job_system_of
from app.config import get_settings
from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount

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
