'''
a student's answers to the questions hiring systems repeat on every
application (KAN-283): work authorization, sponsorship, citizenship and visa
status, security clearance, and the voluntary gender, veteran and disability
self-identification. Onboarding's second step asks them; auto apply's fill
(auto-apply/architecture.md, `autofill_answers`) and My Profile read them.
models/CLAUDE.md, "autofill_answers", has the design.
'''
import uuid

from sqlalchemy import CheckConstraint, ForeignKey, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel


class Autofill_Answers(BaseModel):
    '''
    one row per applicant: `answers` maps a stable question key
    ("needs_sponsorship") to {"question_text", "answer"}, the answer being
    one of the key's option values (schemas/autofill_answers.py)

    One JSONB bank rather than a row per question: hiring systems repeat the
    same handful of questions, and new ones join without a migration. Written
    per key (queries/autofill_answers.py merges with ||), never replaced whole
    from the browser's copy, so two tabs saving different answers keep both.
    '''
    __tablename__ = "autofill_answers"
    applicant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), primary_key=True
    )
    answers: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )

    __table_args__ = (
        # A reader looks keys up; an array or a string here would answer
        # nothing and say nothing.
        CheckConstraint(
            "jsonb_typeof(answers) = 'object'", name="autofill_answers_answers_object"
        ),
    )
