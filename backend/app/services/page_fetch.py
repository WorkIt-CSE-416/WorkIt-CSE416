"""
Reads one web page's text for the company-brief check (KAN-382), where the
URL comes from a student's Claude, so from outside WorkIt. The fetcher
holds the line against server-side request forgery:

- http or https only, the default port only, no user:password in the URL;
- the host must pass the caller's `allowed` (the company's own domains or a
  news site), checked again on every redirect, at most MAX_REDIRECTS;
- every address the host resolves to must be public (no loopback, private,
  link-local, carrier-grade NAT, multicast or reserved address, IPv4-mapped
  ones included), and the request goes to the address that was checked,
  with the host name for TLS, so a DNS answer that changes between the
  check and the connect (rebinding) reaches nothing;
- TIMEOUT seconds for the whole page, MAX_BYTES of it (counted after
  decompression), text types only; no proxy from the environment.

It raises Unreadable for each refusal or failure; the caller drops the fact.
"""

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from html.parser import HTMLParser

import httpx

MAX_BYTES = 2_000_000
TIMEOUT = 10.0
MAX_REDIRECTS = 3
TEXT_TYPES = ("text/html", "text/plain", "application/xhtml+xml")
PORTS = {"http": 80, "https": 443}
USER_AGENT = "WorkIt-BriefCheck/1.0 (+https://workitjobs.ai)"

Resolve = Callable[[str, int], Awaitable[list[str]]]


class Unreadable(Exception):
    """A page the fetcher would not or could not read."""


async def _resolve(host: str, port: int) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [info[4][0] for info in infos]


def _public(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    # is_global leaves out private, loopback, link-local, shared (100.64/10)
    # and reserved space; multicast can still be global, so it is named.
    return ip.is_global and not ip.is_multicast


async def _checked(url: httpx.URL, allowed: Callable[[str], bool], resolve: Resolve) -> tuple[httpx.URL, str]:
    """The URL to connect to (host replaced by a checked address) and the host name."""
    if url.scheme not in PORTS or url.userinfo or not url.host:
        raise Unreadable("Only plain http(s) URLs are read.")
    if url.port not in (None, PORTS[url.scheme]):
        raise Unreadable("Only the default port is read.")
    host = url.host.rstrip(".").lower()
    try:
        ipaddress.ip_address(host)
        raise Unreadable("A bare address is never read.")
    except ValueError:
        pass
    if not allowed(host):
        raise Unreadable(f"{host} is not a source a brief may cite.")
    try:
        addresses = await resolve(host, PORTS[url.scheme])
    except OSError as exc:
        raise Unreadable(f"{host} does not resolve.") from exc
    if not addresses or not all(_public(a) for a in addresses):
        raise Unreadable(f"{host} resolves to an address WorkIt never reads.")
    return url.copy_with(host=addresses[0].split("%", 1)[0]), host


async def fetch_text(
    url: str,
    allowed: Callable[[str], bool],
    *,
    resolve: Resolve = _resolve,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    """The text of the page at `url` (markup, scripts and styles left out;
    meta tags' content kept, for its date). Raises Unreadable."""
    try:
        target = httpx.URL(url)
    except (httpx.InvalidURL, TypeError) as exc:
        raise Unreadable("Not a URL.") from exc
    try:
        async with asyncio.timeout(TIMEOUT), httpx.AsyncClient(
            transport=transport, follow_redirects=False, trust_env=False, timeout=TIMEOUT
        ) as client:
            for _ in range(MAX_REDIRECTS + 1):
                connect, host = await _checked(target, allowed, resolve)
                request = client.build_request(
                    "GET", connect,
                    headers={"host": host, "user-agent": USER_AGENT, "accept": "text/html, text/plain"},
                    extensions={"sni_hostname": host},
                )
                response = await client.send(request, stream=True)
                try:
                    if response.is_redirect:
                        target = target.join(response.headers.get("location", ""))
                        continue
                    if response.status_code != 200:
                        raise Unreadable(f"The page answered {response.status_code}.")
                    kind = response.headers.get("content-type", "text/html").split(";", 1)[0].strip().lower()
                    if kind not in TEXT_TYPES:
                        raise Unreadable(f"The page is {kind}, not text.")
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body += chunk
                        if len(body) > MAX_BYTES:
                            raise Unreadable("The page is too big.")
                    text = body.decode(response.encoding or "utf-8", errors="replace")
                    return text if kind == "text/plain" else text_of(text)
                finally:
                    await response.aclose()
            raise Unreadable("Too many redirects.")
    except TimeoutError as exc:
        raise Unreadable("The page took too long.") from exc
    except httpx.HTTPError as exc:
        raise Unreadable("The page could not be read.") from exc


# Tags that end a line of text, so "<h1>A</h1><p>B" reads "A\nB", not "AB".
_BLOCKS = {"p", "div", "br", "li", "ul", "ol", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6",
           "section", "article", "header", "footer", "main", "nav", "aside", "blockquote", "pre",
           "figcaption", "time", "title", "dt", "dd", "table"}
_HIDDEN = {"script", "style", "noscript", "template", "svg"}


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in _HIDDEN:
            self.hidden += 1
        elif tag == "meta":
            content = dict(attrs).get("content")
            if content:
                self.parts.append(f"\n{content}\n")
        elif tag in _BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in _HIDDEN:
            self.hidden = max(0, self.hidden - 1)
        elif tag in _BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def text_of(html: str) -> str:
    """A page's visible text, one line per block, spaces collapsed."""
    parser = _Text()
    parser.feed(html)
    parser.close()
    lines = (" ".join(line.split()) for line in "".join(parser.parts).splitlines())
    return "\n".join(line for line in lines if line)
