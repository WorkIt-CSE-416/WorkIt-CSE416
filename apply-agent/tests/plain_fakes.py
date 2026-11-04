"""A fake site's pages in a plain Worker (Chrome for Testing, no CDP), for tests (KAN-613).

The fakes written for Playwright answer each request through `context.route`, which a plain
Worker has no way to do. Here the same handler answers from an HTTPS server on 127.0.0.1, and
the Worker's Chrome is told that every host lives there (`--host-resolver-rules`, test-only
switches, with the fake's self-signed certificate allowed). So a page keeps its real URL and
host, as Workday's own code and Apply's checks of `page.url` need, and nothing reaches the
network. Playwright's init scripts go at the top of each HTML page the server sends.

One server and one Worker serve the whole test run: `fake_page` points the server at a fake's
handler and opens a new tab for it, as Playwright's fresh context would, so a test run starts
one Chrome, not one per page.

`HttpRoute` is the part of Playwright's Route a fake's handler uses.
"""

import atexit
import datetime
import http.server
import json
import re
import shutil
import ssl
import sys
import tempfile
import threading
from contextlib import ExitStack, contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from apply.plain.bridge import Bridge
from apply.plain.launcher import PlainWorkers, chrome_for_testing
from apply.plain.page import PortContext, PortPage

_CERT: tuple[Path, Path] | None = None
HEAD = re.compile(rb"<head[^>]*>|<!doctype[^>]*>", re.IGNORECASE)


def have_chrome_for_testing() -> bool:
    try:
        chrome_for_testing()
        return True
    except FileNotFoundError:
        return False


def _certificate() -> tuple[Path, Path]:
    """A self-signed certificate for the fake's server (made once per test run)."""
    global _CERT
    if _CERT:
        return _CERT
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "apply-test-fake")])
    now = datetime.datetime.now(datetime.UTC)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=7))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName("*")]), critical=False)
            .sign(key, hashes.SHA256()))
    folder = Path(tempfile.mkdtemp(prefix="apply-fake-tls-"))
    (folder / "cert.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (folder / "key.pem").write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                       serialization.NoEncryption()))
    _CERT = folder / "cert.pem", folder / "key.pem"
    return _CERT


class _Request:
    def __init__(self, url: str, method: str, headers: dict, body: bytes):
        self.url, self.method, self.headers, self._body = url, method, headers, body

    @property
    def post_data(self) -> str | None:
        return self._body.decode() if self._body else None

    @property
    def post_data_json(self):
        return json.loads(self._body) if self._body else None


class HttpRoute:
    """Playwright's Route, for one request to the fake's HTTPS server."""

    def __init__(self, handler: http.server.BaseHTTPRequestHandler, request: _Request, scripts: list[str]):
        self._handler, self.request, self._scripts = handler, request, scripts
        self.answered = False

    def fulfill(self, status: int = 200, content_type: str | None = None, body: str | bytes | None = None,
                json: object = None, headers: dict | None = None) -> None:
        import json as json_

        if json is not None:
            body, content_type = json_.dumps(json), content_type or "application/json"
        data = body.encode() if isinstance(body, str) else (body or b"")
        if content_type and "html" in content_type and self._scripts:
            data = _with_scripts(data, self._scripts)
        h = self._handler
        h.send_response(status)
        if content_type:
            h.send_header("Content-Type", content_type)
        # As Playwright's fulfill: an answer a cross-origin call may read (Workday's scripts load with CORS).
        cors = {"Access-Control-Allow-Origin": self.request.headers.get("origin") or "*",
                "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"}
        for name, value in ({**cors, **(headers or {})}).items():
            h.send_header(name, value)
        h.send_header("Content-Length", str(len(data)))
        h.end_headers()
        if h.command != "HEAD":
            h.wfile.write(data)
        self.answered = True

    def abort(self, *_) -> None:
        """As Playwright's: a network error (the connection closes with no answer)."""
        self._handler.close_connection = True
        self.answered = True


def _with_scripts(page: bytes, scripts: list[str]) -> bytes:
    """`page` with the init scripts first in its head, before any of its own."""
    tags = "".join(f"<script>{s}</script>" for s in scripts).encode()
    found = HEAD.search(page)
    return page[:found.end()] + tags + page[found.end():] if found else tags + page


@contextmanager
def https_fake(handle, scripts=()):
    """An HTTPS server on 127.0.0.1 answering every request with `handle(route)`. Yields its port.
    `scripts`: the init scripts, or a function giving them at each request."""
    current = scripts if callable(scripts) else (lambda: list(scripts))

    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _any(self):
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            host = self.headers.get("Host", "").split(":")[0]
            request = _Request(f"https://{host}{self.path}", self.command, {k.lower(): v for k, v in self.headers.items()}, body)
            route = HttpRoute(self, request, current())
            if self.command == "OPTIONS":  # a CORS preflight
                return route.fulfill(status=204)
            try:
                handle(route)
            except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
                self.close_connection = True  # Chrome dropped the request (the page moved on)
                return
            except Exception:
                if not route.answered:
                    route.fulfill(status=500, content_type="text/plain", body="fake failed")
                raise
            if not route.answered:
                route.abort()

        do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = _any

        def log_message(self, *_):
            pass

    class Server(http.server.ThreadingHTTPServer):
        def handle_error(self, request, client_address):
            if not isinstance(sys.exc_info()[1], (OSError, ssl.SSLError)):  # not Chrome dropping a connection
                super().handle_error(request, client_address)

    server = Server(("127.0.0.1", 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(*map(str, _certificate()))
    context.set_alpn_protocols(["http/1.1"])
    server.socket = context.wrap_socket(server.socket, server_side=True)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield server.server_address[1]
    finally:
        server.shutdown()
        server.server_close()


class _Shared:
    """The run's one fake server and one plain Worker, every host answered by the server."""

    def __init__(self):
        self.handle, self.scripts = None, []
        self._stack = ExitStack()
        port = self._stack.enter_context(https_fake(self._answer, lambda: self.scripts))
        folder = Path(tempfile.mkdtemp(prefix="apw-fake-", dir="/tmp"))  # short: a socket path is capped at 104 bytes
        self._stack.callback(shutil.rmtree, folder, ignore_errors=True)
        flags = (f"--host-resolver-rules=MAP * 127.0.0.1:{port}", "--ignore-certificate-errors", "--disable-quic")
        workers = PlainWorkers(folder, kind="testing", bridge=Bridge(folder / "w.sock"), test_flags=flags)
        self._stack.callback(workers.stop_all)
        self.connection = workers.launch(0).connection
        self.base = PortPage.first(self.connection).tab  # kept on about:blank, so the window stays
        atexit.register(self._stack.close)

    def _answer(self, route) -> None:
        if self.handle:  # else Chrome's own requests at launch, before any fake: no answer
            self.handle(route)

    def close(self) -> None:
        atexit.unregister(self._stack.close)
        self._stack.close()


_SHARED: _Shared | None = None


def _shared() -> _Shared:
    global _SHARED
    if _SHARED is None or _SHARED.connection.closed.is_set():
        if _SHARED:
            _SHARED.close()
        _SHARED = _Shared()
    return _SHARED


@contextmanager
def fake_page(handle, scripts=(), url: str = ""):
    """A new tab of the run's plain Worker at `url`, each request answered by `handle(route)` with
    `scripts` at the top of each HTML page. Its tabs close after."""
    shared = _shared()
    shared.handle, shared.scripts = handle, list(scripts)
    context = PortContext(shared.connection)
    page = context.new_page()
    try:
        if url:
            page.goto(url)
        yield page
    finally:
        for other in context.pages:
            if other.tab != shared.base:
                other.close()


def host_of(url: str) -> str:
    return urlsplit(url).hostname or ""
