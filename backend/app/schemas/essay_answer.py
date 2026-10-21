"""Request/response shapes for POST /applicants/{id}/essay-answer (KAN-164's
autofiller extension), a generated answer to one open-ended application
question ("Why do you want to work here?"), grounded in the experience bank.

Nothing here is stored: the extension reads a question's text straight off
the ATS page's own DOM, so there is no fixed key for it the way
autofill_answers.py's seven questions have one each. See app/models/CLAUDE.md,
"autofill_answers", for why that table's design already anticipates this and
why persisting a company's own question is a later step, not this one.
"""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# A field's own label/question text, as read off the page — never this
# long in practice, but capped so a malformed page can't hand the model an
# unbounded prompt.
Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class EssayAnswerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: Question
    # Read from the ATS page itself (e.g. Greenhouse's page title), not
    # looked up against job_postings — the posting may not even be one
    # WorkIt has scraped or the company has posted here.
    company_name: ShortText | None = None
    job_title: ShortText | None = None
    # The field's own HTML maxlength, if the page sets one, so the model
    # writes to the space actually available rather than something that
    # gets silently truncated on fill.
    max_length: int | None = Field(default=None, ge=50, le=5000)


class EssayAnswerResponse(BaseModel):
    answer: str
    uses_left: int


class EssayAnswerReading(BaseModel):
    """The model's reply. Code checks it against the truth rule before it
    ever reaches the student (services/essay_answer.py's `generate`) — this
    schema only shapes the JSON, it enforces nothing."""

    answer: str
