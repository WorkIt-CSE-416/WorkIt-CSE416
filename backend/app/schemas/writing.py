"""
A student's writing samples and style card (KAN-384), for
routers/writing_samples.py and the connector's tools.
"""

import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Up to three samples: two or three show a voice, and each is read whole by
# the student's Claude, so more would cost their plan for little gain.
MAX_SAMPLES = 3
# About 1,500 words: a long essay. The card is read on every application.
SAMPLE_MAX = 10_000
CARD_MAX = 4_000


class SampleBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(max_length=SAMPLE_MAX)

    @field_validator("text")
    @classmethod
    def not_blank(cls, text: str) -> str:
        if not text.strip():
            raise ValueError("A writing sample can't be empty.")
        return text


class Sample(BaseModel):
    id: uuid.UUID
    text: str


class Samples(BaseModel):
    samples: list[Sample]
    # None until the student's Claude builds one from the samples
    style_card: str | None
