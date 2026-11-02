"""
fill_reports' queries, behind routers/fill_reports.py: store one problem
report from the extension's panel (models/fill_reports.py) with its sender,
list a student's own, and the admins' list, groups (by signature,
KAN-478), read and triage.
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.models.fill_reports import Fill_Report
from app.schemas.fill_reports import Signature, signature_of


async def store_report(db: AsyncSession, report: dict, account_id: uuid.UUID) -> uuid.UUID:
    '''adds the report (FillReportRequest.scrubbed()) from this account, commits, and answers its id'''
    row = Fill_Report(**report, account_id=account_id, signature=signature_of(report))
    db.add(row)
    await db.commit()
    return row.id


def _filters(
    *, account_id: uuid.UUID | None = None, job_system: str | None = None, status: str | None = None,
    engine_version: str | None = None, signature: str | None = None,
) -> list:
    where = []
    if account_id is not None:
        where.append(Fill_Report.account_id == account_id)
    for column, value in ((Fill_Report.job_system, job_system), (Fill_Report.status, status),
                          (Fill_Report.engine_version, engine_version), (Fill_Report.signature, signature)):
        if value:
            where.append(column == value)
    return where


async def list_reports(
    db: AsyncSession, *, limit: int = 50, offset: int = 0, **filters,
) -> tuple[list[Fill_Report], int]:
    '''the reports matching every filter given (_filters'), newest first, a page of them, and how many match in all'''
    where = _filters(**filters)
    rows = (await db.scalars(
        select(Fill_Report).where(*where).order_by(Fill_Report.created_at.desc(), Fill_Report.id).limit(limit).offset(offset)
    )).all()
    total = await db.scalar(select(func.count()).select_from(Fill_Report).where(*where))
    return list(rows), total or 0


async def list_groups(db: AsyncSession, *, limit: int = 200, **filters) -> list[dict]:
    '''the matching reports by signature, the group with the newest report first: each one's count, first and
    last report, the newest's id and the engine versions they came from'''
    rows = await db.execute(
        select(
            Fill_Report.signature,
            func.min(Fill_Report.job_system).label("job_system"),
            func.count().label("count"),
            func.min(Fill_Report.created_at).label("first_at"),
            func.max(Fill_Report.created_at).label("last_at"),
            func.array_agg(aggregate_order_by(Fill_Report.id, Fill_Report.created_at.desc()))[1].label("latest_id"),
            func.array_agg(func.distinct(Fill_Report.engine_version)).label("engine_versions"),
        )
        .where(*_filters(**filters))
        .group_by(Fill_Report.signature)
        .order_by(func.max(Fill_Report.created_at).desc())
        .limit(limit)
    )
    groups = []
    for row in rows:
        signature = Signature.parse(row.signature)
        groups.append({
            **row._asdict(), "field_kind": signature.field_kind, "error": signature.error,
            "latest_id": str(row.latest_id), "engine_versions": sorted(row.engine_versions),
        })
    return groups


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
