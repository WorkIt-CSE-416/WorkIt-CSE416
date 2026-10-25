"""
The page fetcher behind the company-brief check (KAN-382): it reads web
pages a student's Claude names, so it must never reach an address inside
WorkIt's network, a host the brief may not cite, or more than a page's
worth of bytes. A fake resolver and transport stand in for DNS and the web.
"""

import httpx
import pytest

from app.services import page_fetch
from app.services.page_fetch import Unreadable, fetch_text

pytestmark = pytest.mark.anyio

PUBLIC = "93.184.215.14"


def acme(host: str) -> bool:
    return host == "acme.com" or host.endswith(".acme.com")


def resolver(table: dict[str, list[str]]):
    async def resolve(host: str, port: int) -> list[str]:
        return table.get(host, [PUBLIC])
    return resolve


def web(handler):
    """A transport that records where each request went."""
    sent: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return handler(request)

    return httpx.MockTransport(handle), sent


def page(body: str, content_type: str = "text/html; charset=utf-8", **headers) -> httpx.Response:
    return httpx.Response(200, headers={"content-type": content_type, **headers}, content=body.encode())


async def test_it_answers_a_pages_text_without_its_markup():
    transport, sent = web(lambda r: page(
        "<html><head><style>p{}</style><script>var x = 'hidden';</script>"
        "<meta property='article:published_time' content='2026-09-30'></head>"
        "<body><h1>Launch</h1><p>Acme Rocket&nbsp;flies <b>today</b>.</p></body></html>"))

    text = await fetch_text("https://blog.acme.com/launch", acme, resolve=resolver({}), transport=transport)

    assert "Acme Rocket flies today." in text
    assert "hidden" not in text and "p{}" not in text
    # The page's date from its meta tags, for the brief's recency check.
    assert "2026-09-30" in text
    # It connects to the address it checked, naming the host for TLS.
    assert sent[0].url.host == PUBLIC
    assert sent[0].headers["host"] == "blog.acme.com"
    assert sent[0].extensions["sni_hostname"] == "blog.acme.com"


@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "ftp://acme.com/x",
    "gopher://acme.com/",
    "https://user:pw@acme.com/",
    "https://acme.com:8443/",
    "https://evil.com/",
    "https://acme.com.evil.com/",
    "http://169.254.169.254/latest/meta-data/",
    "not a url",
])
async def test_it_refuses_a_url_it_may_not_read(url):
    transport, sent = web(lambda r: page("secret"))

    with pytest.raises(Unreadable):
        await fetch_text(url, acme, resolve=resolver({}), transport=transport)
    assert sent == []


@pytest.mark.parametrize("address", [
    "127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1",
])
async def test_it_never_reaches_an_internal_address(address):
    transport, sent = web(lambda r: page("internal"))

    with pytest.raises(Unreadable):
        await fetch_text("https://acme.com/", acme, resolve=resolver({"acme.com": [PUBLIC, address]}), transport=transport)
    assert sent == []


async def test_a_redirect_is_checked_like_the_first_url():
    def handler(request):
        if request.headers["host"] == "acme.com":
            return httpx.Response(302, headers={"location": "https://internal.acme.com/admin"})
        return page("admin")
    transport, sent = web(handler)

    with pytest.raises(Unreadable):
        await fetch_text("https://acme.com/", acme, resolve=resolver({"internal.acme.com": ["10.1.2.3"]}),
                         transport=transport)
    assert len(sent) == 1


async def test_a_redirect_off_the_allowed_hosts_is_refused():
    transport, sent = web(lambda r: httpx.Response(301, headers={"location": "https://evil.com/"}))

    with pytest.raises(Unreadable):
        await fetch_text("https://acme.com/", acme, resolve=resolver({}), transport=transport)
    assert len(sent) == 1


async def test_an_allowed_redirect_is_followed_a_few_times_only():
    def handler(request):
        n = int(request.url.path.strip("/") or 0)
        return httpx.Response(302, headers={"location": f"https://acme.com/{n + 1}"}) if n < 10 else page("end")
    transport, sent = web(handler)

    with pytest.raises(Unreadable):
        await fetch_text("https://acme.com/", acme, resolve=resolver({}), transport=transport)
    assert len(sent) == page_fetch.MAX_REDIRECTS + 1


async def test_a_page_too_big_or_not_text_is_refused():
    big, _ = web(lambda r: page("x" * (page_fetch.MAX_BYTES + 1)))
    pdf, _ = web(lambda r: page("%PDF", content_type="application/pdf"))
    error, _ = web(lambda r: httpx.Response(500, content=b"no"))

    for transport in (big, pdf, error):
        with pytest.raises(Unreadable):
            await fetch_text("https://acme.com/", acme, resolve=resolver({}), transport=transport)


async def test_a_name_that_does_not_resolve_is_unreadable():
    async def nothing(host, port):
        raise OSError("no such host")
    transport, sent = web(lambda r: page("x"))

    with pytest.raises(Unreadable):
        await fetch_text("https://acme.com/", acme, resolve=nothing, transport=transport)
    assert sent == []
