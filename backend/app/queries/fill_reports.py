"""
fill_reports' query, behind routers/fill_reports.py: stores one problem
report from the extension's panel (models/fill_reports.py), with no account.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fill_reports import Fill_Report


async def store_report(db: AsyncSession, report: dict) -> uuid.UUID:
    '''adds the report (FillReportRequest's fields, as JSON), commits, and answers its id'''
    row = Fill_Report(**report)
    db.add(row)
    await db.commit()
    return row.id
