'''
the bridge between the two ways a job row can state an internship, while both
exist (KAN-233)

Before KAN-233 an internship was `experience_level = internship` with its
hours, if any, in `job_type`, and an experienced job was `experience_level =
other`. Now an internship is `job_type = internship` with `experience_level =
student`, and an experienced job is `experienced`. Migration A only added the
new enum values, so rows imported before this deploy still hold the old ones
until migration B moves them.

Everything that reads the two columns goes through here, so it reads both
spellings alike, and PR 2 (after migration B) deletes this module and lets
its callers compare the columns directly. Nothing ever writes an old value:
the scraper, the import and the company form send the new ones only.
'''
from collections.abc import Iterable

from sqlalchemy import Text, case, cast, or_
from sqlalchemy.sql.elements import ColumnElement

from app.models import dto
from app.models.jobs import Job_Post

_OLD_LEVEL = {
    dto.experience_level.internship: dto.experience_level.student,
    dto.experience_level.other: dto.experience_level.experienced,
}

# The values each level matches in the column, old spellings included.
_STORED_AS = {
    dto.experience_level.student: (dto.experience_level.student, dto.experience_level.internship),
    dto.experience_level.new_grad: (dto.experience_level.new_grad,),
    dto.experience_level.experienced: (
        dto.experience_level.experienced,
        dto.experience_level.other,
    ),
}


def stored_levels(levels: Iterable[str]) -> list[dto.experience_level]:
    '''the column values that mean any of these levels'''
    return [value for level in levels for value in _STORED_AS[dto.experience_level(level)]]


# An internship, written either way.
IS_INTERNSHIP: ColumnElement[bool] = or_(
    Job_Post.job_type == dto.job_type.internship,
    Job_Post.experience_level == dto.experience_level.internship,
)

# Each column as the new values, for counting (the filter row's facets).
LEVEL_NOW: ColumnElement[str] = case(
    (Job_Post.experience_level == dto.experience_level.internship, "student"),
    (Job_Post.experience_level == dto.experience_level.other, "experienced"),
    else_=cast(Job_Post.experience_level, Text),
)
JOB_TYPE_NOW: ColumnElement[str] = case(
    (IS_INTERNSHIP, "internship"), else_=cast(Job_Post.job_type, Text)
)


def level_now(level: dto.experience_level | None) -> dto.experience_level | None:
    '''a stored level as the new values'''
    return _OLD_LEVEL.get(level, level) if level is not None else None


def job_type_now(
    job_type: dto.job_type | None, level: dto.experience_level | None
) -> dto.job_type | None:
    '''a stored job type as the new values: an old-style internship is one'''
    if level == dto.experience_level.internship:
        return dto.job_type.internship
    return job_type
