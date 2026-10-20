"""
A student's answers to the questions hiring systems repeat, for GET and PATCH
/applicants/{applicant_id}/autofill-answers (routers/autofill_answers.py).

Each field is a stable question key, and each value an option key, never the
words a screen shows: the screen (frontend onboarding/applicant/answers.ts)
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


# The question each key answers, as forms ask it: stored beside the answer
# (models/autofill_answers.py), so the bank still reads on its own if a key's
# meaning is ever in doubt. Server-side, so the browser can't write its own.
QUESTIONS: dict[str, str] = {
    "work_authorized_us": "Are you legally authorized to work in the United States?",
    "needs_sponsorship": (
        "Will you now or in the future require sponsorship for employment visa status"
        " (e.g., H-1B visa status)?"
    ),
    "work_authorization_status": "What is your current U.S. citizenship or visa status?",
    "security_clearance": (
        "Do you hold an active U.S. government security clearance? If so, at what level?"
    ),
    "gender": "Voluntary self-identification: what is your gender?",
    "veteran_status": "Voluntary self-identification: are you a protected veteran?",
    "disability_status": (
        "Voluntary self-identification of disability (Form CC-305):"
        " do you have a disability, or have you had one in the past?"
    ),
}

assert QUESTIONS.keys() == AutofillAnswers.model_fields.keys()


def answers_from_bank(bank: dict) -> AutofillAnswers:
    """The stored bank as the API's shape. A key this version doesn't know, or
    an option it no longer offers, reads as unanswered rather than failing
    the read: the bank outlives any one version of the questions."""
    values = {}
    for key, field in AutofillAnswers.model_fields.items():
        # Each entry checked by shape: a bare value or a list would crash
        # .get() or the set lookup, and fail the student's every read.
        entry = bank.get(key)
        answer = entry.get("answer") if isinstance(entry, dict) else None
        allowed = {v for arg in get_args(field.annotation) for v in get_args(arg)}
        if isinstance(answer, str) and answer in allowed:
            values[key] = answer
    return AutofillAnswers(**values)
