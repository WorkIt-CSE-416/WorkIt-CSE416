"""
The connector's style card tools (KAN-384): the student's Claude reads
their writing samples and saves the style card it builds from them;
get_next_application (tools.py) then hands the card out with each
application. The prompt (prompt.py) says when and how to build one.

- `get_writing_samples` (read-only): the samples, word for word, and the
  card saved now, if any.
- `save_style_card` (a write): adds or replaces the card. Refused when the
  student has no samples (a card describes their own writing, never a
  guess), or when it is empty or over CARD_MAX characters.

A student adds, replaces and removes samples on WorkIt
(routers/writing_samples.py), never through the connector, and any change
drops the card (queries/writing.py). Kept apart from tools.py, which other
connector work changes, and registered next to it in server.py.
"""

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import BaseModel

from app.connector import account
from app.db import get_sessionmaker
from app.queries import writing
from app.schemas.writing import CARD_MAX


class WritingSamples(BaseModel):
    samples: list[str]
    style_card: str | None


class CardSaved(BaseModel):
    saved: bool


def register(server: MCPServer) -> None:
    @server.tool(
        title="Get my writing samples",
        description=(
            "The student's own writing samples on WorkIt, word for word, oldest first, and the style card "
            "saved from them (null when none is). Samples is empty when the student gave none."
        ),
        annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False),
    )
    async def get_writing_samples() -> WritingSamples:
        async with get_sessionmaker()() as db:
            student = await account.current_student(db)
            return WritingSamples(
                samples=list(await writing.sample_texts(db, student.id)),
                style_card=await writing.fetch_style_card(db, student.id),
            )

    @server.tool(
        title="Save my style card",
        description=(
            "Saves the student's style card, a description of how they write built from their writing "
            f"samples, in place of any saved before. Refuses a card when the student has no samples, or "
            f"one that is empty or over {CARD_MAX} characters."
        ),
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False),
    )
    async def save_style_card(card: str) -> CardSaved:
        if not card.strip():
            raise ToolError("The style card is empty.")
        if len(card) > CARD_MAX:
            raise ToolError(f"The style card is {len(card)} characters; keep it under {CARD_MAX}.")
        async with get_sessionmaker()() as db:
            student = await account.current_student(db)
            if not await writing.sample_texts(db, student.id):
                raise ToolError("The student has no writing samples on WorkIt, so there is nothing to build a card from.")
            await writing.save_style_card(db, student.id, card.strip())
            await db.commit()
        return CardSaved(saved=True)
