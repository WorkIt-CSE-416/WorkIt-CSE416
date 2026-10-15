"""
Base layer 1 functions that support auto apply features 
"""

from collections.abc import Iterable

from app.schemas.jobs import ScoredJob


def pick_batch(scored: Iterable[ScoredJob], size: int) -> list[ScoredJob]:
    """
    The first `size` matches, in the order given (best first), keeping one
    job posting per company and title, the best scored: some roles are
    listed once per office.

    Applied job postings never reach it: the match query leaves them out
    (JobFilters.applied_by, the Jobs page's own rule).
    """
    batch: list[ScoredJob] = []
    seen: set[tuple[str, str]] = set()
    for job in scored:
        if len(batch) >= size:
            break
        role = (job.company.strip().casefold(), job.title.strip().casefold())
        if role in seen:
            continue
        seen.add(role)
        batch.append(job)
    return batch
