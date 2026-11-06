"""KAN-662: a test that tries to reach past loopback fails at once, with no packet sent."""

import http.server
import json
import socket
import subprocess
import threading
import urllib.request
from pathlib import Path

import network_block
import pytest
from network_block import NetworkBlocked
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

REAL_HOST = "example.com"


@pytest.fixture
def real_calls(monkeypatch) -> list[str]:
    """Each real socket call the block lets out. The block saved them, so this sees what would leave the Mac."""
    calls: list[str] = []
    for name in ("_connect", "_connect_ex", "_sendto", "_getaddrinfo", "_gethostbyname", "_gethostbyname_ex"):
        real = getattr(network_block, name)
        monkeypatch.setattr(network_block, name, lambda *a, real=real, name=name, **k: calls.append(name) or real(*a, **k))
    return calls


def forgotten() -> list[str]:
    """What this test tried on purpose: said here, so the fixture doesn't fail it for that."""
    return network_block.end()


@pytest.mark.parametrize("reach", [
    lambda: socket.create_connection((REAL_HOST, 80), timeout=1),
    lambda: urllib.request.urlopen(f"http://{REAL_HOST}/", timeout=1),
    lambda: socket.getaddrinfo(REAL_HOST, 443),
    lambda: socket.gethostbyname(REAL_HOST),
    lambda: socket.socket().connect(("93.184.215.14", 80)),
    lambda: socket.socket().connect_ex(("93.184.215.14", 80)),
    lambda: socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(b"x", ("8.8.8.8", 53)),
    lambda: socket.socket(socket.AF_INET6).connect(("2606:2800:21f:cb07:6820:80da:af6b:8b2c", 80)),
], ids=["create_connection", "urlopen", "getaddrinfo", "gethostbyname", "connect", "connect_ex", "sendto", "ipv6"])
def test_reaching_a_real_host_fails_with_no_packet_sent(reach, real_calls):
    with pytest.raises(NetworkBlocked, match="tests never reach past loopback"):
        reach()
    assert real_calls == []
    assert forgotten()


def test_a_broad_except_can_not_swallow_it():
    with pytest.raises(NetworkBlocked):
        try:
            socket.create_connection((REAL_HOST, 80))
        except Exception:
            pytest.fail("except Exception caught it, so a test could carry on")
    forgotten()


def test_an_attempt_on_another_thread_is_kept_for_the_test():
    def quiet():
        try:
            socket.create_connection((REAL_HOST, 80))
        except BaseException:
            pass

    thread = threading.Thread(target=quiet)
    thread.start()
    thread.join()
    assert any(REAL_HOST in said for said in forgotten())


def test_loopback_still_connects(real_calls):
    with http.server.ThreadingHTTPServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler) as server:
        threading.Thread(target=server.handle_request, daemon=True).start()
        with socket.create_connection(("localhost", server.server_port), timeout=5):
            pass
    assert "_connect" in real_calls


@pytest.mark.live_network(REAL_HOST)
def test_a_live_test_opts_in_for_the_hosts_it_names_only():
    network_block.check("connect to", REAL_HOST)
    assert f"EXCLUDE {REAL_HOST}" in network_block.rules()
    with pytest.raises(NetworkBlocked):
        network_block.check("connect to", "job-boards.greenhouse.io")
    assert forgotten()


def test_chrome_started_by_a_test_gets_the_rules(monkeypatch):
    seen = []
    monkeypatch.setattr(subprocess.Popen, "__init__", lambda self, args, *r, **k: seen.append(args))
    network_block._popen()  # over the stand-in above, as install() is over the real one
    subprocess.Popen(["/x/Google Chrome for Testing", "--no-first-run"])
    subprocess.Popen(["/usr/bin/open", "-g", "-a", "Chrome", "--args", "--no-first-run"])
    subprocess.Popen(["/x/Google Chrome", "--host-resolver-rules=MAP * 127.0.0.1:1"])
    subprocess.Popen(["/usr/bin/git", "status"])
    assert seen[0][-1].startswith("--host-resolver-rules=MAP * ~NOTFOUND")
    assert seen[1][-1].startswith("--host-resolver-rules=MAP * ~NOTFOUND")
    assert seen[2] == ["/x/Google Chrome", "--host-resolver-rules=MAP * 127.0.0.1:1"]
    assert seen[3] == ["/usr/bin/git", "status"]


@pytest.fixture
def chromium():
    with sync_playwright() as playwright:
        if not Path(playwright.chromium.executable_path).exists():
            pytest.skip("no Playwright Chromium here")
        yield playwright


def _connections(log: Path) -> list:
    """Each TCP connect, DNS job and byte sent in Chrome's own net log. A UDP socket's connect alone is left out:
    it sends nothing, and Chrome makes one to Google's DNS address to ask the Mac whether IPv6 has a route."""
    text = log.read_text()
    net = json.loads(text if text.rstrip().endswith("}") else text.rstrip().rstrip(",") + "]}")
    kinds = net["constants"]["logEventTypes"]
    wanted = {kinds[k] for k in ("TCP_CONNECT", "HOST_RESOLVER_DNS_TASK", "SOCKET_BYTES_SENT", "UDP_BYTES_SENT") if k in kinds}
    return [e for e in net["events"] if e["type"] in wanted]


def test_a_page_in_chrome_reaches_nothing_and_fails_the_test(chromium, tmp_path):
    log = tmp_path / "net.json"
    browser = chromium.chromium.launch(args=[f"--log-net-log={log}", "--net-log-capture-mode=Everything"])
    page = browser.new_page()
    with pytest.raises(PlaywrightError, match="ERR_NAME_NOT_RESOLVED"):
        page.goto(f"http://{REAL_HOST}/", timeout=10_000)
    browser.close()
    assert any(REAL_HOST in said for said in forgotten())
    assert _connections(log) == []


def test_a_route_that_lets_a_request_through_reaches_nothing(chromium):
    browser = chromium.chromium.launch()
    page = browser.new_page()
    page.route("**/*", lambda route: route.continue_())
    with pytest.raises(PlaywrightError):
        page.goto(f"http://{REAL_HOST}/", timeout=10_000)
    browser.close()
    assert any("route continuing" in said for said in forgotten())


def test_a_route_fetch_and_playwrights_own_request_are_refused(chromium):
    browser = chromium.chromium.launch()
    page = browser.new_page()
    refused = []

    def fetching(route):
        try:
            route.fetch()
        except PlaywrightError as error:
            refused.append(str(error))
        route.fulfill(body="ok")

    page.route("**/*", fetching)
    page.goto(f"http://{REAL_HOST}/", timeout=10_000)
    with pytest.raises(PlaywrightError, match="own request"):
        page.request.get(f"http://{REAL_HOST}/")
    browser.close()
    assert refused
    assert len(forgotten()) == 2
