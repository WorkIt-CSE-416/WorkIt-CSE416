"""Tests for auto apply's batch rules: pure functions, no DB."""

from app.auto_apply.rules import pick_batch
from app.schemas.jobs import ScoredJob
from app.services.matching.scoring import compute_breakdown


def job(id: str, url: str, company: str = "Acme", title: str = "SWE Intern", match: int = 90) -> ScoredJob:
    return ScoredJob(
        id=id, title=title, company=company, apply_url=url,
        experience_level="internship", work_style=None, location=None,
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
