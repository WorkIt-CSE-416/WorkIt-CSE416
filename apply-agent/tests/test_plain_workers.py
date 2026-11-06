"""Plain Workers live: Chrome for Testing with the worker extension, no CDP. Skips without it (CI)."""

import os
import tempfile
from pathlib import Path

import pytest

from apply.plain import demo
from apply.plain.launcher import NEVER, PlainWorkers, chrome_for_testing

try:
    chrome_for_testing()
    HAVE_CHROME = True
except FileNotFoundError:
    HAVE_CHROME = False

pytestmark = pytest.mark.skipif(not HAVE_CHROME, reason="needs Chrome for Testing (uv run playwright install chromium)")


@pytest.fixture
def workers():
    workers = PlainWorkers(Path(tempfile.mkdtemp(prefix="apw-profiles-", dir="/tmp")), kind="testing")
    yield workers
    workers.stop_all()


def test_a_plain_worker_has_no_automation_switch_and_says_hello(workers):
    running = workers.launch(0)
    command = workers.arguments(0)
    assert not any(a.startswith(NEVER) for a in command)
    assert "--disable-backgrounding-occluded-windows" in command
    hello = running.connection.hello
    assert hello["webdriver"] is False
    assert hello["engine"] == workers.bridge.engine
    assert not (running.profile / "DevToolsActivePort").exists()
    assert (running.profile / "NativeMessagingHosts" / "com.workit.apply_worker.json").exists()


def test_stop_ends_only_the_chrome_it_started(workers):
    running = workers.launch(0)
    pid = running.pid
    workers.stop(0)
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


def test_the_ping_demo_reports_each_worker(monkeypatch):
    monkeypatch.setenv("APPLY_PROFILES", tempfile.mkdtemp(prefix="apw-profiles-", dir="/tmp"))
    lines = demo.ping(2, "testing")
    assert len(lines) == 2
    assert all("navigator.webdriver: false" in line and "DevToolsActivePort: none" in line for line in lines)
