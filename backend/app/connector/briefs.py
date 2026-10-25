"""
The connector's company-brief tools (KAN-382), layer 3 over
app/auto_apply/briefs.py:

- `get_research_task` (read-only): the first company the student applies
  to whose shared brief is missing, stale or weak, what it lacks, and the
  sites a brief may cite; else the first posting whose team isn't named
  yet, or whose team's brief is missing or stale (scope "team", KAN-369).
  Given the chat value, the application get_next_application holds comes
  first, so its research_first is the task.
  A company of null when none needs research.
- `save_company_brief` (a write): checks each fact on its page and keeps
  the brief only if it beats the one kept. Answers what was kept, what was
  dropped and why, so Claude can fix and save again.

How to research lives in the prompt (app/connector/prompt.py), never here.
Both say openWorldHint=False, as every tool does (KAN-383): Claude does the
web research itself; the save only checks pages inside WorkIt's own step.
"""

import uuid
from typing import Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import BaseModel, Field

from app.auto_apply import briefs
from app.connector import account
from app.connector.tools import _handed
from app.db import get_sessionmaker

Category = Literal["products", "launches", "engineering", "team"]


class ResearchTask(BaseModel):
    company: str | None = Field(description="Null when no company needs research.")
    job_id: str | None = None
    title: str | None = Field(default=None, description="The job's title, which may name the role's team.")
    scope: Literal["company", "team"] | None = Field(
        default=None,
        description="company: research the company. team: name the team this posting is for and research it.")
    reason: Literal["missing", "stale", "weak", "unnamed"] | None = Field(
        default=None, description="unnamed: the posting's team is not named yet.")
    team: str | None = Field(default=None, description="For scope team, the team the posting was named with; "
                             "null while unnamed.")
    posting: str | None = Field(default=None, description="For scope team, the posting's text, to name its team from.")
    known_teams: list[str] = Field(
        default=[], description="The company's teams that already have a brief: if the posting names one of "
        "these, save under that name with no facts.")
    score: int = Field(default=0, description="The kept brief's score out of 100; 0 with none.")
    categories: list[Category] = Field(
        default=list(briefs.CATEGORIES), description="Each fact's category is one of these.")
    missing_categories: list[Category] = []
    min_facts: int = briefs.MIN_FACTS
    min_own_facts: int = Field(default=briefs.MIN_OWN, description=(
        "Once this many facts from the company's own site pass, news sites' facts are dropped; a news "
        "site's fact that states a number is always dropped."))
    news_sites: list[str] = Field(
        default=list(briefs.NEWS),
        description="Sites a fact may cite besides the company's own domain (a domain named for the company).")


class BriefFact(BaseModel):
    category: Category
    fact: str = Field(max_length=400, description="One sentence about the company.")
    url: str = Field(max_length=2000, description="The page that states it.")
    quote: str = Field(max_length=400, description="A passage copied word for word from that page.")
    published: str | None = Field(default=None, max_length=10, description="The page's date, YYYY-MM or YYYY-MM-DD.")
    team: str | None = Field(default=None, max_length=80, description="For a team fact, the team's name.")


class DroppedFact(BaseModel):
    url: str
    reason: str


class BriefSaved(BaseModel):
    saved: bool = Field(description="Whether this brief replaced the kept one.")
    score: int = Field(description="This brief's score out of 100, on its checked facts.")
    current_score: int = Field(description="The kept brief's score before this save; 0 with none.")
    kept: int = Field(description="How many facts passed the check.")
    min_facts: int = briefs.MIN_FACTS
    dropped: list[DroppedFact]
    team: str | None = Field(default=None, description="For scope team, the team the posting is named with.")


def register(server: MCPServer) -> None:

    @server.tool(
        title="Get a company to research",
        description=(
            "The first company in the student's open WorkIt applications whose shared company brief is "
            "missing, over 30 days old or weak: the company, the job, why, the brief's score, the "
            "categories it lacks, and the news sites a brief may cite. Then (scope team) the first job "
            "whose posting's team isn't named yet, or whose team's brief is missing or stale, with the "
            "posting's text. The application get_next_application holds (pass the same chat) comes first. "
            "company is null when none needs it."
        ),
        annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False),
    )
    async def get_research_task(
        chat: str = Field(
            default="",
            description="The chat value this chat's last get_next_application call gave; empty in a new chat.",
        ),
    ) -> ResearchTask:
        async with get_sessionmaker()() as db:
            task = await briefs.research_task(db, (await account.current_student(db)).id, skip=_handed(chat))
        if task is None:
            return ResearchTask(company=None)
        return ResearchTask(
            company=task.company, job_id=str(task.job_id), title=task.title, scope=task.scope, reason=task.reason,
            score=task.score, missing_categories=task.missing, team=task.team, posting=task.posting,
            known_teams=task.known_teams,
        )

    @server.tool(
        title="Save a company brief",
        description=(
            "Saves facts about a company the student applies to, shared with every WorkIt student "
            "applying there. WorkIt reads each fact's page and keeps the fact only if its quote is on "
            "the page word for word, the page is the company's own site or a listed news site, and "
            "every number in the fact is in its quote; a news site's fact only while too few own-site facts "
            "pass, and never one with a number. The brief is kept only with at least min_facts "
            "checked facts and a higher score than the kept brief. Answers what was kept and dropped. "
            "For a get_research_task of scope team, pass scope team, its job_id and the team the posting "
            "names as the posting writes it (null when it names none); a team brief needs one checked fact."
        ),
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False),
    )
    async def save_company_brief(
        company: str,
        facts: list[BriefFact],
        scope: Literal["company", "team"] = "company",
        job_id: str | None = None,
        team: str | None = Field(default=None, max_length=80),
    ) -> BriefSaved:
        if len(facts) > 2 * briefs.MAX_FACTS:
            raise ToolError(f"At most {2 * briefs.MAX_FACTS} facts at once.")
        async with get_sessionmaker()() as db:
            me = await account.current_student(db)
            try:
                job = uuid.UUID(job_id) if job_id else None
            except ValueError as exc:
                raise ToolError("job_id is not a job id.") from exc
            try:
                done = await briefs.save_brief(db, me.id, company, [f.model_dump() for f in facts],
                                               scope=scope, job_id=job, team=team)
            except (briefs.NotApplying, briefs.NotOnPosting) as exc:
                raise ToolError(str(exc)) from exc
        return BriefSaved(
            saved=done.saved, score=done.score, current_score=done.current_score, kept=done.kept,
            dropped=[DroppedFact(url=d.url, reason=d.reason) for d in done.dropped], team=done.team,
        )
