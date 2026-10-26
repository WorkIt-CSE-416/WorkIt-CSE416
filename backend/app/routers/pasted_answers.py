"""
Written Answers without Claude (KAN-385), layer 3: the webapp's page that
lists every question the student's open batch tabs need written, each with
a box for their own draft or text pasted from any AI. Each route checks the
caller owns the applicant and calls one layer-2 step
(app/auto_apply/pipeline.py). A pasted answer is saved by the very step the
connector's save_answers calls, so it passes the same checks
(app/auto_apply/checks.py) and the open tab fills it the same way.

GET  /applicants/{id}/written-questions
     Every open application (queued or needs_you, its job posting open) with
     a question still unanswered, oldest first, as
     {"job_id", "company", "title", "questions": [WrittenAnswer]}.
GET  /applicants/{id}/written-answers
     Every application with a written question answered, at any stage,
     newest first, as {"job_id", "company", "title", "questions":
     [{"name", "label", "answer", "own", "named_fact", "answered_at"}]}:
     named_fact is the company brief fact the answer uses, {"fact", "url"},
     or null (KAN-369); answered_at is when it was last saved, by which the
     page marks the student's own answers captured from a form New.
PUT  /applicants/{id}/applications/{job_id}/written-answers
     {"answers": [{"name", "answer"}]}
     Saves the answers, all or none, after every check. Answers
     {"saved", "left"}: how many of the application's questions are still
     unanswered. 422 when one fails, nothing saved, with detail
     {"message", "reasons": {name: [reason, ...]}}; 404 with no
     application, 409 when its form is no longer open.

Not the student's own edit in a tab (KAN-379's PUT .../answers, kept
unchecked as their own words): text pasted here may come from any AI, so it
is checked as Claude's is, but for copying the student's own writing
samples: the student pasted it, and may use their own words (that check
stops their Claude parroting the samples). Saved not own, as Claude's.

Applicant accounts only, and only their own id (assert_applicant_owns).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply import pipeline
from app.db import get_session
from app.deps import assert_applicant_owns, get_current_account
from app.schemas.applications import (
    PastedAnswers,
    PostingAnswers,
    PostingQuestions,
    SavedAnswers,
)
from app.schemas.auth import AuthenticatedAccount

router = APIRouter(prefix="/applicants/{applicant_id}", tags=["auto-apply"])


@router.get("/written-questions", response_model=list[PostingQuestions])
async def unanswered_questions(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> list[PostingQuestions]:
    """Every unanswered question of the open applications, by job posting."""
    assert_applicant_owns(account, applicant_id)
    return await pipeline.unanswered_questions(db, applicant_id)


@router.get("/written-answers", response_model=list[PostingAnswers])
async def answered_questions(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> list[PostingAnswers]:
    """Every answered written question, by job posting, with its named fact."""
    assert_applicant_owns(account, applicant_id)
    return await pipeline.answered_questions(db, applicant_id)


@router.put("/applications/{job_id}/written-answers", response_model=SavedAnswers)
async def save_pasted_answers(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    body: PastedAnswers,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> SavedAnswers:
    """Saves pasted answers to one application's questions, checked as the connector's are."""
    assert_applicant_owns(account, applicant_id)
    answers = {a.name: a.answer for a in body.answers}
    try:
        left = await pipeline.save_answers(db, applicant_id, job_id, answers, by="student")
    except pipeline.Refused as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, {"message": str(exc), "reasons": exc.reasons}
        ) from exc
    return SavedAnswers(saved=len(answers), left=left)
