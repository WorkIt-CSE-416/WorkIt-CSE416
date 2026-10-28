"""
fill_reports' queries, behind routers/fill_reports.py: store one problem
report from the extension's panel (models/fill_reports.py) with its sender,
list a student's own, and the admins' list, read and triage.
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.models.fill_reports import Fill_Report


async def store_report(db: AsyncSession, report: dict, account_id: uuid.UUID) -> uuid.UUID:
    '''adds the report (FillReportRequest.scrubbed()) from this account, commits, and answers its id'''
    row = Fill_Report(**report, account_id=account_id)
    db.add(row)
    await db.commit()
    return row.id


async def list_reports(
    db: AsyncSession, *, account_id: uuid.UUID | None = None, job_system: str | None = None,
    status: str | None = None, limit: int = 50, offset: int = 0,
) -> tuple[list[Fill_Report], int]:
    '''the reports matching every filter given, newest first, a page of them, and how many match in all'''
    where = []
    if account_id is not None:
        where.append(Fill_Report.account_id == account_id)
    if job_system:
        where.append(Fill_Report.job_system == job_system)
    if status:
        where.append(Fill_Report.status == status)
    rows = (await db.scalars(
        select(Fill_Report).where(*where).order_by(Fill_Report.created_at.desc(), Fill_Report.id).limit(limit).offset(offset)
    )).all()
    total = await db.scalar(select(func.count()).select_from(Fill_Report).where(*where))
    return list(rows), total or 0


async def get_report(db: AsyncSession, report_id: uuid.UUID) -> Fill_Report | None:
    '''one report, its html too, or None'''
    return await db.scalar(select(Fill_Report).options(undefer(Fill_Report.html)).where(Fill_Report.id == report_id))


async def triage_report(db: AsyncSession, report_id: uuid.UUID, changes: dict) -> Fill_Report | None:
    '''sets the status and/or admin note given, stamps updated_at, commits; None when there is no such report'''
    row = await get_report(db, report_id)
    if row is None:
        return None
    for key, value in changes.items():
        setattr(row, key, value)
    row.updated_at = func.now()
    await db.commit()
    await db.refresh(row)
    return row
