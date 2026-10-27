"""
What a student reads when a model feature cannot answer: one mapping from
the model seam's `ScoutUnavailable` to a message, shared by every route that
calls a model. Each feature names its own wording; the mapping, and the
shared "AI limit" line, live here once.
"""

from dataclasses import dataclass

from workit_scout.llm import (
    OUT_OF_QUOTA,
    InvalidReply,
    ReplyCutOff,
    RequestTooLarge,
    ScoutUnavailable,
)

BUSY = "WorkIt has hit today's AI limit. Try again tomorrow."
TOO_LARGE = "This is too long for WorkIt's AI to read at once. Try something shorter."
TOO_LONG = "WorkIt's AI ran out of room before it finished. Try again."


@dataclass(frozen=True)
class AIMessages:
    spent: str  # the student's own daily cap is used up (429)
    offline: str  # no endpoint in the chain answered (503)
    lost: str  # an answer that failed the schema (503)
    busy: str = BUSY  # the provider's quota is spent (503)
    too_large: str = TOO_LARGE  # every endpoint found the request too large (503)
    too_long: str = TOO_LONG  # the answer stopped at its token cap (503)

    def failure(self, exc: ScoutUnavailable) -> str:
        if isinstance(exc, RequestTooLarge):
            return self.too_large
        if isinstance(exc, ReplyCutOff):
            return self.too_long
        if isinstance(exc, InvalidReply):
            return self.lost
        return self.busy if str(exc) == OUT_OF_QUOTA else self.offline
