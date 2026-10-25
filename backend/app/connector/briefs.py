"""
The connector's company-brief tools (KAN-382), layer 3 over
app/auto_apply/briefs.py:

- `get_research_task` (read-only): the first company the student applies
  to whose shared brief is missing, stale or weak, what it lacks, and the
  sites a brief may cite. A company of null when none needs research.
- `save_company_brief` (a write): checks each fact on its page and keeps
  the brief only if it beats the one kept. Answers what was kept, what was
  dropped and why, so Claude can fix and save again.

How to research lives in the prompt (app/connector/prompt.py), never here.
Both say openWorldHint=False, as every tool does (KAN-383): Claude does the
web research itself; the save only checks pages inside WorkIt's own step.
"""

from typing import Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import BaseModel, Field

from app.auto_apply import briefs
from app.db import get_sessionmaker

Category = Literal["products", "launches", "engineering", "team"]


class ResearchTask(BaseModel):
    company: str | None = Field(description="Null when no company needs research.")
    job_id: str | None = None
    title: str | None = Field(default=None, description="The job's title, which may name the role's team.")
    reason: Literal["missing", "stale", "weak"] | None = None
    score: int = Field(default=0, description="The kept brief's score out of 100; 0 with none.")
    categories: list[Category] = Field(
        default=list(briefs.CATEGORIES), description="Each fact's category is one of these.")
    missing_categories: list[Category] = []
    min_facts: int = briefs.MIN_FACTS
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


def register(server: MCPServer, student) -> None:
    """`student(db)` finds the student from the connector token (tools._student)."""

    @server.tool(
        title="Get a company to research",
        description=(
            "The first company in the student's open WorkIt applications whose shared company brief is "
            "missing, over 30 days old or weak: the company, the job, why, the brief's score, the "
            "categories it lacks, and the news sites a brief may cite. company is null when none needs it."
        ),
        annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False),
    )
    async def get_research_task() -> ResearchTask:
        async with get_sessionmaker()() as db:
            task = await briefs.research_task(db, (await student(db)).id)
        if task is None:
            return ResearchTask(company=None)
        return ResearchTask(
            company=task.company, job_id=str(task.job_id), title=task.title, reason=task.reason,
            score=task.score, missing_categories=task.missing,
        )

    @server.tool(
        title="Save a company brief",
        description=(
            "Saves facts about a company the student applies to, shared with every WorkIt student "
            "applying there. WorkIt reads each fact's page and keeps the fact only if its quote is on "
            "the page word for word, the page is the company's own site or a listed news site, and "
            "every number in the fact is in its quote. The brief is kept only with at least min_facts "
            "checked facts and a higher score than the kept brief. Answers what was kept and dropped."
        ),
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False),
    )
    async def save_company_brief(company: str, facts: list[BriefFact]) -> BriefSaved:
        if len(facts) > 2 * briefs.MAX_FACTS:
            raise ToolError(f"At most {2 * briefs.MAX_FACTS} facts at once.")
        async with get_sessionmaker()() as db:
            me = await student(db)
            try:
                done = await briefs.save_brief(db, me.id, company, [f.model_dump() for f in facts])
            except briefs.NotApplying as exc:
                raise ToolError(str(exc)) from exc
        return BriefSaved(
            saved=done.saved, score=done.score, current_score=done.current_score, kept=done.kept,
            dropped=[DroppedFact(url=d.url, reason=d.reason) for d in done.dropped],
        )
