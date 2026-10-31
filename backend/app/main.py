'''
main file for the backend app
'''

import contextlib
import logging
import math
import time
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.auto_apply import pipeline
from app.config import get_settings
from app.connector.server import ROUTES as CONNECTOR_ROUTES
from app.connector.server import connector
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
from app.routers.connector import added_router as connector_added_router
from app.routers.connector import router as connector_router
from app.routers.documents import router as documents_router
from app.routers.extension_config import router as extension_config_router
from app.routers.fill_events import router as fill_events_router
from app.routers.fill_reports import router as fill_reports_router
from app.routers.intake import router as intake_router
from app.routers.job_system_requests import router as job_system_requests_router
from app.routers.jobs import router as jobs_router
from app.routers.notifications import router as notifications_router
from app.routers.pasted_answers import router as pasted_answers_router
from app.routers.preferences import router as preferences_router
from app.routers.profiles import router as profile_router
from app.routers.resumes import router as resume_router
from app.routers.scout import router as scout_router
from app.routers.sent_resumes import router as sent_resumes_router
from app.routers.tailor import router as tailor_router
from app.routers.tracker import router as tracker_router
from app.routers.uninstall_answers import router as uninstall_answers_router
from app.routers.writing_samples import router as writing_samples_router
from app.services import daily_caps

logger = logging.getLogger(__name__)


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # The connector's MCP server (KAN-377) answers only while this runs.
    async with connector.running():
        yield


app = FastAPI(
    title="WorkIt",
    lifespan=lifespan,
)

def _version(text: str) -> tuple[int, ...] | None:
    """"0.3" as (0, 3, 0, 0), as Chrome compares versions; None for anything that isn't dotted numbers."""
    parts = text.strip().split(".")
    if not all(p.isdigit() for p in parts):
        return None
    return (*map(int, parts), 0, 0, 0)[:max(4, len(parts))]


@app.middleware("http")
async def extension_version(request: Request, call_next):
    """
    The extension names its version on every request (KAN-466). One older
    than MIN_EXTENSION_VERSION gets 426 with the minimum, and the panel asks
    the student to update. A request with no version is let through: the
    webapp's server sends none, and neither did builds before this. One from
    the extension (its chrome-extension:// origin) is logged, to see how
    many old builds are still out there.
    """
    sent = request.headers.get("x-workit-extension")
    if sent is None:
        if request.headers.get("origin", "").startswith("chrome-extension://"):
            logger.info("Extension request with no version: %s %s", request.method, request.url.path)
        return await call_next(request)
    minimum = get_settings().min_extension_version
    version, floor = _version(sent), _version(minimum)
    if version is not None and floor is not None and version < floor:
        return JSONResponse(
            status_code=426,
            content={"detail": {"message": "Please update WorkIt.", "min_version": minimum}},
        )
    return await call_next(request)


app.include_router(auth_router)
app.include_router(jobs_router)
app.include_router(applications_router)
app.include_router(auto_apply_router)
app.include_router(resume_router)
app.include_router(documents_router)
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
app.include_router(notifications_router)
app.include_router(connector_router)
app.include_router(connector_added_router)
app.include_router(writing_samples_router)
app.include_router(pasted_answers_router)
app.include_router(fill_reports_router)
app.include_router(fill_events_router)
app.include_router(job_system_requests_router)
app.include_router(extension_config_router)
app.include_router(tracker_router)
app.include_router(uninstall_answers_router)
# The connector's MCP server and its OAuth endpoints (app/connector/server.py).
app.router.routes.extend(CONNECTOR_ROUTES)


@app.exception_handler(pipeline.NotFound)
async def not_found(request: Request, exc: pipeline.NotFound) -> JSONResponse:
    """Auto apply's steps (app/auto_apply/pipeline.py) raise NotFound for no
    such posting or application, and WrongStage for a step called out of
    order; every route answers them the same, so they are mapped here once."""
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(pipeline.WrongStage)
async def wrong_stage(request: Request, exc: pipeline.WrongStage) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(daily_caps.OverDailyCap)
async def over_daily_cap(request: Request, exc: daily_caps.OverDailyCap) -> JSONResponse:
    """A write past its account's daily cap (app/services/daily_caps.py), from any route."""
    return JSONResponse(status_code=429, content={"detail": str(exc)})


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
async def health_db(timing: bool = False) -> JSONResponse:
    '''
    check the health of the database. One query, and only the status, unless
    ?timing=true asks for the pool and the split wait: the route is public,
    so the extra query and the numbers are opt-in.
    '''
    try:
        # Splits the wait, timed in-process: "first" includes taking (or
        # opening) a connection, "again" is one round trip on it. A header
        # would not do: Cloudflare drops Server-Timing on api.workitjobs.ai
        start = time.perf_counter()
        async with get_sessionmaker()() as session:
            await session.execute(text("select 1"))
            first = time.perf_counter()
            if timing:
                await session.execute(text("select 1"))
                again = time.perf_counter()
                pool = type(session.bind.pool).__name__
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

    body = {"status": "ok", "database": "reachable"}
    if timing:
        body |= {
            "pool": pool,
            "first_ms": round((first - start) * 1000),
            "again_ms": round((again - first) * 1000),
        }
    return JSONResponse(content=body)
