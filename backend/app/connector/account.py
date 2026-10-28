"""
Who a connector call is for: the student the token was given for
(app/connector/oauth.py). Every tool module (tools.py, briefs.py, style.py)
asks through `account.current_student(db)`, so a stand-in (the ship check,
app/scripts/ship_check.py) replaces it in one place.
"""

import uuid

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver.exceptions import ToolError

from app.deps import load_account
from app.schemas.auth import AccountType, AuthenticatedAccount


async def current_student(db) -> AuthenticatedAccount:
    """The student the connector token was given for; a ToolError when the
    account is gone."""
    token = get_access_token()
    found = await load_account(db, uuid.UUID(token.subject), AccountType.APPLICANT) if token else None
    if found is None:
        raise ToolError("This WorkIt account is gone. Connect WorkIt again.")
    return found
