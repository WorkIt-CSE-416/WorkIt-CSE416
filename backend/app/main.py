'''
main file for the backend app
'''

import logging

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.db import get_sessionmaker
from app.routers.resumes import router as resume_router

logger = logging.getLogger(__name__)

app = FastAPI(
    title="WorkIt"
)

app.include_router(resume_router)

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
