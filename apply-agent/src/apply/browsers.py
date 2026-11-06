"""The live JobSite: the job systems' servers, and the Workers' own browsers.

Each Worker fills forms in real Chrome, headless unless policies.yaml's
worker_headless says otherwise, on its own persistent Worker profile
(profiles/worker-N); Lisul watches every Worker live in the dashboard
instead of in windows of their own. Lisul signs each profile in to Google once
by hand. A persistent profile can be open in only one browser at a time, and
each Worker carries one Application at a time, so they never collide.
Playwright launches Chrome with --use-mock-keychain --password-store=basic,
so Lisul must sign in through a Chrome started with those flags too. It also
starts Chrome with --disable-blink-features=AutomationControlled: Chrome sets
navigator.webdriver whenever DevTools is on, and Google's sign-in then refuses
Sign in with Google ("This browser or app may not be secure").

Each Worker's Chrome also listens for the Chrome DevTools Protocol on a free
local port, so Claude fill's Playwright MCP can work the very
page the Worker opened, in its Worker profile (cdp_endpoint).
"""

import base64
import binascii
import json
import os
import plistlib
import re
import shutil
import time
import urllib.request
from collections.abc import Callable
from contextlib import contextmanager, nullcontext
from pathlib import Path

from playwright.sync_api import BrowserContext, Page, sync_playwright

from apply import submit_guard, trace
from apply.focus import KEEPER
from apply.home import HOME
from apply.profile import load_policies

PROFILES = HOME / "profiles"
# A Worker's profile folder: worker-1 and on. APPLY_PROFILES/worker-extension is the plain Workers' extension, not a profile.
WORKER_PROFILES = "worker-[0-9]*"
# Each open page's CDP endpoint, by id(page), while it is open.
_ENDPOINTS: dict[int, str] = {}
# The open pages, by id(page), that show in a Chrome window of their own (worker_headless: false).
_HEADED: set[int] = set()
# How Playwright says Chrome cut a Worker's first load short as it started: it is tried again.
_CUT_SHORT = re.compile(r"ERR_ABORTED|interrupted by another navigation")

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"


# Keeps navigator.webdriver false while Chrome listens for DevTools (Chrome 156 sets it for a port or a pipe).
NOT_WEBDRIVER = "--disable-blink-features=AutomationControlled"
VIEWPORT = {"width": 1280, "height": 800}  # a dashboard tile's shape on a laptop screen
CHROME = Path("/Applications/Google Chrome.app/Contents/Info.plist")


def chrome_user_agent(info: Path = CHROME) -> str:
    """Installed Chrome's own user agent. Headless Chrome says "HeadlessChrome",
    which job sites' bot checks look for; the Worker says what a window would."""
    try:
        major = plistlib.loads(info.read_bytes())["CFBundleShortVersionString"].split(".")[0]
    except (OSError, KeyError, plistlib.InvalidFileException):
        major = "141"
    return ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
            f"Chrome/{major}.0.0.0 Safari/537.36")


# Beside the Worker profiles: the sites Lisul signed them in to by hand (apply sign-in).
SIGNED_IN = "signed-in.json"
# Left out when a Worker profile is copied: the running browser's locks and port, caches,
# and any password Chrome saved (Apply never keeps one).
NOT_COPIED = shutil.ignore_patterns("Singleton*", "DevToolsActivePort", "RunningChromeVersion", "*Cache*", "*cache*",
                                    "BrowserMetrics*", "Login Data*")


def google_account(profile: Path) -> str | None:
    """The Google account a Worker profile is signed in to, if any."""
    try:
        preferences = json.loads((profile / "Default" / "Preferences").read_text())
    except (OSError, ValueError):
        return None
    return next((a["email"] for a in preferences.get("account_info", []) if a.get("email")), None)


EMAIL = re.compile(rb"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def web_google_account(profile: Path) -> str | None:
    """The Google account a Worker profile's Google pages list, from Chrome's
    last ListAccounts answer (a base64 protobuf in Preferences), if any. Unlike
    `google_account`, this needs no sign-in to Chrome itself, only to Google on
    the web, which is what Google's account chooser offers. Read from disk, it
    may be stale: Google may have signed the session out since."""
    try:
        preferences = json.loads((profile / "Default" / "Preferences").read_text())
        listed = base64.b64decode(preferences.get("gaia_cookie", {}).get("last_list_accounts_binary_data", ""))
    except (OSError, ValueError, binascii.Error, AttributeError):
        return None
    found = EMAIL.search(listed)
    return found.group().decode() if found else None


BUSY = "open in another browser (an Apply run or rehearsal?): try again once it ends"


def in_use(profile: Path) -> bool:
    """Whether a browser has the profile open: Chrome's SingletonLock names its pid."""
    return chrome_pid(profile) is not None


def chrome_pid(profile: Path) -> int | None:
    """The pid of the Chrome that has the profile open, if one does."""
    try:
        pid = int(os.readlink(profile / "SingletonLock").rsplit("-", 1)[1])
        os.kill(pid, 0)
    except (OSError, ValueError, IndexError):
        return None
    return pid


class WorkerBrowsers:
    def __init__(self, profiles: Path | None = None, headless: bool | None = None, channel: str | None = "chrome"):
        """`profiles` defaults to $APPLY_PROFILES, else $APPLY_HOME/profiles, so any
        checkout can use the Worker profiles Lisul signed in to Google.
        `headless` defaults to policies.yaml's worker_headless (true if unset)."""
        self._profiles = profiles or Path(os.environ.get("APPLY_PROFILES") or PROFILES)
        self.profiles = self._profiles
        self._headless = headless if headless is not None else load_policies().get("worker_headless") is not False
        self._channel = channel

    def seed(self, count: int) -> list[Path]:
        """Sign the first `count` Worker profiles in to Google as Lisul signed one
        in by hand: each profile without his account (a rehearsal of more links
        than Workers needs more) becomes a copy of a signed-in one. Only profiles
        no browser has open are copied or replaced. Returns those seeded."""
        source = next((p for p in sorted(self._profiles.glob(WORKER_PROFILES)) if google_account(p) and not in_use(p)), None)
        if source is None:
            return []
        seeded = []
        for n in range(1, count + 1):
            profile = self._profiles / f"worker-{n}"
            if google_account(profile) or in_use(profile):
                continue
            _copy(source, profile)
            seeded.append(profile)
        return seeded

    def sign_in(self, url: str, until_done: Callable[[BrowserContext], None]) -> Path:
        """Open a Worker profile's Chrome at `url` for Lisul to sign in to the
        site by hand, and close it once `until_done(context)` returns. Apply
        never types into it. The profile is the one signed in to Google (so
        sharing it signs every Worker in to both), else worker-1. Returns it."""
        profile = next((p for p in self._workers() if google_account(p)), self._profiles / "worker-1")
        self.refuse_in_use()
        _no_saved_passwords(profile)
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(profile, **self.launch_options(0))
            try:
                page = context.pages[0] if context.pages else context.new_page()
                page.goto(url)
                until_done(context)
            finally:
                context.close()
        return profile

    def share(self, source: Path) -> list[Path]:
        """Make every other Worker profile a copy of `source`, as `seed` does,
        so each is signed in to whatever `source` is. Returns those copied."""
        self.refuse_in_use()
        copied = [p for p in self._workers() if p != source]
        for profile in copied:
            _copy(source, profile)
        return copied

    def signed_in_to(self, site: str) -> None:
        """Note that Lisul signed the Worker profiles in to `site` (walls.site) by hand."""
        sites = sorted(self.signed_in() | {site})
        self._profiles.mkdir(parents=True, exist_ok=True)
        (self._profiles / SIGNED_IN).write_text(json.dumps(sites, indent=1) + "\n")

    def signed_in(self) -> frozenset[str]:
        """The sites Lisul signed the Worker profiles in to by hand. Only their
        names are kept: never a password."""
        try:
            return frozenset(json.loads((self._profiles / SIGNED_IN).read_text()))
        except (OSError, ValueError):
            return frozenset()

    def _workers(self) -> list[Path]:
        return sorted(p for p in self._profiles.glob(WORKER_PROFILES) if p.is_dir())

    def profiles_made(self) -> list[Path]:
        """The Worker profiles on disk. Nothing opens them."""
        return self._workers()

    def refuse_in_use(self) -> None:
        """A persistent profile can be open in only one browser at a time."""
        busy = [p.name for p in self._workers() if in_use(p)]
        if busy:
            raise ProfileInUse(f"{', '.join(busy)} {BUSY}")

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        """A GET, or with `body` a JSON POST that only reads (Ashby's GraphQL query)."""
        headers = {"User-Agent": USER_AGENT} | ({"Content-Type": "application/json"} if body else {})
        request = urllib.request.Request(url, data=body, headers=headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read()

    @contextmanager
    def open(self, url: str, worker: int = 0):
        # Playwright's sync API is bound to one thread, so each Worker's thread
        # starts its own.
        with sync_playwright() as playwright:
            profile = self._profiles / f"worker-{worker + 1}"
            if in_use(profile):  # another run's or rehearsal's browser: leave it and its port alone
                raise ProfileInUse(f"{profile.name} {BUSY}")
            (profile / "DevToolsActivePort").unlink(missing_ok=True)
            # A window that comes forward as it starts goes back behind Lisul's app, as does each tab or pop-up later.
            with nullcontext() if self._headless else KEEPER.launching():
                context = playwright.chromium.launch_persistent_context(profile, **self.launch_options(worker))
                pid = None if self._headless else chrome_pid(profile)
                if pid:
                    KEEPER.watch(pid)
            endpoint = f"http://127.0.0.1:{_port(profile)}"
            trace.watch(context)
            page = context.pages[0] if context.pages else context.new_page()
            try:
                for tries_left in (2, 1, 0):
                    try:
                        submit_guard.on_open(page)  # a rehearsal's page: guarded before its first load
                        page.goto(url)
                        break
                    except Exception as error:
                        if not tries_left:
                            raise
                        if page.is_closed():
                            page = context.new_page()  # Chrome replaced its first tab as it started (seen live)
                        elif not _CUT_SHORT.search(str(error)):
                            raise
                        # else Chrome cut the first load short as it started: restoring its last tabs (Shield AI,
                        # live), or with a navigation of its own to about:blank (PDT Partners, 2026-11-04)
                _ENDPOINTS[id(page)] = endpoint
                if not self._headless:
                    _HEADED.add(id(page))
                yield page
            finally:
                _ENDPOINTS.pop(id(page), None)
                _HEADED.discard(id(page))
                if pid:
                    KEEPER.forget(pid)
                context.close()

    def launch_options(self, worker: int) -> dict:
        """How Worker `worker`'s Chrome is launched: real Chrome, headless by
        default (policies.yaml: worker_headless; a minimized or off-screen window stops painting on macOS, and
        the dashboard shows the page anyway), with Chrome's sandbox on
        (Playwright turns it off by default, and Chrome then shows an
        "unsupported command-line flag" bar)."""
        return {
            "channel": self._channel,
            "headless": self._headless,
            "chromium_sandbox": True,
            "viewport": VIEWPORT,
            "user_agent": chrome_user_agent(),
            "args": [
                "--remote-debugging-port=0",  # Chrome picks a free port and writes it to DevToolsActivePort
                "--hide-crash-restore-bubble",  # a Worker stopped mid-run must not offer to restore its tabs
                # Any DevTools port or pipe sets navigator.webdriver, and Google's sign-in then refuses
                # Sign in with Google ("This browser or app may not be secure", KLA, 2026-11-03).
                NOT_WEBDRIVER,
            ],
        }

    def show(self, worker: int) -> bool:
        """Bring Worker `worker`'s Chrome window to the front, as Lisul asked
        in the Apply window; False if it has none (headless, or not open)."""
        pid = None if self._headless else chrome_pid(self._profiles / f"worker-{worker + 1}")
        return bool(pid) and KEEPER.bring(pid)

    def endpoint(self, worker: int) -> str | None:
        """Where another client (the dashboard) can reach Worker `worker`'s
        browser over CDP, while it is open."""
        try:
            return f"http://127.0.0.1:{int((self._profiles / f'worker-{worker + 1}' / 'DevToolsActivePort').read_text().split()[0])}"
        except (OSError, ValueError, IndexError):
            return None


class ProfileInUse(Exception):
    """A Worker profile is open in another browser."""


def _no_saved_passwords(profile: Path) -> None:
    """Turn off Chrome's offer to save a password in `profile`, before Lisul signs in there."""
    preferences = profile / "Default" / "Preferences"
    try:
        settings = json.loads(preferences.read_text())
    except (OSError, ValueError):
        settings = {}
    settings["credentials_enable_service"] = False
    settings.setdefault("profile", {})["password_manager_enabled"] = False
    preferences.parent.mkdir(parents=True, exist_ok=True)
    preferences.write_text(json.dumps(settings))


def _copy(source: Path, profile: Path) -> None:
    shutil.rmtree(profile, ignore_errors=True)
    shutil.copytree(source, profile, symlinks=True, ignore=NOT_COPIED)


def cdp_endpoint(page: Page) -> str:
    """Where another client (Playwright MCP) can attach to the browser of a
    page a Worker opened."""
    return _ENDPOINTS[id(page)]


def headed(page: Page) -> bool:
    """Whether a page a Worker opened shows in a Chrome window of its own."""
    return id(page) in _HEADED


def _port(profile: Path) -> int:
    active = profile / "DevToolsActivePort"
    for _ in range(100):
        if active.exists() and active.read_text().strip():
            return int(active.read_text().split()[0])
        time.sleep(0.05)
    raise RuntimeError(f"Chrome never opened its DevTools port for {profile.name}")
