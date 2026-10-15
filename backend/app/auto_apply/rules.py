"""
Base layer 1 functions that support auto apply features 
"""

from collections.abc import Container, Iterable

from app.schemas.jobs import ScoredJob


def pick_batch(
    scored: Iterable[ScoredJob], done_job_ids: Container[str], size: int
) -> list[ScoredJob]:
    """
    The first `size` matches to queue, in the order given (best first).

    Leaves out a job posting the student already has an application for
    (`done_job_ids`, the job ids as ScoredJob.id spells them); without this,
    every Start returns the same batch. Keeps one job posting per company and
    title, the best scored, since some roles are listed once per office; a
    done one counts, so its other offices stay out too.
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
        if job.id not in done_job_ids:
            batch.append(job)
    return batch
