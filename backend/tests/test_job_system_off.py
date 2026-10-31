"""
The per-job-system off switch (KAN-467): an admin turns one job system off
(Workday), the extension stops filling it (GET /extension/config), and no
new batch or Auto Apply click queues its postings. Turned back on, both
come back.
"""

import pytest

from app.auto_apply.hosts import JOB_SYSTEMS, job_system_of

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

