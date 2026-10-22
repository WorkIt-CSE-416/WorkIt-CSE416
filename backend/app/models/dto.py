'''
file that holds data objects, such as key words, enums, tec.
'''
import enum
from datetime import date

from pydantic import BaseModel as PydanticBase

# The size of every stored embedding: job_postings.embedding and
# experience_banks.embedding are vector(768), and embeddings.py asks Gemini for this
# size. Changing it takes a migration and re-embedding everything.
EMBEDDING_DIMENSIONS = 768


# --- Resume enums ---

class ResumeStatus(str, enum.Enum):
    uploaded="uploaded"
    parsed="parsed"
    parse_failed="parse_failed"


# --- Pydantic schemas for parsed_json structure ---

class Education(PydanticBase):
    institution: str
    degree: str | None = None
    field_of_study: str | None = None
    gpa: float | None = None
    # the "4.00" of "GPA: 3.81/4.00"
    gpa_scale: float | None = None
    start_date: date | None = None
    end_date: date | None = None
    description: str | None = None

class Experience(PydanticBase):
    company_name: str
    title: str
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    description: str | None = None

class Skill(PydanticBase):
    skill_name: str
    category: str | None = None

class Project(PydanticBase):
    project_name: str
    url: str | None = None
    # the tools after the name: "Maze Robot | C++, Python"
    technologies: list[str] = []
    start_date: date | None = None
    end_date: date | None = None
    description: str | None = None

class Certification(PydanticBase):
    cert_name: str
    issuer: str | None = None

_Date = date  # the field below is named "date", which hides the type

class Award(PydanticBase):
    title: str
    issuer: str | None = None
    date: _Date | None = None

class ParsedResume(PydanticBase):
    education: list[Education] = []
    experience: list[Experience] = []
    skills: list[Skill] = []
    projects: list[Project] = []
    certifications: list[Certification] = []
    # Leadership & Activities: the same shape as a job (KAN-211)
    leadership: list[Experience] = []
    awards: list[Award] = []


# size range for company
class company_size_range(enum.StrEnum):
    ONE_TO_FIFTY="1_50"
    FIFTY_TO_TWO_HUNDRED="51_200"
    TWO_HUNDRED_TO_FIVE_HUNDRED= "201_500"
    TOUSAND="501_1000"
    FIVE_THOUSAND="1001_5000"
    TEN_THOUSAND= "5001_10000"
    LARGE_THOUSAND= "10000_"

class company_role(enum.StrEnum):
    '''
    different possible roles for company memebership table
    '''
    owner= "owner"
    admin= "admin"
    recruiter= "recruiter"

class profile_status(enum.StrEnum):
    '''
    different possible status for a profile to be in
    '''
    active= "active"
    invited= "invited"
    disabled = "disabled"

class job_type(enum.StrEnum):
    '''
    how a job is set up. An internship is one of them (KAN-233), not an
    experience level: its hours, when a posting states them, aren't kept
    '''
    full_time= "full_time"
    part_time= "part_time"
    contract= "contract"
    internship= "internship"

class experience_level(enum.StrEnum):
    '''
    who a job is for (KAN-233): a student (every internship), a new grad, or
    someone with experience
    '''
    student= "student"
    new_grad= "new_grad"
    experienced= "experienced"

class work_style(enum.StrEnum):
    remote= "remote"
    hybrid= "hybrid"
    onsite= "onsite"

class salary_period(enum.StrEnum):
    year= "year"
    hour= "hour"
    # scraped internships often state these; never set on a company's job
    week= "week"
    month= "month"

class visa_sponsorship(enum.StrEnum):
    '''
    what a posting says about visas, read from its whole text by the scraper
    (scraper/workit_scraper/details.py). NULL, not a value, when it says nothing
    '''
    sponsors= "sponsors"
    no_sponsorship= "no_sponsorship"
    # US citizenship or a US security clearance required
    citizens_only= "citizens_only"

class job_post_status(enum.StrEnum):
    '''
    lifecycle status of a job posting
    '''
    draft= "draft"
    published= "published"
    # added by 1ea834081a48; ALTER TYPE, not an edit here, is what changes the column
    paused= "paused"
    closed= "closed"


class application_stage(enum.StrEnum):
    '''
    where one applicant's application to one job stands (job_applications.stage).
    Auto apply moves it (auto-apply/architecture.md, "The run"): queued by a
    batch or a job's Auto Apply button, then applied when the student clicks
    Submitted, skipped when they click Skip, needs_you when the fill failed.
    WorkIt Desktop (KAN-323, auto-apply/desktop.md) adds three between queued
    and applied: filling once a Worker claims it, review once it stops before
    Submit, approved once the student approves it. The Applied button sets
    applied straight away. Save sets saved (KAN-261), which counts as no
    application yet: queueing or applying moves it on. A new value is an
    ALTER TYPE and a coordinated deploy (models/CLAUDE.md)
    '''
    # added by 17ea74fa4573
    saved= "saved"
    queued= "queued"
    # added by 40329c7aef62 (KAN-323)
    filling= "filling"
    review= "review"
    approved= "approved"
    needs_you= "needs_you"
    skipped= "skipped"
    applied= "applied"


# --- Experience bank enums (KAN-206) ---

class bank_section(enum.StrEnum):
    '''
    the section an experience bank entry belongs to. Skills, the seventh
    section, is its own table (bank_skills), so it has no member here.
    '''
    education= "education"
    experience= "experience"
    projects= "projects"
    leadership= "leadership"
    awards= "awards"
    certifications= "certifications"

class entry_end_kind(enum.StrEnum):
    '''
    how an entry ends: on a month, ongoing ("Present"), or on a month still
    to come ("Expected May 2027"). Present has no end month; the others do.
    '''
    month= "month"
    present= "present"
    expected= "expected"
