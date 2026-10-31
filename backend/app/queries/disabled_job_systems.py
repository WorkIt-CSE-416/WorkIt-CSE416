"""The off switch's writes (KAN-467), behind app/routers/extension_config.py; the read is
auto_apply/queries.py's fetch_disabled_job_systems, which queueing shares. No HTTP: the
route checks the id, decides the status code and commits."""

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.disabled_job_systems import Disabled_Job_System


async def disable(db: AsyncSession, job_system: str, *, by: str) -> None:
    """Turns a job system off; already off is no change."""
    await db.execute(
        insert(Disabled_Job_System)
        .values(job_system=job_system, disabled_by=by)
        .on_conflict_do_nothing(index_elements=["job_system"])
    )


async def enable(db: AsyncSession, job_system: str) -> None:
    """Turns a job system back on; already on is no change."""
    await db.execute(delete(Disabled_Job_System).where(Disabled_Job_System.job_system == job_system))
