"""
Layer 2: the auto apply steps a caller can ask for, each calling layer-1
functions in order (auto-apply/architecture.md, "The function layers").
Checks no ownership: the layer-3 route that calls a step does.
"""

import dataclasses
import sys
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply.rules import pick_batch
from app.queries.jobs.filters import JobFilters
from app.routers.jobs import fetch_recommended
from app.schemas.jobs import ScoredJob

# The lowest score auto apply takes ("Match (built)"). It moves with the
# matching weights: retune it when they change.
MIN_MATCH = 60
# One click of Start Auto Apply ("The batch", why 10).
BATCH_SIZE = 10


async def get_matches(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    *,
    filters: JobFilters = JobFilters(),
    min_match: int = MIN_MATCH,
    size: int = BATCH_SIZE,
) -> list[ScoredJob]:
    """
    The applicant's best `size` matches, best first, each a ScoredJob: the
    Jobs page's own listing (title, company, logo, apply_url...) plus `match`
    and `highlights`.

    Leaves out the job postings the applicant marked as applied, by the Jobs
    page's own filter (JobFilters.applied_by), and repeats of one company and
    title (pick_batch). Raises NoResume (routers/jobs.py) when the applicant
    has no parsed primary resume.
    """
    scored = await fetch_recommended(
        db,
        applicant_id,
        filters=dataclasses.replace(filters, applied_by=applicant_id),
        min_match=min_match,
        # Every match, not a page: pick_batch drops repeats before it takes
        # `size`, and fetch_recommended scores every job whatever the limit.
        limit=sys.maxsize,
    )
    return pick_batch(scored, size)
