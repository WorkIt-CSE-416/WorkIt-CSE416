"""A fake WorkIt for Apply's tests: a local HTTP server that answers as
Supabase Auth and WorkIt's API do, and records each request it gets.

One port serves both, so `FakeWorkIt.site` points every URL of an
`apply.workit.Site` at it. It holds sessions in memory: a token that it did
not issue is refused, an expired access token gets 401, and a refresh token
works one time (Supabase rotates it on each use). Every other path gets 404,
so a test never reaches the real WorkIt.

Use it as a context manager:

    with FakeWorkIt() as fake:
        client = WorkIt(fake.site, tmp_path / "workit-login.json")

Later tickets add WorkIt's write routes with `route(method, path, handler)`.
"""

import base64
import itertools
import json
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Self
from urllib.parse import urlsplit

from apply.workit import Site

ANON_KEY = "fake-anon-key"


@dataclass(frozen=True)
class Seen:
    """One request the fake got."""

    method: str
    path: str  # with its query string
    headers: dict[str, str]
    body: object  # the JSON body, or None


@dataclass
class Reply:
    status: int
    body: object = None
    headers: dict[str, str] = field(default_factory=dict)
    html: str | None = None


# A route's handler: it gets the request and the fake, and returns the reply.
Handler = Callable[[Seen, "FakeWorkIt"], Reply]


class FakeWorkIt:
    def __init__(self, email: str = "test.person@example.com", full_name: str = "Test Person",
                 account_type: str = "applicant"):
        self.account = {"id": "00000000-0000-4000-8000-000000000001", "email": email, "full_name": full_name,
                        "account_type": account_type, "onboarding_completed": True}
        self.requests: list[Seen] = []
        self._access: dict[str, float] = {}  # access token: when it expires
        self._refresh: set[str] = set()  # refresh tokens not used yet
        self._numbers = itertools.count(1)
        self._lock = threading.Lock()
        self._routes: dict[tuple[str, str], Handler] = {
            ("POST", "/auth/v1/token"): _token,
            ("GET", "/auth/me"): _me,
            ("GET", "/login"): _login_page,
        }
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(self))
        self.url = f"http://127.0.0.1:{self._server.server_address[1]}"
        self.site = Site(web=self.url, api=self.url, auth=self.url, anon_key=ANON_KEY)
        self._thread: threading.Thread | None = None

    def __enter__(self) -> Self:
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *_) -> None:
        self.stop()

    def stop(self) -> None:
        """Close the port: WorkIt can't be reached from now on."""
        self._server.shutdown()
        self._server.server_close()

    def route(self, method: str, path: str, handler: Handler) -> None:
        """Answer `method path` (no query string) with `handler`."""
        self._routes[(method, path)] = handler

    def session(self, expires_in: int = 3600) -> dict:
        """A new session, shaped as Supabase Auth returns it."""
        with self._lock:
            n = next(self._numbers)
            access, refresh = f"access-{n}", f"refresh-{n}"
            expires_at = int(time.time()) + expires_in
            self._access[access] = expires_at
            self._refresh.add(refresh)
        return {"access_token": access, "refresh_token": refresh, "expires_in": expires_in,
                "expires_at": expires_at, "token_type": "bearer", "user": {"id": self.account["id"]}}

    def cookies(self, session: dict) -> dict[str, str]:
        """The session cookie as WorkIt's web app sets it (@supabase/ssr: `base64-` and base64url JSON)."""
        raw = base64.urlsafe_b64encode(json.dumps(session).encode()).decode().rstrip("=")
        return {self.site.cookie: f"base64-{raw}"}

    def expire(self) -> None:
        """Let every access token expire, as an hour passing does. The refresh tokens still work."""
        with self._lock:
            self._access = dict.fromkeys(self._access, 0)

    def revoke(self) -> None:
        """Sign every session out, as a sign-out elsewhere or a password change does."""
        with self._lock:
            self._access.clear()
            self._refresh.clear()

    def signed_in(self, seen: Seen) -> bool:
        """Whether the request carries an access token that the fake issued and that has not expired."""
        token = seen.headers.get("authorization", "").removeprefix("Bearer ")
        return self._access.get(token, 0) > time.time()

    def _rotate(self, refresh: str) -> dict | None:
        with self._lock:
            if refresh not in self._refresh:
                return None
            self._refresh.discard(refresh)
        return self.session()


def _token(seen: Seen, fake: FakeWorkIt) -> Reply:
    if seen.headers.get("apikey") != ANON_KEY:
        return Reply(401, {"message": "No API key found in request"})
    if not seen.path.endswith("?grant_type=refresh_token"):
        return Reply(400, {"error": "unsupported_grant_type"})
    session = fake._rotate((seen.body or {}).get("refresh_token", ""))
    if session is None:
        return Reply(400, {"error": "invalid_grant", "error_description": "Invalid Refresh Token: Already Used"})
    return Reply(200, session)


def _me(seen: Seen, fake: FakeWorkIt) -> Reply:
    if not fake.signed_in(seen):
        return Reply(401, {"detail": "Not authenticated"})
    return Reply(200, fake.account)


def _login_page(seen: Seen, fake: FakeWorkIt) -> Reply:
    """WorkIt's sign-in page, already signed in: it sets a new session's cookie, as the web app does after a
    sign-in."""
    [(name, value)] = fake.cookies(fake.session()).items()
    return Reply(200, headers={"Set-Cookie": f"{name}={value}; Path=/; HttpOnly; SameSite=Lax"},
                 html="<!doctype html><title>WorkIt</title><p>Signed in.</p>")


def _handler(fake: FakeWorkIt) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def _answer(self) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            seen = Seen(self.command, self.path, {k.lower(): v for k, v in self.headers.items()},
                        json.loads(raw) if raw else None)
            fake.requests.append(seen)
            handler = fake._routes.get((self.command, urlsplit(self.path).path))
            reply = handler(seen, fake) if handler else Reply(404, {"detail": "Not Found"})
            data = reply.html.encode() if reply.html is not None else json.dumps(reply.body).encode()
            self.send_response(reply.status)
            self.send_header("Content-Type", "text/html" if reply.html is not None else "application/json")
            self.send_header("Content-Length", str(len(data)))
            for name, value in reply.headers.items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _answer

        def log_message(self, *_) -> None:  # quiet
            pass

    return Handler
