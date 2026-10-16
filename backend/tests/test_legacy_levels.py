"""KAN-233's bridge: rows an older import wrote read as the new values.

Delete with app/queries/jobs/legacy_levels.py once migration B has moved them.
"""

import pytest

from app.models import dto
from app.queries.jobs.legacy_levels import (
    JOB_TYPE_NOW,
    LEVEL_NOW,
    job_type_now,
    level_now,
    stored_levels,
)

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

