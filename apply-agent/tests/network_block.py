"""No test reaches past loopback (KAN-662). conftest installs this before anything else loads.

A broken route once sent real requests to job sites from a test, so the rule is code, not a line in a brief:

- Python: a socket's connect or sendto, and a name lookup, to anything else raises NetworkBlocked before the
  real call. It is a BaseException, so a test's `except Exception` can't swallow it.
- Playwright: Chrome starts with RULES, which resolve every other host to nothing, so a request a route let
  through dies in Chrome with no packet sent. route.continue_, route.fetch and the APIRequestContext are refused
  first, since the last two run in Playwright's driver, where Chrome's rules don't reach.
- Any other Chrome a test starts (plain Workers, the WorkIt sign-in): subprocess.Popen adds RULES, unless the
  test's own switches already point every host somewhere (tests/plain_fakes.py).

Each attempt is kept in `attempts`, and conftest's no_network fixture fails the test on any, so one made on a
server's thread, or swallowed on the way, still fails. A request Chrome refuses is heard the same way when
Playwright started that Chrome; a plain Worker's is only refused.

A test that means to go live opts in by name, with the hosts it may reach:
`@pytest.mark.live_network("example.com")`. Nothing here sees a program a test starts other than Chrome (curl, gh)."""

import ipaddress
import os
import socket
import subprocess
from urllib.parse import urlsplit

from playwright._impl._browser_context import BrowserContext as ImplContext
from playwright.sync_api import APIRequestContext, BrowserType, Route
from playwright.sync_api import Error as PlaywrightError

RULES = "--host-resolver-rules"
CHROMES = ("chrome", "chromium", "google chrome for testing")
VERBS = ("delete", "fetch", "get", "head", "patch", "post", "put")

attempts: list[str] = []
allowed: frozenset[str] = frozenset()

# The real calls, here so a test can prove none was made.
_connect, _connect_ex, _sendto = socket.socket.connect, socket.socket.connect_ex, socket.socket.sendto
_getaddrinfo, _gethostbyname, _gethostbyname_ex = socket.getaddrinfo, socket.gethostbyname, socket.gethostbyname_ex


class NetworkBlocked(BaseException):
    """A test tried to reach past loopback."""


def _near(host) -> bool:
    if host in (None, "", b"") or not isinstance(host, str):
        return host in (None, "", b"") or (isinstance(host, bytes) and _near(host.decode()))
    name = host.strip("[]").lower().split("%")[0]
    if name == "localhost" or name.endswith(".localhost") or name in allowed:
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        return False


def _kept(how: str, host) -> str:
    said = f"{how} {host}: tests never reach past loopback (tests/network_block.py)"
    attempts.append(said)
    return said


def check(how: str, host) -> None:
    if not _near(host):
        raise NetworkBlocked(_kept(how, host))


def rules() -> str:
    """Chrome's switch: every host resolves to nothing, but for loopback and the hosts this test named."""
    near = ["localhost", "*.localhost", "127.0.0.1", "[::1]", *sorted(allowed)]
    return f"{RULES}=MAP * ~NOTFOUND, " + ", ".join(f"EXCLUDE {host}" for host in near)


def _is_ip(sock) -> bool:
    return sock.family in (socket.AF_INET, socket.AF_INET6)


def _sockets() -> None:
    def connect(self, address):
        if _is_ip(self):
            check("connect to", address[0])
        return _connect(self, address)

    def connect_ex(self, address):
        if _is_ip(self):
            check("connect to", address[0])
        return _connect_ex(self, address)

    def sendto(self, data, *rest):
        if _is_ip(self):
            check("sendto", rest[-1][0])
        return _sendto(self, data, *rest)

    def getaddrinfo(host, *args, **kwargs):
        check("a name lookup of", host)
        return _getaddrinfo(host, *args, **kwargs)

    def gethostbyname(host):
        check("a name lookup of", host)
        return _gethostbyname(host)

    def gethostbyname_ex(host):
        check("a name lookup of", host)
        return _gethostbyname_ex(host)

    socket.socket.connect, socket.socket.connect_ex, socket.socket.sendto = connect, connect_ex, sendto
    socket.getaddrinfo, socket.gethostbyname, socket.gethostbyname_ex = getaddrinfo, gethostbyname, gethostbyname_ex


def _is_chrome(argv: list[str]) -> bool:
    name = os.path.basename(argv[0]).lower()
    return name.startswith(CHROMES) or (name == "open" and "--args" in argv)


def _popen() -> None:
    start = subprocess.Popen.__init__

    def init(self, args, *rest, **kwargs):
        if isinstance(args, (list, tuple)) and args:
            argv = [str(a) for a in args]
            if _is_chrome(argv) and not any(a.startswith(RULES) for a in argv):
                args = [*args, rules()]
        start(self, args, *rest, **kwargs)

    subprocess.Popen.__init__ = init


def _playwright() -> None:
    def with_rules(launch):
        def launched(self, *args, **options):
            given = list(options.get("args") or [])
            if not any(a.startswith(RULES) for a in given):
                options["args"] = [*given, rules()]
            return launch(self, *args, **options)
        return launched

    BrowserType.launch = with_rules(BrowserType.launch)
    BrowserType.launch_persistent_context = with_rules(BrowserType.launch_persistent_context)

    # A route's handler runs on Playwright's dispatcher, so these say no in Playwright's own terms; the attempt
    # is kept, and the test fails when it ends.
    continue_, fetch = Route.continue_, Route.fetch

    def route_continue(self, *args, **options):
        url = options.get("url") or (args[0] if args else None) or self.request.url
        if not _near(urlsplit(url).hostname):
            _kept("a route continuing to", url)
            return self.abort("blockedbyclient")
        return continue_(self, *args, **options)

    def route_fetch(self, *args, **options):
        url = options.get("url") or (args[0] if args else None) or self.request.url
        if not _near(urlsplit(url).hostname):
            raise PlaywrightError(_kept("a route fetching", url))
        return fetch(self, *args, **options)

    Route.continue_, Route.fetch = route_continue, route_fetch

    def asked(verb):
        real = getattr(APIRequestContext, verb)

        def request(self, url_or_request, *args, **options):
            url = url_or_request if isinstance(url_or_request, str) else url_or_request.url
            if url.startswith(("http:", "https:")) and not _near(urlsplit(url).hostname):
                raise PlaywrightError(_kept("Playwright's own request to", url))
            return real(self, url_or_request, *args, **options)
        return request

    for verb in VERBS:
        setattr(APIRequestContext, verb, asked(verb))

    failed = ImplContext._on_request_failed

    def heard(self, request, end, failure, page):
        if "ERR_NAME_NOT_RESOLVED" in (failure or "") and not _near(urlsplit(request.url).hostname):
            _kept("a page's request to", request.url)
        failed(self, request, end, failure, page)

    ImplContext._on_request_failed = heard


def install() -> None:
    _sockets()
    _popen()
    _playwright()


def begin(hosts: tuple[str, ...] = ()) -> None:
    global allowed
    allowed = frozenset(h.lower() for h in hosts)
    attempts.clear()


def end() -> list[str]:
    """What this test tried, and every host blocked again."""
    global allowed
    found = list(attempts)
    attempts.clear()
    allowed = frozenset()
    return found
