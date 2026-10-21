'''
main file for the backend app
'''

import logging
import math

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.db import get_sessionmaker
from app.routers.applications import router as applications_router
from app.routers.assistant import router as assistant_router
from app.routers.auth import router as auth_router
from app.routers.auto_apply import router as auto_apply_router
from app.routers.autofill_answers import router as autofill_answers_router
from app.routers.avatars import router as avatar_router
from app.routers.bank import router as bank_router
from app.routers.built_resumes import router as built_resumes_router
from app.routers.company_jobs import router as company_jobs_router
from app.routers.essay_answer import router as essay_answer_router
from app.routers.intake import router as intake_router
from app.routers.jobs import router as jobs_router
from app.routers.preferences import router as preferences_router
from app.routers.profiles import router as profile_router
from app.routers.resumes import router as resume_router
from app.routers.scout import router as scout_router
from app.routers.sent_resumes import router as sent_resumes_router
from app.routers.tailor import router as tailor_router

logger = logging.getLogger(__name__)

app = FastAPI(
    title="WorkIt"
)

app.include_router(auth_router)
app.include_router(jobs_router)
app.include_router(applications_router)
app.include_router(auto_apply_router)
app.include_router(resume_router)
app.include_router(avatar_router)
app.include_router(company_jobs_router)
app.include_router(scout_router)
app.include_router(profile_router)
app.include_router(bank_router)
app.include_router(intake_router)
app.include_router(built_resumes_router)
app.include_router(sent_resumes_router)
app.include_router(tailor_router)
app.include_router(assistant_router)
app.include_router(preferences_router)
app.include_router(autofill_answers_router)
app.include_router(essay_answer_router)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    '''
    FastAPI's own 422, except that a non-finite number in the echoed input is
    sent as a string. Python's JSON parser accepts Infinity and NaN, and the
    default handler echoes them back into a response that can't encode them,
    which turns a bad request into a 500.
    '''
    def finite(value: float) -> float | str:
        return value if math.isfinite(value) else str(value)

    return JSONResponse(
        status_code=422,
        content={"detail": jsonable_encoder(exc.errors(), custom_encoder={float: finite})},
    )

@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/db")
async def health_db() -> JSONResponse:
    '''
    check the health of the database
    '''
    try:
        async with get_sessionmaker()() as session:
            await session.execute(text("select 1"))
    except Exception as exc:
        logger.exception("Database health check failed")

        return JSONResponse(
            status_code=503,
            content={
                "status": "unavailable",
                "error": type(exc).__name__,
                "hint": "Check .env and the server log for details.",
            },
        )

    return JSONResponse(content={"status": "ok", "database": "reachable"})
