"""
The account tables' own queries, behind app/deps.py.
"""

import uuid

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profiles import Applicant_Profile, Company_Membership
from app.schemas.auth import AccountType


async def copy_sign_in_email(
    db: AsyncSession, account_id: uuid.UUID, account_type: AccountType, email: str
) -> None:
    '''
    writes the sign-in email onto the account's row, the copy kept for
    display and queries (docs/auth.md, Identity). Flushes nothing itself:
    the caller commits
    '''
    model = Applicant_Profile if account_type is AccountType.APPLICANT else Company_Membership
    await db.execute(update(model).where(model.id == account_id).values(email=email))
