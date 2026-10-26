"""
Report a problem (KAN-403): the extension's panel sends a report the
student previewed and pressed Send for.

POST /fill-reports  {"job_system", "posting_url", "engine_version",
                     "fields": [{"kind", "label_shape", "error"}], "note"}
     Stores it and answers {"id"} (201). 422 for any key or value outside
     that shape (app/schemas/fill_reports.py): posting_url is http or
     https with no sign-in or fragment, and its query only the params that
     name the posting (POSTING_PARAMS). Any signed-in account may
     send one (sign-in keeps strangers from filling the table); the row
     names no account.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_account
from app.models.fill_reports import Fill_Report
from app.schemas.auth import AuthenticatedAccount
from app.schemas.fill_reports import FillReportRequest, FillReportStored

router = APIRouter(tags=["fill-reports"])


@router.post("/fill-reports", response_model=FillReportStored, status_code=status.HTTP_201_CREATED)
async def store_fill_report(
    body: FillReportRequest,
    _account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> FillReportStored:
    """Stores one problem report, with no account."""
    report = Fill_Report(**body.model_dump(mode="json"))
    db.add(report)
    await db.commit()
    return FillReportStored(id=str(report.id))
