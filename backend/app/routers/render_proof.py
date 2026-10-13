'''
The Tectonic proof (KAN-204, slice 0 of the resume builder): one endpoint
that compiles a fixed Jake's Resume, to show Tectonic runs inside the Vercel
Function (ADR 0002). KAN-207 replaces it with the real renderer.

GET /render-proof/jakes.pdf
    200  application/pdf, Jake's sample resume. `Server-Timing: render;dur=<ms>`
         is the compile time, the number the PR records
    503  {"detail": ...} when Tectonic or its warm cache is missing, or the
         compile fails

No auth: it renders only fixed text, and no applicant data enters it.
'''

import asyncio
import logging
import time

from fastapi import APIRouter, HTTPException, Response

from app.services.resume_render import TectonicUnavailable, compile_pdf
from app.services.resume_render.sample import document

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/render-proof", tags=["render-proof"])


@router.get("/jakes.pdf")
async def jakes_pdf() -> Response:
    started = time.perf_counter()
    try:
        pdf = await asyncio.to_thread(compile_pdf, document())
    except TectonicUnavailable as exc:
        logger.error("render proof failed: %s", exc)
        raise HTTPException(status_code=503, detail="The resume renderer is unavailable.") from exc
    elapsed_ms = (time.perf_counter() - started) * 1000
    return Response(pdf, media_type="application/pdf", headers={"Server-Timing": f"render;dur={elapsed_ms:.0f}"})
