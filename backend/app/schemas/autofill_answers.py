"""
A student's answers to the questions hiring systems repeat, for GET and PATCH
/applicants/{applicant_id}/autofill-answers (routers/autofill_answers.py).

Each field is a stable question key, and each value an option key, never the
words a screen shows: the screens' list (frontend lib/autofill-answers.ts)
holds the labels, and the extension maps a key to whatever a form's option
says. None is unanswered. The options follow real application forms:

- Work authorization and sponsorship: the two yes/no questions Greenhouse,
  Lever, Ashby and Workday all ask, in their usual words.
- Citizenship and visa status: what a form asks after "authorized to work",
  and what export-controlled and cleared roles ask for.
- Security clearance: the U.S. levels, Public Trust to TS/SCI.
- Gender: the EEO self-identification's Male, Female and decline, which
  every U.S. form offers, plus Non-Binary, which many now add. A form
  without it gets no answer filled in, never a guess.
- Hispanic or Latino, then race: the EEO self-identification's two
  questions, in that order, as Greenhouse, Lever and Workday ask them. Race
  takes one of the EEO-1 categories, Two or More Races included; Hispanic
  or Latino is its own question, never a race (KAN-299).
- Veteran status: the three answers of the VEVRAA self-identification on
  U.S. forms, plus "never served" (not_veteran), which also answers "have
  you ever served?" and its branch and status; "not a protected veteran"
  says nothing of service.
- Disability: the three answers of the OFCCP's Form CC-305, worded as the
  form words them.

Gender, Hispanic or Latino, race, veteran and disability are voluntary, so
each has a "declined" answer, which is an answer to fill in, unlike None.

The Application answers (My Profile's section of that name, KAN-369) are the
facts screening questions ask: on-site and full-time availability, the start
window (dates as YYYY-MM-DD, terms as "summer 2027"), relocation and where
the student would work, street address and postal code, languages, and the
screener facts. A screener fact is always the student's own answer, never a
default: an empty list ("relatives_at": []) is their "none", unlike None.
Then age 18 or over, pay (an expected hourly figure and whether a posting's
stated range is fine: the student's own, never a WorkIt default), the EEO
extras (sexual orientation, transgender, pronouns, communities, each with a
decline answer; communities [] is "none of these", ["declined"] a decline),
the kinds of work they want (role interests) and an X profile link.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter, ValidationError

YesNo = Literal["yes", "no"]
WorkAuthorizationStatus = Literal[
    "us_citizen", "permanent_resident", "f1_student", "h1b", "other_visa", "asylee_refugee"
]
SecurityClearance = Literal[
    "none", "public_trust", "confidential", "secret", "top_secret", "ts_sci"
]
Gender = Literal["male", "female", "non_binary", "declined"]
HispanicLatino = Literal["yes", "no", "declined"]
Race = Literal[
    "american_indian_alaska_native",
    "asian",
    "black_african_american",
    "native_hawaiian_pacific_islander",
    "white",
    "two_or_more",
    "declined",
]
VeteranStatus = Literal["protected_veteran", "not_protected_veteran", "not_veteran", "declined"]
SexualOrientation = Literal[
    "heterosexual", "gay", "lesbian", "bisexual", "asexual", "queer", "declined"
]
Pronouns = Literal["he_him", "she_her", "they_them", "declined"]
Community = Literal[
    "disability", "neurodiverse", "veteran", "parent", "refugee_immigrant",
    "first_generation", "lgbtq", "declined",
]
RoleInterest = Literal[
    "backend", "frontend", "full_stack", "mobile", "embedded", "ml",
    "data", "infrastructure", "security", "robotics",
]
HourlyPay = Annotated[float, Field(gt=0, lt=1000)]
DisabilityStatus = Literal["yes", "no", "declined"]
Day = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$")]
Term = Annotated[str, StringConstraints(pattern=r"^(spring|summer|fall|winter) \d{4}$")]
Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class AutofillAnswers(BaseModel):
    """The whole bank on GET; on PATCH, only the keys sent are written, and a
    key sent as null is cleared."""

    model_config = ConfigDict(extra="forbid")

    work_authorized_us: YesNo | None = None
    needs_sponsorship: YesNo | None = None
    work_authorization_status: WorkAuthorizationStatus | None = None
    security_clearance: SecurityClearance | None = None
    gender: Gender | None = None
    hispanic_latino: HispanicLatino | None = None
    race: Race | None = None
    veteran_status: VeteranStatus | None = None
    disability_status: DisabilityStatus | None = None

    # Application answers: availability
    onsite_ok: YesNo | None = None
    full_time_40h: YesNo | None = None
    # the start window
    earliest_start: Day | None = None
    latest_end: Day | None = None
    available_terms: list[Term] | None = None
    # relocation and where they would work, ranked
    willing_to_relocate: YesNo | None = None
    location_preferences: list[Short] | None = None
    internship_location: Short | None = None
    # address (the city and state are the profile's location)
    address_line1: Short | None = None
    postal_code: Short | None = None
    # the languages they speak and write fluently, English among them
    languages: list[Short] | None = None
    # screener facts: the companies where a relative works or an employee
    # referred them, and where they hold an offer ([] = none)
    relatives_at: list[Short] | None = None
    relative_public_official: YesNo | None = None
    referred_at: list[Short] | None = None
    prior_government_work: YesNo | None = None
    non_compete: YesNo | None = None
    pending_offers: list[Short] | None = None
    # age, pay (dollars an hour), the EEO extras, interests and an X link
    age_18_or_over: YesNo | None = None
    expected_hourly_pay: HourlyPay | None = None
    accept_posted_pay: YesNo | None = None
    sexual_orientation: SexualOrientation | None = None
    transgender: Literal["yes", "no", "declined"] | None = None
    pronouns: Pronouns | None = None
    communities: list[Community] | None = None
    role_interests: list[RoleInterest] | None = None
    x_url: Short | None = None


def answers_from_bank(bank: dict) -> AutofillAnswers:
    """The stored bank as the API's shape. The bank maps each key to its
    answer alone ({"gender": "male"}). A key this version doesn't know, an
    option it no longer offers, or a value of another shape reads as
    unanswered rather than failing the read: the bank outlives any one
    version of the questions."""
    values = {}
    for key, answer in bank.items():
        if key in _READERS and answer is not None:
            # Checked by shape, a key alone: one bad entry never fails the
            # student's every read.
            try:
                values[key] = _READERS[key].validate_python(answer, strict=True)
            except ValidationError:
                pass
    return AutofillAnswers(**values)


_READERS = {key: TypeAdapter(field.annotation) for key, field in AutofillAnswers.model_fields.items()}
