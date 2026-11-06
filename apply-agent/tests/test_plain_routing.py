"""S8 (KAN-614): worker_mode routes forms to plain Workers. The routing needs no browser. The rest runs the fake Greenhouse form in one plain Worker
(Chrome for Testing, no CDP), reused for a second rehearsal with its guards reset, and skips
without Chrome for Testing (CI). Nothing is ever submitted."""

import json
import os
import shutil
import tempfile
import urllib.request
from contextlib import contextmanager
from pathlib import Path

import fakes
import pytest
from conftest import ARC_FORM, ARC_URL
from fakes import FakeJobServer
from plain_fakes import have_chrome_for_testing, https_fake
from test_rehearse import NeverSubmits, rehearse
from test_run_answers import profile_with

from apply import captcha
from apply.fillers import FILLERS
from apply.greenhouse import GreenhouseFiller
from apply.plain import site as routing
from apply.plain.bridge import Bridge
from apply.plain.launcher import PlainWorkers
from apply.plain.site import PlainSite, RoutedSite
from apply.plain.tile import EitherFrames

POLICIES = {"plain_worker_hosts": ["jobs.lever.co", "smartrecruiters.com", "apply.workable.com"]}


def test_worker_mode_defaults_to_cdp_and_refuses_another_word():
    assert routing.mode({}) == "cdp"
    assert routing.mode({"worker_mode": "protected"}) == "protected"
    with pytest.raises(ValueError):
        routing.mode({"worker_mode": "stealth"})


def test_the_protected_hosts_and_their_subdomains_go_to_plain_workers(tmp_path, monkeypatch):
    monkeypatch.setattr(routing, "LEARNED", tmp_path / "plain-hosts.json")
    assert routing.protected("https://jobs.lever.co/hermeus/c9187245/apply", POLICIES)
    assert routing.protected("https://jobs.smartrecruiters.com/LinkedIn3/744000159593630", POLICIES)
    assert routing.protected("https://apply.workable.com/coldquanta/j/EB77DE8198/apply", POLICIES)
    assert not routing.protected("https://job-boards.greenhouse.io/arc/jobs/1", POLICIES)
    assert not routing.protected("https://notlever.co/jobs", POLICIES)


def test_a_host_a_bot_block_was_seen_on_is_learned(tmp_path, monkeypatch):
    learned = tmp_path / "plain-hosts.json"
    monkeypatch.setattr(routing, "LEARNED", learned)
    url = "https://jobs.ashbyhq.com/acme/1/application"
    assert not routing.protected(url, POLICIES)
    blocked = captcha.blocked("Acme", url, "Access denied")
    assert "blocked Apply's Chrome as a bot" in str(blocked)
    assert json.loads(learned.read_text()) == ["jobs.ashbyhq.com"]
    assert routing.protected(url, POLICIES) and routing.protected("https://jobs.ashbyhq.com/other/2", POLICIES)
    captcha.blocked("Acme", url)  # once is enough
    assert json.loads(learned.read_text()) == ["jobs.ashbyhq.com"]


class _Kind:
    """A site that records the forms it opened."""

    def __init__(self, name):
        self.name, self.opened, self.profiles, self.workers = name, [], Path("/nowhere"), self
        self.stopped = []

    @contextmanager
    def open(self, url, worker=0):
        self.opened.append((url, worker))
        yield f"{self.name} page"

    def live(self, worker):
        return False

    def stop(self, worker):
        self.stopped.append(worker)

    def show(self, worker):
        return f"{self.name} shows {worker}"

    def endpoint(self, worker):
        return f"cdp endpoint {worker}"

    def connection(self, worker):
        return f"port {worker}"


def test_protected_mode_opens_a_protected_form_on_a_plain_worker_and_the_rest_on_cdp(tmp_path, monkeypatch):
    monkeypatch.setattr(routing, "LEARNED", tmp_path / "plain-hosts.json")
    cdp, plain = _Kind("cdp"), _Kind("plain")
    site = RoutedSite(cdp, plain, POLICIES)
    with site.open("https://jobs.lever.co/hermeus/1/apply", worker=0) as page:
        assert page == "plain page"
        assert site.plain(0) and site.connection(0) == "port 0" and site.endpoint(0) is None
        assert site.show(0) == "plain shows 0"
    with site.open("https://job-boards.greenhouse.io/arc/jobs/1", worker=0) as page:
        assert page == "cdp page"
        assert not site.plain(0) and site.connection(0) is None and site.endpoint(0) == "cdp endpoint 0"
    assert plain.stopped == [0]  # its plain Chrome made way for the CDP one
    frames = EitherFrames(_Frames("cdp"), _Frames("port"), site.plain)
    assert frames.frame(0) == "cdp frame 0"
    site._plain[0] = True
    assert frames.frame(0) == "port frame 0" and frames.field_error(0) == "port error 0"


class _Frames:
    def __init__(self, name):
        self.name = name

    def frame(self, worker):
        return f"{self.name} frame {worker}"

    def field_error(self, worker):
        return f"{self.name} error {worker}"





# --- live, in one plain Worker

needs_chrome = pytest.mark.skipif(not have_chrome_for_testing(), reason="needs Chrome for Testing")


UPLOADS = "https://uploads.apply-fake.test"  # the fake's S3 stand-in, as an HTTPS host the fake's server answers


def _uploading(fake: FakeJobServer):
    """fake._handle, but an upload to UPLOADS goes on to the fake's upload store (http://127.0.0.1),
    which an https page in a plain Worker can't reach itself."""
    store = f"http://127.0.0.1:{fake._uploads.server_address[1]}"

    def handle(route) -> None:
        if not route.request.url.startswith(UPLOADS):
            return fake._handle(route)
        sent = urllib.request.Request(store, data=route.request._body, method="POST",
                                      headers={"Content-Type": route.request.headers["content-type"]})
        with urllib.request.urlopen(sent, timeout=30) as answer:
            route.fulfill(status=answer.status, body=answer.read())
    return handle


@pytest.fixture
def fake_site(monkeypatch):
    """The fake Greenhouse form's pages from an HTTPS server every host resolves to, in one plain Worker."""
    monkeypatch.setattr(fakes._UploadStore, "url", property(lambda self: UPLOADS))
    folder = Path(tempfile.mkdtemp(prefix="apw-s8-", dir="/tmp"))  # short: a socket path is capped at 104 bytes
    with FakeJobServer(ARC_FORM) as fake, https_fake(_uploading(fake)) as port:
        flags = (f"--host-resolver-rules=MAP * 127.0.0.1:{port}", "--ignore-certificate-errors", "--disable-quic")
        workers = PlainWorkers(folder, kind="testing", bridge=Bridge(folder / "w.sock"), test_flags=flags)
        site = PlainSite(workers)
        site.fetch = fake.fetch
        try:
            yield site, fake
        finally:
            site.close()
            shutil.rmtree(folder, ignore_errors=True)


@needs_chrome
def test_a_reused_plain_worker_rehearses_twice_with_its_guards_reset(monkeypatch, tmp_path, fake_site):
    site, fake = fake_site
    filler = NeverSubmits(GreenhouseFiller())
    monkeypatch.setitem(FILLERS, "greenhouse", filler)
    [first] = rehearse([ARC_URL], site, profile_with(tmp_path))
    pid = site.workers.running[0].pid
    connection = site.workers.running[0].connection
    assert connection.call("guard.status")["scripts"]  # the first rehearsal's guard is still registered

    [second] = rehearse([ARC_URL], site, profile_with(tmp_path))

    assert first.outcome == second.outcome == "ready to submit", (first.why, second.why)
    assert first.filled > 0 and second.filled == first.filled
    assert site.workers.running[0].pid == pid  # the same Chrome carried both
    assert fake.submissions == [] and not filler.submitted
    with site.open(ARC_URL, worker=0) as page:  # reused again: nothing of the last guard is left
        assert page.url == ARC_URL
        status = connection.call("guard.status", tab=page.tab)
        assert status["scripts"] == [] and status["rules"] == 0 and status["lifted"] is False
    assert [t["url"] for t in connection.call("tabs.query")] == ["about:blank"]  # its window stays, blank
    os.kill(pid, 0)  # still up until the site closes
