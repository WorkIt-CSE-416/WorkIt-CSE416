"""`apply sign-in <url>`: Lisul signs one Worker profile in to a site by hand,
in a Chrome window Apply opens and never types into; every Worker profile
then gets that sign-in, and Postings behind that site's wall fill as usual."""

import io
import os
import sys

import pytest

from apply import cli
from apply.adapters import Adapters
from apply.browsers import WorkerBrowsers

TIKTOK = "https://lifeattiktok.com/search/7668642761473902901"


class OfflineBrowsers(WorkerBrowsers):
    """Worker profiles in a scratch folder whose sign-in window is a headless
    browser on a local page standing in for the site: nothing reaches it."""

    def __init__(self, folder):
        super().__init__(folder / "profiles", headless=True, channel=None)
        self._page = folder / "site.html"
        self._page.write_text("<!doctype html><title>Sign in</title>")
        self.opened: list[str] = []

    def sign_in(self, url, until_done):
        self.opened.append(url)
        return super().sign_in(self._page.as_uri(), until_done)


def sign_in(tmp_path, monkeypatch, typed: str, browsers: OfflineBrowsers | None = None) -> OfflineBrowsers:
    """`apply sign-in TIKTOK`, Lisul typing `typed` in the terminal."""
    browsers = browsers or OfflineBrowsers(tmp_path)
    monkeypatch.setattr(sys, "stdin", io.StringIO(typed))
    cli.main(["sign-in", TIKTOK], adapters=Adapters(None, None, browsers, None, None, None, None))
    return browsers


def test_lisul_presses_enter_once_signed_in_and_every_worker_profile_gets_the_site(tmp_path, monkeypatch, capsys):
    browsers = OfflineBrowsers(tmp_path)
    for worker in (0, 1):
        with browsers.open("about:blank", worker=worker):
            pass

    sign_in(tmp_path, monkeypatch, "\ny\n", browsers)

    out = capsys.readouterr().out
    assert "Sign in to lifeattiktok.com yourself" in out and "press Enter" in out
    assert "worker-2" in out
    assert browsers.opened == [TIKTOK]
    assert browsers.signed_in() == {"lifeattiktok.com"}


def test_nothing_is_noted_when_lisul_says_he_did_not_sign_in(tmp_path, monkeypatch, capsys):
    browsers = sign_in(tmp_path, monkeypatch, "\nn\n")

    assert browsers.signed_in() == frozenset()
    assert "Nothing" in capsys.readouterr().out


def test_sign_in_refuses_while_a_worker_profile_is_open_in_another_browser(tmp_path, monkeypatch):
    busy = tmp_path / "profiles" / "worker-1"
    busy.mkdir(parents=True)
    os.symlink(f"host-{os.getpid()}", busy / "SingletonLock")

    with pytest.raises(SystemExit, match="worker-1 open in another browser"):
        sign_in(tmp_path, monkeypatch, "\ny\n")


class ClosesWindow(OfflineBrowsers):
    """Lisul closes the sign-in window instead of pressing Enter, then answers y."""

    def __init__(self, folder, answer):
        super().__init__(folder)
        self._answer = answer

    def sign_in(self, url, until_done):
        def closes(context):
            context.pages[0].close()
            until_done(context)  # returns once the window is closed, with nothing typed
            os.write(self._answer, b"y\n")
        return super().sign_in(url, closes)


def test_closing_the_window_ends_the_sign_in_too(tmp_path, monkeypatch):
    read, write = os.pipe()
    browsers = ClosesWindow(tmp_path, write)
    monkeypatch.setattr(sys, "stdin", os.fdopen(read))

    cli.main(["sign-in", TIKTOK], adapters=Adapters(None, None, browsers, None, None, None, None))

    assert browsers.signed_in() == {"lifeattiktok.com"}
