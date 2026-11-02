"""Tests for auto apply's batch rules: pure functions, no DB."""

import pytest

from app.auto_apply.hosts import auto_apply_supported
from app.auto_apply.rules import pick_batch
from app.schemas.jobs import ScoredJob
from app.services.matching.scoring import compute_breakdown


def job(id: str, url: str, company: str = "Acme", title: str = "SWE Intern", match: int = 90) -> ScoredJob:
    return ScoredJob(
        id=id, title=title, company=company, apply_url=url,
        experience_level="student", job_type="internship", work_style=None, location=None,
        posted_at=None, logo_url=None, match=match,
        score_breakdown=compute_breakdown(None, 0.0, 0.0, 0.0, 1.0),
    )


GH = "https://job-boards.greenhouse.io/acme/jobs/"

# --- pick_batch ---

def test_takes_the_first_size_in_order():
    scored = [job(str(i), GH + str(i), title=f"Role {i}", match=100 - i) for i in range(15)]
    batch = pick_batch(scored, 10)
    assert [j.id for j in batch] == [str(i) for i in range(10)]


def test_one_per_company_and_title():
    scored = [
        job("1", GH + "1", company="Acme", title="SWE Intern"),
        job("2", GH + "2", company=" acme ", title="swe intern"),  # another office
        job("3", GH + "3", company="Acme", title="Data Intern"),
    ]
    assert [j.id for j in pick_batch(scored, 10)] == ["1", "3"]


def test_size_zero_or_empty_input():
    assert pick_batch([job("1", GH + "1")], 0) == []
    assert pick_batch([], 10) == []


# --- which job postings auto apply takes ---

@pytest.mark.parametrize("url", [
    "https://job-boards.greenhouse.io/acme/jobs/1",
    "https://boards.greenhouse.io/acme/jobs/1?gh_jid=1",
    "https://job-boards.eu.greenhouse.io/imc/jobs/1",
    "HTTPS://Boards.Greenhouse.IO/acme",
    "https://greenhouse.io/acme",
    # Every other hiring system the Fill engine fills (KAN-370).
    "https://jobs.lever.co/acme/1",
    "https://jobs.ashbyhq.com/acme/1/application",
    "https://ats.rippling.com/acme/jobs/1",
    "https://apply.workable.com/acme/j/ABC123/",
    "https://acme.eightfold.ai/careers?pid=1",
    "https://explore.jobs.netflix.net/careers/job/1",
    "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Intern_R1",
    "https://wd3.myworkdaysite.com/recruiting/acme/Careers/job/Intern_R1",
    "https://fa-acme-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/27180",
    # TikTok and ByteDance's careers sites: one form, behind their own sign-in.
    "https://lifeattiktok.com/search/7693732178706974981",
    "https://www.lifeattiktok.com/search/7693732178706974981",
    "https://careers.tiktok.com/resume/7693732178706974981/apply",
    "https://jobs.bytedance.com/en/position/7678450462765254965/detail",
    "https://joinbytedance.com/search/7678450462765254965",
    "https://jobs.smartrecruiters.com/Acme/744000000000001-field-technician",
    "https://career4.successfactors.com/career?career_ns=job_listing&company=AcmeCo&career_job_req_id=16550",
    # SuccessFactors' Recruiting Marketing career sites, which the engine covers (KAN-491).
    "https://assaabloy.jobs2web.com/job/Austin-Product-Management-Intern-TX-78753/1372221533/",
    "https://jobs.sap.com/job/Walldorf-Working-Student-BW-69190/1234567801/",
    "https://careers-acme.icims.com/jobs/1234/software-intern/job",
    # A company's own careers page that embeds Greenhouse's form (filled in its iframe).
    "https://stripe.com/jobs/search?gh_jid=8257892",
    "https://www.databricks.com/company/careers/open-positions/job?utm=x&gh_jid=8805655002",
    # Waymo's careers site, whose own form the Fill engine fills.
    "https://careers.withwaymo.com/jobs?gh_jid=8257660",
    "https://waymo.com/joinus/8257660?gh_jid=8257660",
])
def test_auto_apply_takes_every_hiring_system_the_fill_engine_fills(url):
    assert auto_apply_supported(url)
    assert ScoredJob.model_validate(job("1", url).model_dump()).auto_apply


@pytest.mark.parametrize("url", [
    # Job boards: their terms ban automation (KAN-369).
    "https://www.linkedin.com/jobs/view/1",
    "https://www.indeed.com/viewjob?jk=1",
    "https://jobs.jobvite.com/acme/job/1",  # a hiring system the engine doesn't fill
    # A gh_jid that isn't the query's.
    "https://example.com/jobs#gh_jid=1",
    "https://example.com/jobs?not_gh_jid=1",
    "https://example.com/?next=https://boards.greenhouse.io/acme",
    "https://greenhouse.io.example.com/acme",
    "https://notgreenhouse.io/acme",
    "https://notlever.co/acme",
    # Only TikTok's careers site, not the rest of tiktok.com or bytedance.com.
    "https://www.tiktok.com/@acme",
    "https://www.bytedance.com/en/news",
    # Only SAP's jobs site, not the rest of sap.com.
    "https://www.sap.com/products.html",
    "https://notjobs2web.com/job/1",
])
def test_auto_apply_leaves_out_other_hosts(url):
    assert not auto_apply_supported(url)
    assert not job("1", url).auto_apply
