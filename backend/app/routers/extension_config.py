"""
The per-job-system off switch (KAN-467): when a job system changes its
markup and fills break, an admin turns it off here, and within the
extension's next read (every 15 minutes) its fill stops, with no Chrome Web
Store release; no batch or Auto Apply click queues its postings meanwhile
(auto_apply/queries.py, disabled_job_systems). Remote config is data, which
Manifest V3 allows; never code.

GET    /extension/config                         {"disabled_job_systems": [{"job_system", "name"}]}
       Public: no sign-in, so a signed-out panel says it too. Names no account.
PUT    /admin/disabled-job-systems/{job_system}   turns it off (admins only, 403); again: no change
DELETE /admin/disabled-job-systems/{job_system}   turns it back on
       Both answer the config as GET does. A job_system is the Fill engine's
       id (hosts.py JOB_SYSTEMS); any other is 422. curl them with an admin's
       token, as the fix brief.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply.hosts import JOB_SYSTEMS
from app.auto_apply.queries import fetch_disabled_job_systems
from app.db import get_session
from app.deps import get_admin
from app.models.disabled_job_systems import Disabled_Job_System
from app.schemas.auth import AuthenticatedAccount
from app.schemas.extension_config import DisabledJobSystem, ExtensionConfig

router = APIRouter(tags=["extension-config"])


async def _config(db: AsyncSession) -> ExtensionConfig:
    return ExtensionConfig(disabled_job_systems=[
        DisabledJobSystem(job_system=s, name=JOB_SYSTEMS[s]) for s in await fetch_disabled_job_systems(db)
    ])


def _known(job_system: str) -> str:
    if job_system not in JOB_SYSTEMS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"WorkIt has no job system {job_system!r}.")
    return job_system


@router.get("/extension/config", response_model=ExtensionConfig)
async def extension_config(db: AsyncSession = Depends(get_session)) -> ExtensionConfig:
    """The extension's remote config: the job systems turned off."""
    return await _config(db)


@router.put("/admin/disabled-job-systems/{job_system}", response_model=ExtensionConfig)
async def disable_job_system(
    job_system: str,
    admin: AuthenticatedAccount = Depends(get_admin),
    db: AsyncSession = Depends(get_session),
) -> ExtensionConfig:
    """Turns a job system off."""
    await db.execute(
        insert(Disabled_Job_System)
        .values(job_system=_known(job_system), disabled_by=str(admin.email))
        .on_conflict_do_nothing(index_elements=["job_system"])
    )
    await db.commit()
    return await _config(db)


@router.delete("/admin/disabled-job-systems/{job_system}", response_model=ExtensionConfig)
async def enable_job_system(
    job_system: str,
    _admin: AuthenticatedAccount = Depends(get_admin),
    db: AsyncSession = Depends(get_session),
) -> ExtensionConfig:
    """Turns a job system back on."""
    await db.execute(delete(Disabled_Job_System).where(Disabled_Job_System.job_system == _known(job_system)))
    await db.commit()
    return await _config(db)
