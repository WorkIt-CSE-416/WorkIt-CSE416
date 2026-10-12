'''
file that holds data objects, such as key words, enums, tec.
'''
import enum
from datetime import date

from pydantic import BaseModel as PydanticBase

# The size of every stored embedding: job_postings.embedding and
# resumes.embedding are vector(768), and embedding.py asks Gemini for this
# size. Changing it takes a migration and re-embedding everything.
EMBEDDING_DIMENSIONS = 768


# --- Resume enums ---

class ResumeStatus(str, enum.Enum):
    uploaded="uploaded"
    parsed="parsed"
    parse_failed="parse_failed"


# --- Pydantic schemas for parsed_json structure ---
#
# Every resume, uploaded or built, is stored as one of these (KAN-176). An
# item's `bullets` are its lines one by one; `description` is the same text as
# one string, which is what the parser writes and what older rows hold. Read
# them through services.experience.bullets_of, never one field alone.

class Education(PydanticBase):
    institution: str
    degree: str | None = None
    field_of_study: str | None = None
    gpa: float | None = None
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    description: str | None = None
    bullets: list[str] = []

class Experience(PydanticBase):
    company_name: str
    title: str
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    description: str | None = None
    bullets: list[str] = []

class Skill(PydanticBase):
    skill_name: str
    category: str | None = None

class Project(PydanticBase):
    project_name: str
    url: str | None = None
    # The tools it was built with, printed beside its name ("Python, Flask")
    technologies: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    description: str | None = None
    bullets: list[str] = []

class Certification(PydanticBase):
    cert_name: str
    issuer: str | None = None
    end_date: date | None = None

class Activity(PydanticBase):
    '''a club, team, volunteer or leadership role: experience that isn't a job'''
    organization: str
    role: str
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    description: str | None = None
    bullets: list[str] = []

class Award(PydanticBase):
    award_name: str
    issuer: str | None = None
    end_date: date | None = None
    description: str | None = None

class ParsedResume(PydanticBase):
    education: list[Education] = []
    experience: list[Experience] = []
    skills: list[Skill] = []
    projects: list[Project] = []
    certifications: list[Certification] = []
    activities: list[Activity] = []
    awards: list[Award] = []


class EntrySection(enum.StrEnum):
    '''
    where an Experience Bank entry goes on a resume. Not a Postgres enum:
    experience_entries.section is text with a CHECK listing these, so a new
    one is a one-line migration with no coordinated deploy (KAN-176)
    '''
    education = "education"
    experience = "experience"
    project = "project"
    activity = "activity"
    award = "award"
    certification = "certification"


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
    employment type of a job posting
    '''
    full_time= "full_time"
    part_time= "part_time"
    contract= "contract"

class experience_level(enum.StrEnum):
    internship= "internship"
    new_grad= "new_grad"
    other= "other"

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

class role_key(enum.StrEnum):
    '''
    the keys job_postings.roles holds (KAN-172): a scraped role's categories,
    then their specialties, as the scraper reads them from its title
    (scraper/workit_scraper/shortlist.py, Tag). Not a Postgres enum: roles is
    text[], so a new key is a change here and in the scraper, never a
    migration, and member names need not match values ("/" is not allowed in a
    name). GET /jobs?role= and the feed's roles are checked against it
    '''
    software= "software"
    data_ai= "data_ai"
    hardware= "hardware"
    quant= "quant"
    product= "product"
    # civil, mechanical, manufacturing, aerospace and every other engineering
    # degree outside software and hardware
    engineering= "engineering"
    business= "business"
    finance= "finance"
    marketing= "marketing"
    sales= "sales"
    hr= "hr"
    design= "design"
    # Specialties, each under one category
    software_security= "software/security"
    data_ai_ml= "data_ai/ml"
    data_ai_data_science= "data_ai/data_science"
    data_ai_analytics= "data_ai/analytics"
    data_ai_data_engineering= "data_ai/data_engineering"
    engineering_civil= "engineering/civil"
    engineering_mechanical= "engineering/mechanical"
    engineering_manufacturing= "engineering/manufacturing"
    engineering_aerospace= "engineering/aerospace"

class role_category(enum.StrEnum):
    '''
    which discipline a scraped role is in, read from its title by the scraper
    (scraper/workit_scraper/shortlist.py): the SimplifyJobs lists' five. NULL
    for a company's own job. Superseded by role_key and job_postings.roles
    (KAN-172); the import still writes it, the first role when it is one of
    these five, until a later migration drops the column
    '''
    software= "software"
    # data science, AI and machine learning
    data_ai= "data_ai"
    product= "product"
    # quantitative research, trading and development
    quant= "quant"
    hardware= "hardware"

class job_post_status(enum.StrEnum):
    '''
    lifecycle status of a job posting
    '''
    draft= "draft"
    published= "published"
    # added by 1ea834081a48; ALTER TYPE, not an edit here, is what changes the column
    paused= "paused"
    closed= "closed"
