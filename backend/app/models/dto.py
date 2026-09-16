'''
file that holds data objects, such as key words, enums, tec.
'''
import enum
from datetime import date
from typing import Optional

from pydantic import BaseModel as PydanticBase


# --- Resume enums ---

class ResumeStatus(str, enum.Enum):
    uploaded="uploaded"
    parsed="parsed"
    parse_failed="parse_failed"


# --- Pydantic schemas for parsed_json structure ---

class Education(PydanticBase):
    institution: str
    degree: Optional[str] = None
    field_of_study: Optional[str] = None
    gpa: Optional[float] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    description: Optional[str] = None

class Experience(PydanticBase):
    company_name: str
    title: str
    location: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    description: Optional[str] = None

class Skill(PydanticBase):
    skill_name: str
    category: Optional[str] = None

class Project(PydanticBase):
    project_name: str
    url: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    description: Optional[str] = None

class Certification(PydanticBase):
    cert_name: str
    issuer: Optional[str] = None

class ParsedResume(PydanticBase):
    education: list[Education] = []
    experience: list[Experience] = []
    skills: list[Skill] = []
    projects: list[Project] = []
    certifications: list[Certification] = []


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
