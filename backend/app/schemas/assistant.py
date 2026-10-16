"""Request/response shapes for the editor assistant (KAN-221)."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, StringConstraints, model_validator

Action = Literal["fit", "hide", "move_up", "move_down", "shorter", "none"]


class AssistantTurn(BaseModel):
    """POST .../assistant body: what the student typed, and the line selected
    on the page, if any (at most one of the three ids)."""

    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    bullet_id: UUID | None = None
    entry_id: UUID | None = None
    skill_id: UUID | None = None

    @model_validator(mode="after")
    def one_line(self) -> "AssistantTurn":
        if sum(i is not None for i in (self.bullet_id, self.entry_id, self.skill_id)) > 1:
            raise ValueError("Select at most one line")
        return self


class AssistantReading(BaseModel):
    """The model's reply: which one action the student asked for, and, for
    "shorter" only, the shorter wording. Code writes every line the student
    reads; this text is the only model text that can reach them, and only
    after the truth-rule check."""

    action: Action
    text: str | None = None


class AssistantReply(BaseModel):
    """What the editor does next. `action` is one of the editor's own (it
    applies it through PATCH .../choices or POST .../fit); "none" only
    answers. For "shorter", `text` is the proposal and `original` the wording
    it replaces: nothing is saved until the student uses it."""

    action: Action
    reply: str
    text: str | None = None
    original: str | None = None
    uses_left: int
