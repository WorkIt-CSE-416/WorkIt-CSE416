"""
Request/response shapes for company job postings. Separate from
app/models/jobs.py on purpose, see backend/CLAUDE.md: "SQLAlchemy models and
Pydantic schemas are separate layers."

Request keys follow the job composer's JobDraft
(frontend/src/app/company/jobs/new/data.ts), so wiring the form is a rename of
nothing. The composer's display strings ("Full-time", "On-site") are not
accepted: the enums here are the stored values, and translating labels is the
form's job.
"""

import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.models import dto

# Money is >= 0 here so a bad figure is a 422 naming the field, rather than an
# IntegrityError from the salary_non_negative constraint. allow_inf_nan=False
# because Python's JSON parser accepts Infinity and NaN: Infinity passes ge=0,
# is stored, and comes back as null, and NaN's 422 echoes a value json.dumps
# can't encode, which turns it into a 500.
Money = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class JobPostingCreate(BaseModel):
    '''
    POST body for a new job. A new job is either saved as a draft or published
    straight away; closing a job is a later change, never a starting state.
    '''
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    status: Literal[dto.job_post_status.draft, dto.job_post_status.published] = dto.job_post_status.draft
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1)

    job_type: dto.job_type = Field(alias="jobType")
    experience_level: dto.experience_level = Field(alias="experienceLevel")
    min_years_experience: int | None = Field(None, alias="minYearsExperience", ge=0, le=50)
    work_style: dto.work_style = Field(alias="workStyle")

    # ISO codes, checked against the seeded countries/states by the foreign
    # keys. A remote job still names a country (backend/app/models/CLAUDE.md).
    location_country: str = Field(alias="locationCountry", pattern=r"^[A-Z]{2}$")
    location_state: str | None = Field(None, alias="locationState", pattern=r"^[A-Z]{2}-[A-Z0-9]{1,3}$")

    salary: Money | None = None
    salary_min: Money | None = Field(None, alias="salaryMin")
    salary_max: Money | None = Field(None, alias="salaryMax")
    salary_currency: str = Field("USD", alias="currency", pattern=r"^[A-Z]{3}$")
    salary_period: dto.salary_period = Field(dto.salary_period.year, alias="salaryPeriod")

    # Timezone required: a bare "2026-10-10" would be stored as UTC midnight
    # and show as the day before for anyone west of UTC.
    closes_at: AwareDatetime | None = Field(None, alias="closesAt")

    @model_validator(mode="after")
    def salary_and_location_agree(self):
        '''
        mirror the table's salary_exist, salary_range_ordered and state/country
        checks, so the form gets a readable 422 instead of a database error
        '''
        if self.salary is not None and (self.salary_min is not None or self.salary_max is not None):
            raise ValueError("send either salary or salaryMin and salaryMax, not both")
        if self.salary is None and (self.salary_min is None or self.salary_max is None):
            raise ValueError("salary, or both salaryMin and salaryMax, is required")
        if self.salary_min is not None and self.salary_max is not None and self.salary_min > self.salary_max:
            raise ValueError("salaryMin cannot be greater than salaryMax")
        if self.location_state is not None and not self.location_state.startswith(f"{self.location_country}-"):
            raise ValueError("locationState must be a state of locationCountry")
        # A closing date in the past is checked by the routes, not here: an
        # edit to a live job whose date has already lapsed is fine as long as
        # the date itself isn't being set, which only the route can tell.
        return self


class JobPostingUpdate(JobPostingCreate):
    '''
    PUT body: the full form again, plus the updatedAt the form was loaded
    with. The route refuses the save if the job has changed since, so two
    recruiters editing one job can't silently overwrite each other.
    '''
    updated_at: AwareDatetime = Field(alias="updatedAt")


class JobStatusChange(BaseModel):
    '''
    POST body for moving a job along its lifecycle, separate from editing its
    details so a status button never saves half-finished form changes.

    updatedAt is optional: the row menu acts on whatever the job is now, but
    the edit form sends the one it loaded. The form takes the new updated_at
    from the response for its next save, so without this check a pause could
    launder a stale form past PUT's conflict check.
    '''
    status: dto.job_post_status
    updated_at: AwareDatetime | None = Field(None, alias="updatedAt")


class JobPostingSummary(BaseModel):
    '''
    a job as the list returns it: what the Job Postings table shows, without
    the description, which can run to pages and isn't shown there
    '''
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    status: dto.job_post_status
    work_style: dto.work_style
    location_country: str
    location_state: str | None
    closes_at: datetime.datetime | None
    created_at: datetime.datetime
    updated_at: datetime.datetime


class JobPosting(BaseModel):
    '''
    a job posting as the API returns it
    '''
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    company_id: UUID
    posted_by_recruiter_id: UUID | None
    title: str
    description: str
    job_type: dto.job_type
    experience_level: dto.experience_level
    min_years_experience: int | None
    work_style: dto.work_style
    location_country: str
    location_state: str | None
    salary: float | None
    salary_min: float | None
    salary_max: float | None
    salary_currency: str
    salary_period: dto.salary_period
    status: dto.job_post_status
    closes_at: datetime.datetime | None
    created_at: datetime.datetime
    updated_at: datetime.datetime
