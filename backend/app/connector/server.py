"""
The connector (KAN-377): WorkIt's remote MCP server, which a student adds to
their own Claude. It runs inside this API on the official MCP Python SDK
(MCPServer, Streamable HTTP), at <api>/mcp, with WorkIt as its own OAuth
authorization server (app/connector/oauth.py). auto-apply/architecture.md,
14, has the design.

Stateless, JSON answers: each call is one HTTP request with no session kept
in memory, so it works on a serverless function and across containers.

The SDK serves its OAuth endpoints at the issuer's root (/authorize,
/token, /register, /revoke, /.well-known/...), so `ROUTES` adds each of
its paths to the API's router by name, never a catch-all mount, which
would answer 404 for a FastAPI route called with the wrong method.
"""

import contextlib
from collections.abc import AsyncIterator

from mcp.server.auth.settings import (
    AuthSettings,
    ClientRegistrationOptions,
    RevocationOptions,
)
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from starlette.routing import Route
from starlette.types import Receive, Scope, Send

from app.config import get_settings
from app.connector import briefs, style, tools
from app.connector.oauth import SCOPE, Provider

NAME = "WorkIt"


def build_server() -> MCPServer:
    api = get_settings().connector_api_url.rstrip("/")
    return MCPServer(
        NAME,
        title="WorkIt",
        description="Your WorkIt job applications: the questions each one asks, and the answers you save for them.",
        website_url=get_settings().connector_web_url,
        auth_server_provider=Provider(),
        auth=AuthSettings(
            issuer_url=api,
            resource_server_url=f"{api}/mcp",
            # Tokens are WorkIt's own and reach /mcp only; nothing else
            # accepts them, so there is no other resource to keep them from.
            validate_token_resource=False,
            required_scopes=[SCOPE],
            client_registration_options=ClientRegistrationOptions(
                enabled=True, valid_scopes=[SCOPE], default_scopes=[SCOPE]
            ),
            revocation_options=RevocationOptions(enabled=True),
        ),
    )


server = build_server()
tools.register(server)
briefs.register(server)
style.register(server)


def _app():
    return server.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        json_response=True,
        # DNS-rebinding protection is for servers on the user's own machine;
        # this one is public and every call carries a token.
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )


class _Connector:
    """The SDK's ASGI app, made again each time the API starts: its session
    manager runs once per instance, and tests start the API once per test."""

    def __init__(self) -> None:
        self.app = None

    @contextlib.asynccontextmanager
    async def running(self) -> AsyncIterator[None]:
        self.app = _app()
        async with server.session_manager.run():
            yield
        self.app = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self.app is None:
            raise RuntimeError("The connector runs only inside the API's lifespan (app/main.py).")
        await self.app(scope, receive, send)


connector = _Connector()
# Every path the SDK's app answers, sent to it whole (Route keeps the path).
ROUTES = [Route(route.path, endpoint=connector) for route in _app().routes]
