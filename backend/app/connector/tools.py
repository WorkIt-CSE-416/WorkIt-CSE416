"""
The connector's tools and its prompt (KAN-377), the student's Claude's
whole view of WorkIt (auto-apply/architecture.md, 14.6):

- `get_next_application` (read-only): the oldest open application with a
  question still unanswered: only its job posting, its unanswered
  questions (in words, or a one-off choice with its options, KAN-369),
  and the student's experience bank. A job id of null when
  nothing is left, or when this chat has had its share of applications
  (KAN-381, below).
- `get_research_task` and `save_company_brief`: the shared company
  briefs (KAN-382), in app/connector/briefs.py; get_next_application hands
  the application's company brief with it. While that company still needs
  research (briefs.needs_research), an application with a question in
  words is held back: get_next_application names the company in
  `research_first` instead, as Apply builds the brief before its essays.
  One with only choices goes out (they need no company facts).
- `save_answers` (a write): saves answers to that application's
  questions, all or none; the open batch tab fills each one. Each written
  answer carries its review (the rating and the claims the claim check
  cut, KAN-369), kept with it. Each answer
  may name the company brief fact it uses (`named_fact`), which must be one
  of the brief's, for the Written Answers page to show with it.
- `get_writing_samples` and `save_style_card` (app/connector/style.py,
  KAN-384): the student's writing samples, and the style card their Claude
  builds from them, which get_next_application then gives (`style_card`,
  and `style_card_needed` when samples have no card yet).
- `get_review_task` (read-only) and `save_review` (KAN-369, in
  app/auto_apply/review.py): once an application's written questions are
  all answered, its answers for a re-read before the student submits; the
  ones reported wrong show in its batch tab as needing the student.
- The prompt "Write my WorkIt answers" (app/connector/prompt.py): how to
  write them. The writing rules live there and only there: a tool's
  description says what the tool does, never how Claude should behave
  (Anthropic's connector review refuses that).

Each tool is layer 3 (architecture.md, 5): it finds the student from the
connector token, calls one layer-2 step in app/auto_apply/pipeline.py, and
names nothing but ids and plain data. WorkIt calls no model here.

A chat (KAN-381). The server is stateless and Claude sends nothing that
names a chat, so the chat carries its own count: each get_next_application
answers a `chat` value, the job ids this chat was given, and the chat
passes it back on its next call. A call without one starts a new chat.
After `connector_chat_cap` applications the chat is told to start a new one
(a long chat's later answers get less of Claude's attention), and a new
chat starts at the oldest application still unanswered, which is also how
a batch resumes after a Claude usage limit. A chat is never given the same
application twice, so one whose question Claude left out (no fact for it)
can't hold the chat. The value is not signed: all it guards is the
student's own answer quality, and a value that isn't one starts a new chat.
"""

import uuid

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import BaseModel, Field

from app.auto_apply import briefs, pipeline
from app.config import get_settings
from app.connector import account
from app.connector.prompt import PROMPT, TITLE
from app.db import get_sessionmaker
from app.queries import writing
from app.schemas.applications import ANSWER_MAX
from app.services.essay_answer import bank_context


class Question(BaseModel):
    name: str = Field(description="The form field's name; save its answer under this name.")
    question: str
    required: bool
    max_length: int | None = Field(description="The form's limit in characters, if it has one.")
    kind: str = Field(
        default="text",
        description='"text": answered in words. "choice": one of options. "choices": one or more of options, '
        'joined by "; ".',
    )
    options: list[str] | None = Field(default=None, description="A choice's options, as the form words them.")


class NextApplication(BaseModel):
    job_id: str | None = Field(
        description="Null when no application has a question left, when start_new_chat is true, "
        "or when research_first names a company."
    )
    chat: str = Field(default="", description="Pass this to the next get_next_application call in this chat.")
    start_new_chat: bool = Field(
        default=False, description="True when this chat has written its share of applications."
    )
    message: str | None = Field(default=None, description="For the student, when start_new_chat is true.")
    research_first: str | None = Field(
        default=None,
        description="The next application's company, when it has no current brief (get_research_task): the "
        "application is given once its brief is saved, or once a save for it has failed.",
    )
    company: str | None = None
    title: str | None = None
    posting: str | None = Field(default=None, description="The job posting's description.")
    questions: list[Question] = []
    experience: str = Field(default="", description="The student's experience bank: each entry and its bullets.")
    skills: list[str] = []
    company_brief: list[dict] = Field(
        default=[],
        description="Facts about the company, each with its category, page url, the page's date and, for a team, "
        "its name. Web text checked against its page; [] when WorkIt has no brief for the company.",
    )
    style_card: str | None = Field(
        default=None, description="How the student writes, from their writing samples (KAN-384); null when none is saved."
    )
    style_card_needed: bool = Field(
        default=False, description="True when the student has writing samples and no style card built from them."
    )


class Review(BaseModel):
    rating: int = Field(ge=1, le=10, description="The last rating the review gave the answer, from 1 to 10.")
    unsupported: list[str] = Field(
        description="Each claim the claim check found the sources don't support, quoted, which the edit cut; "
        "[] when it found none."
    )


class Answer(BaseModel):
    name: str = Field(description="The question's name, from get_next_application.")
    answer: str = Field(max_length=ANSWER_MAX)
    review: Review | None = Field(
        default=None, description='Required for a question of kind "text"; none for a choice.'
    )
    named_fact: str | None = Field(default=None, max_length=400, description=(
        "The company_brief fact the answer uses, copied as get_next_application gave it, so the student "
        "can read up on it; leave it out when the answer uses none."))


class Saved(BaseModel):
    saved: int
    left: int = Field(description="How many of the application's questions are still unanswered.")
    read_first: list[str] = Field(default_factory=list, description=(
        "The saved answers (question names) the student should read before Submit: about this company, "
        "or about what isn't on their resume."))


class ReviewAnswer(BaseModel):
    name: str
    question: str
    answer: str
    own: bool = Field(description="True when the answer is the student's own words, not their Claude's.")
    options: list[str] | None = Field(default=None, description="A choice's options, as the form words them.")


class ReviewTask(BaseModel):
    job_id: str | None = Field(description="Null when no application's answers are waiting for a review.")
    company: str | None = None
    title: str | None = None
    posting: str | None = Field(default=None, description="The job posting's description.")
    answers: list[ReviewAnswer] = []
    experience: str = Field(default="", description="The student's experience bank: each entry and its bullets.")
    skills: list[str] = []
    company_brief: list[dict] = Field(default=[], description="WorkIt's checked facts about the company.")


class Problem(BaseModel):
    name: str = Field(description="The question's name, from get_review_task.")
    reason: str = Field(min_length=1, max_length=500, description="What is wrong with the answer, for the student.")


class Reviewed(BaseModel):
    flagged: int = Field(description="How many answers the student's tab now shows as needing them.")


def _handed(chat: str) -> list[uuid.UUID]:
    """The job ids a chat value names; none for a value that isn't one."""
    try:
        return [uuid.UUID(job) for job in chat.split(",")] if chat else []
    except ValueError:
        return []


def register(server: MCPServer) -> None:
    @server.tool(
        title="Get the next application",
        description=(
            "The next WorkIt job application with written questions still unanswered: its company, "
            "title, job posting, questions, and the student's experience and skills. "
            "job_id is null when none is left. A chat writes a few applications: after that, "
            "start_new_chat is true and no application is given."
        ),
        annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False),
    )
    async def get_next_application(
        chat: str = Field(
            default="",
            description="The chat value this chat's last get_next_application call gave; empty in a new chat.",
        ),
    ) -> NextApplication:
        handed = _handed(chat)
        async with get_sessionmaker()() as db:
            student = await account.current_student(db)
            found = await pipeline.next_to_write(db, student.id, skip=handed)
            brief = await briefs.brief_for(db, found.application.job.company, found.application.job.id) if found else []
            research = found is not None and any((q.kind or "text") == "text" for q in found.questions) \
                and await briefs.needs_research(db, found.application.job.company)
            card, card_needed = await writing.card_state(db, student.id)
        if found is None:
            return NextApplication(job_id=None, chat=chat)
        cap = get_settings().connector_chat_cap
        if len(handed) >= cap:
            return NextApplication(
                job_id=None,
                chat=chat,
                start_new_chat=True,
                message=(
                    f"This chat has written {cap} applications. Start a new chat and run "
                    f'"{TITLE}" again: it picks up at the next application.'
                ),
            )
        job = found.application.job
        if research:
            return NextApplication(job_id=None, chat=chat, research_first=job.company)
        experience, skills = bank_context(found.bank)
        return NextApplication(
            job_id=str(job.id),
            chat=",".join(str(j) for j in [*handed, job.id]),
            company=job.company,
            title=job.title,
            posting=found.posting,
            questions=[
                Question(
                    name=q.name, question=q.label, required=q.required, max_length=q.max_length,
                    kind=q.kind or "text", options=q.options,
                )
                for q in found.questions
            ],
            experience=experience,
            skills=skills,
            company_brief=brief,
            style_card=card,
            style_card_needed=card_needed,
        )

    @server.tool(
        title="Save answers",
        description=(
            "Saves answers to one WorkIt job application's written questions, all or none, and fills "
            "them into the application's open tab in the student's browser. Refuses an answer to a "
            "question the application doesn't have, an empty one, or one that fails WorkIt's checks (over the question's "
            "max_length among them), with every reason. A written answer is saved with its review, and refused "
            "without one, rated under 8, or still holding a claim it lists as unsupported."
        ),
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False),
    )
    async def save_answers(job_id: str, answers: list[Answer]) -> Saved:
        try:
            job = uuid.UUID(job_id)
        except ValueError as exc:
            raise ToolError("job_id is not one get_next_application gave.") from exc
        async with get_sessionmaker()() as db:
            student = await account.current_student(db)
            try:
                left = await pipeline.save_answers(
                    db, student.id, job, {a.name: a.answer for a in answers},
                    reviews={a.name: pipeline.Review(a.review.rating, a.review.unsupported) for a in answers if a.review},
                    named={a.name: a.named_fact for a in answers if a.named_fact},
                )
                first = await pipeline.read_first(db, student.id, job, [a.name for a in answers])
            except pipeline.NotFound as exc:
                raise ToolError("No such application. Use the job_id get_next_application gave.") from exc
            except (pipeline.WrongStage, pipeline.Refused) as exc:
                raise ToolError(str(exc)) from exc
        return Saved(saved=len(answers), left=left, read_first=first)

    @server.tool(
        title="Get a review task",
        description=(
            "The next WorkIt job application whose written questions are all answered and whose answers "
            "have not been reviewed as they stand: its company, title, job posting, each question with its "
            "saved answer, the student's experience and skills, and the company brief. job_id is null when "
            "none is waiting."
        ),
        annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False),
    )
    async def get_review_task() -> ReviewTask:
        async with get_sessionmaker()() as db:
            student = await account.current_student(db)
            found = await pipeline.next_to_review(db, student.id)
            brief = await briefs.brief_for(db, found.application.job.company, found.application.job.id) if found else []
        if found is None:
            return ReviewTask(job_id=None)
        experience, skills = bank_context(found.bank)
        job = found.application.job
        return ReviewTask(
            job_id=str(job.id),
            company=job.company,
            title=job.title,
            posting=found.posting,
            answers=[
                ReviewAnswer(name=a.name, question=a.label, answer=a.answer, own=own, options=a.options)
                for a, own in found.answers
            ],
            experience=experience,
            skills=skills,
            company_brief=brief,
        )

    @server.tool(
        title="Save review",
        description=(
            "Saves the review of one WorkIt application's answers as they stand: each answer found wrong, "
            "with the reason, or none. The application's open tab in the student's browser shows each one "
            "as needing the student, with the reason. Replaces an earlier review of the application."
        ),
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False),
    )
    async def save_review(job_id: str, problems: list[Problem]) -> Reviewed:
        try:
            job = uuid.UUID(job_id)
        except ValueError as exc:
            raise ToolError("job_id is not one get_review_task gave.") from exc
        async with get_sessionmaker()() as db:
            student = await account.current_student(db)
            try:
                flagged = await pipeline.save_review(db, student.id, job, {p.name: p.reason for p in problems})
            except pipeline.NotFound as exc:
                raise ToolError("No such application. Use the job_id get_review_task gave.") from exc
            except (pipeline.WrongStage, pipeline.Refused) as exc:
                raise ToolError(str(exc)) from exc
        return Reviewed(flagged=flagged)

    @server.prompt(name="write_my_workit_answers", title=TITLE,
                   description="Writes the answers to your WorkIt applications' written questions.")
    def write_my_workit_answers() -> str:
        return PROMPT
