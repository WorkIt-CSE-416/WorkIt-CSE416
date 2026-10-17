"""KAN-233's bridge: rows an older import wrote read as the new values.

Delete with app/queries/jobs/legacy_levels.py once migration B has moved them.
"""

import datetime
import uuid

import pytest
from pydantic import ValidationError

from app.models import dto
from app.queries.jobs.legacy_levels import (
    JOB_TYPE_NOW,
    LEVEL_NOW,
    job_type_now,
    level_now,
    stored_levels,
)
from app.schemas.company_jobs import JobPosting, JobPostingCreate

L, T = dto.experience_level, dto.job_type


@pytest.mark.parametrize(
    ("job_type", "level", "now"),
    [
        (None, L.internship, (T.internship, L.student)),  # an old internship
        (T.full_time, L.internship, (T.internship, L.student)),  # its stated hours go
        (T.full_time, L.other, (T.full_time, L.experienced)),
        (T.internship, L.student, (T.internship, L.student)),  # already new
        (T.full_time, L.new_grad, (T.full_time, L.new_grad)),
        (None, None, (None, None)),
    ],
)
def test_a_stored_row_reads_as_the_new_values(job_type, level, now):
    assert (job_type_now(job_type, level), level_now(level)) == now


def test_a_level_filter_takes_its_old_spelling_too():
    assert stored_levels(["student", "new_grad", "experienced"]) == [
        L.student, L.internship, L.new_grad, L.experienced, L.other,
    ]


def test_the_facets_count_old_rows_under_the_new_values():
    def sql(expr):
        return str(expr.compile(compile_kwargs={"literal_binds": True}))

    assert "WHEN (job_postings.experience_level = 'internship') THEN 'student'" in sql(LEVEL_NOW)
    assert "WHEN (job_postings.experience_level = 'other') THEN 'experienced'" in sql(LEVEL_NOW)
    assert (
        "WHEN (job_postings.job_type = 'internship'"
        " OR job_postings.experience_level = 'internship') THEN 'internship'"
    ) in sql(JOB_TYPE_NOW)


def _posting(**changes):
    now = datetime.datetime.now(datetime.UTC)
    fields = {
        "id": uuid.uuid4(), "company_id": uuid.uuid4(), "posted_by_recruiter_id": None,
        "title": "Intern", "description": "x", "job_type": T.full_time,
        "experience_level": L.internship, "min_years_experience": None,
        "work_style": dto.work_style.onsite, "salary": 20.0, "salary_min": None,
        "salary_max": None, "salary_currency": "USD",
        "salary_period": dto.salary_period.hour,
        "status": dto.job_post_status.published, "closes_at": None,
        "created_at": now, "updated_at": now,
    }
    return JobPosting(**{**fields, **changes})


def test_a_company_job_saved_before_reads_as_the_new_values():
    old = _posting()
    assert (old.job_type, old.experience_level) == (T.internship, L.student)
    assert _posting(experience_level=L.other).experience_level == L.experienced


@pytest.mark.parametrize("level", ["internship", "other"])
def test_the_company_form_never_writes_an_old_level(level):
    with pytest.raises(ValidationError):
        JobPostingCreate(
            title="Intern", description="x", jobType="internship",
            experienceLevel=level, workStyle="onsite", salary=20, salaryPeriod="hour",
        )
