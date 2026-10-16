"""
What a student reads when a model feature cannot answer: one mapping from
the model seam's `ScoutUnavailable` to a message, shared by every route that
calls a model. Each feature names its own wording; the mapping, and the
shared "AI limit" line, live here once.
"""

from dataclasses import dataclass

from workit_scout.llm import OUT_OF_QUOTA, InvalidReply, ScoutUnavailable

BUSY = "WorkIt has hit today's AI limit. Try again tomorrow."


@dataclass(frozen=True)
class AIMessages:
    spent: str  # the student's own daily cap is used up (429)
    offline: str  # no endpoint in the chain answered (503)
    lost: str  # an answer that failed the schema (503)
    busy: str = BUSY  # the provider's quota is spent (503)

    def failure(self, exc: ScoutUnavailable) -> str:
        if isinstance(exc, InvalidReply):
            return self.lost
        return self.busy if str(exc) == OUT_OF_QUOTA else self.offline
