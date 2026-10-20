"""
A student's answers to the questions hiring systems repeat, for GET and PATCH
/applicants/{applicant_id}/autofill-answers (routers/autofill_answers.py).

Each field is a stable question key, and each value an option key, never the
words a screen shows: the screens (frontend lib/autofill-answers.ts)
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
- Veteran status: the three answers of the VEVRAA self-identification on
  U.S. forms.
- Disability: the three answers of the OFCCP's Form CC-305, worded as the
  form words them.

Gender, veteran and disability are voluntary, so each has a "declined"
answer, which is an answer to fill in, unlike None.
"""

from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict

YesNo = Literal["yes", "no"]
WorkAuthorizationStatus = Literal[
    "us_citizen", "permanent_resident", "f1_student", "h1b", "other_visa", "asylee_refugee"
]
SecurityClearance = Literal[
    "none", "public_trust", "confidential", "secret", "top_secret", "ts_sci"
]
Gender = Literal["male", "female", "non_binary", "declined"]
VeteranStatus = Literal["protected_veteran", "not_protected_veteran", "declined"]
DisabilityStatus = Literal["yes", "no", "declined"]


class AutofillAnswers(BaseModel):
    """The whole bank on GET; on PATCH, only the keys sent are written, and a
    key sent as null is cleared."""

    model_config = ConfigDict(extra="forbid")

    work_authorized_us: YesNo | None = None
    needs_sponsorship: YesNo | None = None
    work_authorization_status: WorkAuthorizationStatus | None = None
    security_clearance: SecurityClearance | None = None
    gender: Gender | None = None
    veteran_status: VeteranStatus | None = None
    disability_status: DisabilityStatus | None = None


def answers_from_bank(bank: dict) -> AutofillAnswers:
    """The stored bank as the API's shape. The bank maps each key to its
    answer alone ({"gender": "male"}). A key this version doesn't know, an
    option it no longer offers, or a value of another shape reads as
    unanswered rather than failing the read: the bank outlives any one
    version of the questions."""
    values = {}
    for key, field in AutofillAnswers.model_fields.items():
        # Checked by shape: a list or an object would fail the set lookup,
        # and with it the student's every read.
        answer = bank.get(key)
        allowed = {v for arg in get_args(field.annotation) for v in get_args(arg)}
        if isinstance(answer, str) and answer in allowed:
            values[key] = answer
    return AutofillAnswers(**values)
