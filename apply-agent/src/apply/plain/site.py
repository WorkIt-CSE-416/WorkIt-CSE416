"""Which kind of Worker fills a form (S8, KAN-614): policies.yaml's `worker_mode`.

- `cdp` (the default): every form in a CDP Worker (apply.browsers.WorkerBrowsers), as before.
- `plain`: every form in a plain Worker (PlainSite over apply.plain.launcher.PlainWorkers).
- `protected`: a plain Worker only for the protected hosts, a CDP Worker for the rest
  (RoutedSite). The protected hosts are policies.yaml's `plain_worker_hosts` (Lever,
  SmartRecruiters and Workable by default) and each host a bot block was seen on
  (`learn`, kept in APPLY_HOME/plain-hosts.json).

A plain Worker's Chrome stays up across the Applications it carries: PlainSite.open reuses it,
with every guard of the last one taken off (guards.reset) and the last one's tabs closed, and
close() stops each Chrome by its PID when the run or rehearsal ends.
"""

import json
import threading
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from apply.browsers import BUSY, ProfileInUse, WorkerBrowsers, in_use
from apply.home import HOME
from apply.plain import guards
from apply.plain.launcher import WINDOW, PlainWorkers
from apply.profile import load_policies

MODES = ("cdp", "plain", "protected")
LEARNED = HOME / "plain-hosts.json"  # each host a bot block was seen on, for `protected`
BLANK = "about:blank"


def mode(policies: dict | None = None) -> str:
    """policies.yaml's worker_mode: cdp, plain or protected."""
    chosen = (policies if policies is not None else load_policies()).get("worker_mode") or "cdp"
    if chosen not in MODES:
        raise ValueError(f"worker_mode must be one of {', '.join(MODES)}, not {chosen!r}")
    return chosen


def host_of(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


def learned(path: Path | None = None) -> list[str]:
    try:
        path = path or LEARNED
        return [h for h in json.loads(path.read_text()) if isinstance(h, str)]
    except (OSError, ValueError, TypeError):
        return []


def learn(url: str, path: Path | None = None) -> None:
    """A bot block was seen on `url`'s host: its next forms go to a plain Worker in `protected` mode."""
    path, host = path or LEARNED, host_of(url)
    if not host or protected(url, hosts=learned(path)):
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(sorted({*learned(path), host}), indent=1) + "\n")


def protected(url: str, policies: dict | None = None, hosts: list[str] | None = None) -> bool:
    """Whether `url` is on a protected host: one of `hosts` (default: plain_worker_hosts and the
    learned ones), or a subdomain of one."""
    if hosts is None:
        hosts = [*((policies if policies is not None else load_policies()).get("plain_worker_hosts") or []), *learned()]
    host = host_of(url)
    return any(host == h or host.endswith("." + h) for h in (str(h).lower().removeprefix("www.") for h in hosts))


class PlainSite:
    """The live JobSite on plain Workers, in WorkerBrowsers' shape. A Worker's Chrome is started
    on its first form and reused for each one after (its guards reset), until close()."""

    def __init__(self, workers: PlainWorkers | None = None, fetcher: WorkerBrowsers | None = None):
        self.workers = workers or PlainWorkers()
        self._fetcher = fetcher or WorkerBrowsers(headless=True)
        self.profiles = self.workers.profiles
        self._launching = threading.Lock()  # one Chrome starts at a time (its bridge, its focus watch)

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        return self._fetcher.fetch(url, body)

    def seed(self, count: int) -> list[Path]:
        return []  # a plain Worker's profile is a copy of the plain seed (`apply plain seed`), made at launch

    def signed_in(self) -> frozenset[str]:
        return frozenset()  # `apply sign-in` signs the CDP Workers' profiles in, not these

    def refuse_in_use(self) -> None:
        busy = [p.name for p in sorted(self.profiles.glob("plain-[0-9]*")) if p.is_dir() and in_use(p)]
        if busy:
            raise ProfileInUse(f"{', '.join(busy)} {BUSY}")

    def connection(self, worker: int):
        """Worker `worker`'s port, None while it has none (the tile's PortFrames)."""
        return self.workers.bridge.connection(worker)

    def endpoint(self, worker: int) -> None:
        return None  # no CDP

    def show(self, worker: int) -> bool:
        """Only Lisul's own Show brings a plain Worker forward."""
        return self.workers.show(worker)

    def plain(self, worker: int) -> bool:
        return True

    @contextmanager
    def open(self, url: str, worker: int = 0):
        """Worker `worker`'s page at `url`: in its running Chrome, guards reset, else a new Chrome.
        The page's tabs close after, leaving one blank tab so its window stays."""
        from apply.plain.page import PortContext

        running = self.workers.running.get(worker)
        if running and running.connection.closed.is_set():  # it quit or its port closed: a new one
            self.workers.stop(worker)
            running = None
        if running:
            guards.reset(running.connection)  # the last Application's guards, lifts and bindings go
        else:
            with self._launching:
                running = self.workers.launch(worker)
        connection = running.connection
        context = PortContext(connection)
        before = [t["tab"] for t in connection.call("tabs.query")]
        if before:
            page = context.new_page()
        else:  # Lisul closed its window: a new one, unfocused, where Workers sit
            x, y = self.workers.position(worker)
            page = context.page(connection.call("windows.create", left=x, top=y, width=WINDOW[0], height=WINDOW[1])["tab"])
        for tab in before:
            context.page(tab).close()
        try:
            page.goto(url)
            yield page
        finally:
            _leave_blank(context)

    def close(self) -> None:
        """Stop every plain Worker's Chrome this site started, by its PID."""
        self.workers.stop_all()


def _leave_blank(context) -> None:
    """Close the Application's tabs, keeping one blank tab so the Worker's window stays."""
    if context.worker.closed.is_set():
        return
    try:
        tabs = [t["tab"] for t in context.worker.call("tabs.query")]
        if not tabs:
            return
        blank = context.worker.call("tabs.create", url=BLANK, active=True)["tab"]
        for tab in tabs:
            context.page(tab).close()
        context.page(blank)
    except Exception:
        pass  # its Chrome quit meanwhile: the next open starts a new one


class RoutedSite:
    """`protected` mode: a protected host's form in a plain Worker, any other in a CDP Worker.
    Worker k keeps one number either way: its tile shows whichever it runs now."""

    def __init__(self, cdp: WorkerBrowsers, plain: PlainSite, policies: dict | None = None):
        self.cdp, self.plain_site = cdp, plain
        self.profiles = cdp.profiles
        self._policies = policies
        self._plain: dict[int, bool] = {}  # Worker k's current form is on a plain Worker

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        return self.cdp.fetch(url, body)

    def seed(self, count: int) -> list[Path]:
        return self.cdp.seed(count)

    def signed_in(self) -> frozenset[str]:
        return self.cdp.signed_in()

    def refuse_in_use(self) -> None:
        self.cdp.refuse_in_use()
        self.plain_site.refuse_in_use()

    def plain(self, worker: int) -> bool:
        return self._plain.get(worker, False)

    def connection(self, worker: int):
        return self.plain_site.connection(worker) if self.plain(worker) else None

    def endpoint(self, worker: int) -> str | None:
        return None if self.plain(worker) else self.cdp.endpoint(worker)

    def show(self, worker: int) -> bool:
        return (self.plain_site if self.plain(worker) else self.cdp).show(worker)

    @contextmanager
    def open(self, url: str, worker: int = 0):
        plain = protected(url, self._policies)
        if not plain:
            self.plain_site.workers.stop(worker)  # its plain Chrome, if the last form had one, makes way
        self._plain[worker] = plain
        with (self.plain_site if plain else self.cdp).open(url, worker=worker) as page:
            yield page

    def close(self) -> None:
        self.plain_site.close()


def live_site(policies: dict | None = None):
    """The JobSite worker_mode names."""
    policies = policies if policies is not None else load_policies()
    chosen = mode(policies)
    cdp = lambda: WorkerBrowsers(headless=policies.get("worker_headless") is not False)
    if chosen == "cdp":
        return cdp()
    if chosen == "plain":
        return PlainSite()
    return RoutedSite(cdp(), PlainSite(), policies)
