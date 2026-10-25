"""
The connector's tools and its prompt (KAN-377), the student's Claude's
whole view of WorkIt (auto-apply/architecture.md, 14.6):

- `get_next_application` (read-only): the oldest open application with a
  question still unanswered: only its job posting, its unanswered
  questions, and the student's experience bank. A job id of null when
  nothing is left, or when this chat has had its share of applications
  (KAN-381, below).
- `save_answers` (a write): saves answers to that application's
  questions, all or none; the open batch tab fills each one.
- `get_writing_samples` and `save_style_card` (app/connector/style.py,
  KAN-384): the student's writing samples, and the style card their Claude
  builds from them, which get_next_application then gives (`style_card`,
  and `style_card_needed` when samples have no card yet).
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

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import BaseModel, Field

from app.auto_apply import pipeline
from app.config import get_settings
from app.connector.prompt import PROMPT, TITLE
from app.db import get_sessionmaker
from app.deps import load_account
from app.queries import writing
from app.schemas.applications import ANSWER_MAX
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.services.essay_answer import bank_context


class Question(BaseModel):
    name: str = Field(description="The form field's name; save its answer under this name.")
    question: str
    required: bool
    max_length: int | None = Field(description="The form's limit in characters, if it has one.")


class NextApplication(BaseModel):
    job_id: str | None = Field(
        description="Null when no application has a question left, or when start_new_chat is true."
    )
    chat: str = Field(default="", description="Pass this to the next get_next_application call in this chat.")
    start_new_chat: bool = Field(
        default=False, description="True when this chat has written its share of applications."
    )
    message: str | None = Field(default=None, description="For the student, when start_new_chat is true.")
    company: str | None = None
    title: str | None = None
    posting: str | None = Field(default=None, description="The job posting's description.")
    questions: list[Question] = []
    experience: str = Field(default="", description="The student's experience bank: each entry and its bullets.")
    skills: list[str] = []
    style_card: str | None = Field(
        default=None, description="How the student writes, from their writing samples (KAN-384); null when none is saved."
    )
    style_card_needed: bool = Field(
        default=False, description="True when the student has writing samples and no style card built from them."
    )


class Answer(BaseModel):
    name: str = Field(description="The question's name, from get_next_application.")
    answer: str = Field(max_length=ANSWER_MAX)


class Saved(BaseModel):
    saved: int
    left: int = Field(description="How many of the application's questions are still unanswered.")


def _handed(chat: str) -> list[uuid.UUID]:
    """The job ids a chat value names; none for a value that isn't one."""
    try:
        return [uuid.UUID(job) for job in chat.split(",")] if chat else []
    except ValueError:
        return []


async def _student(db) -> AuthenticatedAccount:
    """The student the connector token was given for (app/connector/oauth.py)."""
    token = get_access_token()
    account = await load_account(db, uuid.UUID(token.subject), AccountType.APPLICANT) if token else None
    if account is None:
        raise ToolError("This WorkIt account is gone. Connect WorkIt again.")
    return account


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
            student = await _student(db)
            found = await pipeline.next_to_write(db, student.id, skip=handed)
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
        experience, skills = bank_context(found.bank)
        job = found.application.job
        return NextApplication(
            job_id=str(job.id),
            chat=",".join(str(j) for j in [*handed, job.id]),
            company=job.company,
            title=job.title,
            posting=found.posting,
            questions=[
                Question(name=q.name, question=q.label, required=q.required, max_length=q.max_length)
                for q in found.questions
            ],
            experience=experience,
            skills=skills,
            style_card=card,
            style_card_needed=card_needed,
        )

    @server.tool(
        title="Save answers",
        description=(
            "Saves answers to one WorkIt job application's written questions, all or none, and fills "
            "them into the application's open tab in the student's browser. Refuses an answer to a "
            "question the application doesn't have, an empty one, or one over the question's max_length."
        ),
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False),
    )
    async def save_answers(job_id: str, answers: list[Answer]) -> Saved:
        try:
            job = uuid.UUID(job_id)
        except ValueError as exc:
            raise ToolError("job_id is not one get_next_application gave.") from exc
        async with get_sessionmaker()() as db:
            student = await _student(db)
            try:
                left = await pipeline.save_answers(db, student.id, job, {a.name: a.answer for a in answers})
            except pipeline.NotFound as exc:
                raise ToolError("No such application. Use the job_id get_next_application gave.") from exc
            except (pipeline.WrongStage, pipeline.Refused) as exc:
                raise ToolError(str(exc)) from exc
        return Saved(saved=len(answers), left=left)

    @server.prompt(name="write_my_workit_answers", title=TITLE,
                   description="Writes the answers to your WorkIt applications' written questions.")
    def write_my_workit_answers() -> str:
        return PROMPT
