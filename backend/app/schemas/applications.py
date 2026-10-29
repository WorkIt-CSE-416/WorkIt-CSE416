import datetime
import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.models.dto import application_stage
from app.schemas.jobs import Highlight, JobListing
from app.schemas.sent_resume import SentResumeResponse


class JobApplied(BaseModel):
    """GET and POST /jobs/{job_id}/applied: when the signed-in applicant marked
    this job as applied, or null when they haven't, and the sent resume the
    application names (KAN-267), or null."""

    applied_at: datetime.datetime | None
    sent_resume_id: uuid.UUID | None = None


class MarkApplied(BaseModel):
    """POST /jobs/{job_id}/applied's optional body: the sent resume the
    application went out with, or null for none. Leaving the key out keeps
    the one it names (the route reads `model_fields_set`)."""

    sent_resume_id: uuid.UUID | None = None


class SaveByLink(BaseModel):
    """POST /jobs/saved-by-link: the page the student is on (KAN-401)."""

    url: str = Field(max_length=2048)


class JobSavedByLink(BaseModel):
    """POST /jobs/saved-by-link: the job the link is, and its stage after the save."""

    job_id: uuid.UUID
    stage: application_stage


class JobByLink(BaseModel):
    """POST /jobs/listed-by-link: the listed job the link is, and the signed-in
    applicant's stage for it, or null when they have no application (KAN-424)."""

    job_id: uuid.UUID
    stage: application_stage | None = None


class JobSaved(BaseModel):
    """POST /jobs/{job_id}/saved: the job's stage after the save. saved, or
    the stage it already had (queued, applied...), which saving keeps."""

    stage: application_stage


# --- Auto apply (routers/auto_apply.py) ---


class ChooseResume(BaseModel):
    """PUT .../applications/{job_id}/resume: the resume one queued application
    goes out with (KAN-359), exactly one of a built or an uploaded resume."""

    built_resume_id: uuid.UUID | None = None
    uploaded_resume_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> "ChooseResume":
        if (self.built_resume_id is None) == (self.uploaded_resume_id is None):
            raise ValueError("Name exactly one of built_resume_id or uploaded_resume_id.")
        return self


class Application(BaseModel):
    """One job in the applicant's auto apply list: the job posting as the Jobs
    page's card has it, and where its application stands."""

    job: JobListing
    stage: application_stage
    # When it was queued (or marked applied): the queue's order.
    added_at: datetime.datetime
    applied_at: datetime.datetime | None
    # The student's own day to apply by (KAN-429), the Calendar's Apply by;
    # null while none is set.
    apply_by: datetime.date | None = None
    # When the job posting stops taking applications, where it says
    # (KAN-429, the Calendar's Application Closes): a company's own job sets
    # it; a scraped one rarely publishes one.
    closes_at: datetime.datetime | None = None
    # The sent resume it went out with (KAN-267): job_applications'
    # `sent_resume_id`, null when none was sent or it was since deleted.
    sent_resume: SentResumeResponse | None = None
    # False once the job posting has closed: the extension skips it.
    open: bool
    # The Jobs page's match score (0-100) for this job posting, on ?scored=true
    # only (KAN-256). Null otherwise, for a closed job posting, and while the
    # experience bank is empty.
    match: int | None = None
    # Up to 3 reasons behind `match`, as the Jobs page card lists them; empty
    # whenever `match` is null.
    highlights: list[Highlight] = []


class BatchRequest(BaseModel):
    """POST .../auto-apply/batches: how many matches to queue."""

    size: int = Field(10, ge=1, le=50)


class BatchQueued(BaseModel):
    """The job ids the batch queued, best match first. Fewer than asked when
    fewer matches are left."""

    queued: list[str]


class QueueRequest(BaseModel):
    """POST .../applications: one job posting to queue."""

    job_id: uuid.UUID


class FinishRequest(BaseModel):
    """POST .../applications/{job_id}/finish: how the fill ended. submitted:
    the student clicked Submitted. skipped: Skip, or the tab was closed.
    failed: the form could not be filled (no form, sign-in needed).
    closed: a batch tab found the job system saying the job is closed: the
    application is skipped and its posting marked closed (KAN-369).
    unsubmitted: the panel's "I didn't submit this", for a submit marked by
    mistake (KAN-401): an applied application goes back to the stage its
    batch tab had before, which `state` names in PUT .../fill's words (ready:
    queued; needs_you). No state is needs_you: a queued application is the
    batch's next fill, so only a tab the extension says was Ready goes back
    there. `state` is unsubmitted's only (422 with any other outcome)."""

    outcome: Literal["submitted", "skipped", "failed", "closed", "unsubmitted"]
    state: Literal["ready", "needs_you"] | None = None

    @model_validator(mode="after")
    def _state_only_when_unsubmitted(self) -> "FinishRequest":
        if self.state is not None and self.outcome != "unsubmitted":
            raise ValueError("state goes with the unsubmitted outcome only")
        return self


class FillRequest(BaseModel):
    """PUT .../applications/{job_id}/fill: how a batch tab's fill left the
    form (KAN-370). ready: every field it needs is filled. needs_you:
    something is unfilled, or the hiring system has no filler."""

    model_config = ConfigDict(extra="forbid")

    state: Literal["ready", "needs_you"]


# The longest question label and answer kept: Workable's cover letter takes
# 200000 characters, but no essay question a student writes is near this.
LABEL_MAX = 2000
ANSWER_MAX = 10000


# A choice's options: a long list (a country, a school) is never a one-off
# question nothing else fills, so this many is plenty.
OPTIONS_MAX = 300
OPTION_MAX = 500


# The most of a question's help text the tab sends (KAN-369): the extension cuts it there.
DESCRIPTION_MAX = 1000


class WrittenQuestion(BaseModel):
    """One question a batch tab's form needs answered by the student's
    Claude (KAN-377): the form field's `name` the answer fills, its label,
    the form's own limit, and the help text the form shows under the label
    (`description`, KAN-369: "3-4 sentences", "250 words max"). A one-off choice nothing else fills (KAN-369)
    has `kind` "choice" (one of `options`) or "choices" (one or more) and
    its options as the form words them; a question written in words has
    neither."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    label: str = Field(min_length=1, max_length=LABEL_MAX)
    required: bool
    max_length: int | None = Field(default=None, ge=1)
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX)
    kind: Literal["choice", "choices"] | None = None
    options: list[Annotated[str, StringConstraints(min_length=1, max_length=OPTION_MAX)]] | None = Field(
        default=None, min_length=1, max_length=OPTIONS_MAX,
    )

    @model_validator(mode="after")
    def _choice_has_options(self) -> "WrittenQuestion":
        if (self.kind is None) != (self.options is None):
            raise ValueError("A choice question needs its options, and a written one has none.")
        return self


class WrittenQuestions(BaseModel):
    """PUT .../applications/{job_id}/questions: the tab's questions that
    need writing. At most 50: no form asks more."""

    model_config = ConfigDict(extra="forbid")

    questions: list[WrittenQuestion] = Field(max_length=50)


class WrittenAnswer(WrittenQuestion):
    """A question and the answer saved for it, or null while none is.
    GET .../questions also says whether the student's Claude's pre-submit
    review read this answer (`reviewed`; always true for the student's own
    words, which it doesn't hold up) and, when it found it wrong, why
    (`flag`): the tab shows that as needing the student (KAN-369), with the
    sentence it means (`flag_quote`) and whether it names the wrong company
    (`flag_hard`). While the student's Claude waits on a fact only the
    student can give (KAN-369, a Missing fact), `ask` is its question
    ("Essay fact: ...") and `ask_about` the experience entry the student's
    answer is saved under."""

    answer: str | None
    reviewed: bool = False
    flag: str | None = None
    flag_quote: str | None = None
    flag_hard: bool = False
    ask: str | None = None
    ask_about: str | None = None


class FlagAnswer(BaseModel):
    """POST .../review/keep and .../review/rewrite: the flagged answer the
    student keeps, or sends back to their Claude (KAN-369)."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)


class OwnAnswer(BaseModel):
    """PUT .../applications/{job_id}/answers: the student's words in a batch
    tab's field for a question it needs written (KAN-379): the field's
    `name`, the question's wording, their answer, and whether it is `own`:
    true when they wrote into a field WorkIt didn't fill, or replaced what
    it filled; false for an edit of an answer WorkIt filled (their Claude's,
    or a saved one), which stays that answer's, checked as their Claude's."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    label: str = Field(min_length=1, max_length=LABEL_MAX)
    answer: str = Field(min_length=1, max_length=ANSWER_MAX)
    own: bool


class SavedAnswer(BaseModel):
    """An answer saved on another application, as the Fill engine's Answer
    bank takes it (KAN-379): `own` when the words are the student's, false
    for their Claude's. One brought from Apply may be a choice's options
    ticked, a list."""

    answer: str | list[str]
    own: bool


class ApplicationStage(BaseModel):
    """Where one job's application stands after a write."""

    job_id: uuid.UUID
    stage: application_stage


# --- Written Answers without Claude (routers/pasted_answers.py, KAN-385) ---


class PostingQuestions(BaseModel):
    """One open application's questions still unanswered, under its job
    posting, as the Written Answers page lists them."""

    job_id: uuid.UUID
    company: str | None
    title: str | None
    questions: list[WrittenAnswer]


class NamedFact(BaseModel):
    """The company brief fact an answer uses (KAN-369): its sentence and
    the page that states it, as the brief had them when the answer was
    saved."""

    fact: str
    url: str


class AnsweredQuestion(BaseModel):
    """A written question and the answer saved for it, with the brief fact
    it names, if any, as the Written Answers page shows it. `answered_at`:
    when it was last saved, which the page marks the student's own answers
    New by until they have seen them (KAN-369)."""

    name: str
    label: str
    answer: str
    own: bool
    named_fact: NamedFact | None
    answered_at: datetime.datetime | None


class PostingAnswers(BaseModel):
    """One application's answered written questions, under its job
    posting, in the form's order."""

    job_id: uuid.UUID
    company: str | None
    title: str | None
    questions: list[AnsweredQuestion]


class PastedAnswer(BaseModel):
    """An answer the student pasted for one question, by its `name`."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    answer: str = Field(max_length=ANSWER_MAX)


class PastedAnswers(BaseModel):
    """PUT .../applications/{job_id}/written-answers: the answers to save,
    all or none."""

    model_config = ConfigDict(extra="forbid")

    answers: list[PastedAnswer] = Field(min_length=1, max_length=50)


class FactAnswer(BaseModel):
    """PUT .../applications/{job_id}/essay-facts: the student's answer to
    the fact their Claude asked for one question (KAN-369), saved as a
    bullet of the experience entry it was about."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    answer: str = Field(min_length=1, max_length=500)


class SavedFact(BaseModel):
    """Where the student's answer to an Essay fact went: the experience
    entry (its heading) and the bullet's text."""

    entry: str
    bullet: str


class SavedAnswers(BaseModel):
    """How many answers were saved, and how many of the application's
    questions are still unanswered."""

    saved: int
    left: int
