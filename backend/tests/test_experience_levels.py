"""Only current experience levels reach database queries and API schemas."""

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import asyncpg

from app.models import dto
from app.models.jobs import Job_Post
from app.queries.jobs.filters import JobFilters, matching
from app.schemas.company_jobs import JobPostingCreate


def test_recommended_filters_never_bind_legacy_levels():
    filters = JobFilters(
        levels=["student", "new_grad"], query_levels=["student"],
        job_types=["part_time", "internship"],
    )
    query = select(Job_Post.id).where(*matching(filters))
    compiled = query.compile(
        dialect=asyncpg.dialect(), compile_kwargs={"render_postcompile": True},
    )
    level_params = [value for key, value in compiled.params.items() if "experience_level" in key]
    assert level_params
    assert set(level_params) == {"student", "new_grad"}
    assert set(dto.experience_level) == {"student", "new_grad", "experienced"}


@pytest.mark.parametrize("level", ["internship", "other"])
def test_company_form_rejects_legacy_levels(level):
    with pytest.raises(ValidationError):
        JobPostingCreate(
            title="Intern", description="x", jobType="internship",
            experienceLevel=level, workStyle="onsite", salary=20, salaryPeriod="hour",
        )
