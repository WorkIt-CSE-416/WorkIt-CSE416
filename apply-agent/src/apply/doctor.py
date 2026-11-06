"""`apply doctor`: fast, read-only checks of what a run needs, one line each.

A missing Gmail app password or a signed-out Worker profile otherwise shows
only as Handoffs mid-run. Each check says ok, warn or fail, and how to fix
it; any fail makes `apply doctor` exit non-zero. No check submits, pushes
or opens a browser, and only one writes: the WorkIt check saves the WorkIt
login again when it refreshes the access token (Supabase rotates the
refresh token on each use)."""

import json
import os
import plistlib
import subprocess
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TextIO

from apply import cover_letter, gates, native_host, resume_check
from apply.adapters import Mailbox, Tracker, Usage
from apply.browsers import (
    CHROME,
    WORKER_PROFILES,
    WorkerBrowsers,
    google_account,
    in_use,
    web_google_account,
)
from apply.fill_engine import ENGINE
from apply.gmail import live_mailbox
from apply.home import CODE
from apply.model import Status
from apply.orchestrator import SUBMITTING
from apply.plain import extension as worker_extension
from apply.plain.launcher import SEED, developer_mode
from apply.profile import ApplicantProfile, load_policies
from apply.records import BRANCH, CLONE
from apply.tracker import FileTracker
from apply.workit import (
    SHOWN,
    LoginExpired,
    Unreachable,
    WaitingWrites,
    WorkIt,
    cap_wait,
)

OK, WARN, FAIL = "ok", "warn", "fail"


@dataclass(frozen=True)
class Check:
    name: str
    level: str  # OK, WARN or FAIL
    detail: str
    fix: str = ""

    def line(self) -> str:
        return f"{self.level:<4}  {self.name}: {self.detail}" + (f"; fix: {self.fix}" if self.fix else "")


@dataclass(frozen=True)
class NoProfile:
    """An Applicant profile that didn't load: the checks that need it say so, and every other check still runs."""

    path: Path
    why: str


def load_profile(path: Path) -> "ApplicantProfile | NoProfile":
    if not path.is_file():
        return NoProfile(path, f"no Applicant profile at {path}")
    try:
        return ApplicantProfile.load(path)
    except Exception as e:
        return NoProfile(path, f"{path} doesn't load: {type(e).__name__}: {' '.join(str(e).split())[:200]}")


@dataclass(frozen=True)
class Machine:
    """What the checks look at: live by default (cli.live_machine), fakes in tests."""

    profile: "ApplicantProfile | NoProfile"
    chrome: Path = CHROME  # Chrome's Info.plist
    claude: Callable[[], str] = lambda: claude_auth_status()  # `claude auth status`'s output
    profiles: Path = field(default_factory=lambda: WorkerBrowsers().profiles)  # the Worker profiles' folder
    mailbox: Callable[[str], Mailbox] = live_mailbox  # Gmail for an address
    tracker: Callable[[], Tracker] = FileTracker  # Apply's Tracker file in the data folder
    # The Records repo: its remote and GitRecords' clone of it. None: policies.yaml's records_remote, and CLONE.
    records: tuple[str | None, Path] | None = None
    engine: Path = ENGINE  # the Fill engine's built bundle
    # Where Playwright keeps the Chromium the tests run (live runs use Chrome).
    playwright: Path = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or Path.home() / "Library/Caches/ms-playwright")
    workit: Callable[[], WorkIt] = WorkIt  # the WorkIt client, with the login in the data folder
    waiting_writes: Callable[[], WaitingWrites] = WaitingWrites  # the writes to the Applications Tracker still waiting
    usage: Usage | None = None  # read only when asked (`--usage`): reading it costs a tiny Haiku call
    native_hosts: Path = native_host.CHROME_HOSTS  # everyday Chrome's NativeMessagingHosts folder
    resume_check: Callable = resume_check.compare  # the resume against policies.yaml's resume_source


def diagnose(machine: Machine) -> list[Check]:
    checks: list[Callable[[Machine], Check | list[Check]]] = [_claude, _chrome, _engine, _chromium, _workers, _facts, _resume_gate, _resume_source, _gmail, _records, _live_runs, _workit, _writes, _tracker, _accounts_host]
    return [found for c in checks for found in _safely(c, machine)]


def run(machine: Machine, out: TextIO) -> int:
    """Print every check's line; the exit code is 1 if any failed."""
    checks = diagnose(machine)
    for c in checks:
        print(c.line(), file=out)
    return 1 if any(c.level == FAIL for c in checks) else 0


def _safely(check: Callable[[Machine], Check | list[Check]], machine: Machine) -> list[Check]:
    try:
        found = check(machine)
    except Exception as e:  # a check that breaks is a failed check, never a crash
        return [Check(check.__name__.strip("_"), FAIL, f"{type(e).__name__}: {e}")]
    return found if isinstance(found, list) else [found]


def claude_auth_status() -> str:
    """What `claude auth status` prints, run as a run's calls are: without
    ANTHROPIC_API_KEY, which would win over the Max login."""
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    done = subprocess.run(["claude", "auth", "status"], env=env, capture_output=True, text=True, timeout=30)
    return done.stdout or done.stderr


def _claude(machine: Machine) -> Check:
    try:
        said = machine.claude()
    except FileNotFoundError:
        return Check("claude", FAIL, "the claude CLI isn't installed",
                     "install Claude Code (https://claude.com/claude-code) so `claude` is on PATH")
    try:
        status = json.loads(said)
    except ValueError:
        return Check("claude", FAIL, f"`claude auth status` said: {' '.join(said.split())[:200]}",
                     "make sure `claude auth status` works in this shell")
    if not status.get("loggedIn"):
        return Check("claude", FAIL, "the claude CLI isn't logged in", "run `claude auth login` with your own Claude plan")
    plan = status.get("subscriptionType") or status.get("authMethod")
    login = f"logged in as {status['email']} ({plan})" if status.get("email") else f"logged in ({plan})"
    if machine.usage is None:
        return Check("claude", OK, login)
    usage = machine.usage.reading()
    if usage.limited:
        until = usage.resets_at.strftime("%a %H:%M") if usage.resets_at else "Claude didn't say when"
        return Check("claude", WARN, f"{login}; the usage limit is hit until {until}",
                     "wait for the reset: a run pauses every Worker till then")
    return Check("claude", OK, f"{login}; {usage.five_hour:.0%} of the 5-hour window used, "
                               f"{usage.weekly:.0%} of the week")


def _chrome(machine: Machine) -> Check:
    try:
        version = plistlib.loads(machine.chrome.read_bytes())["CFBundleShortVersionString"]
    except (OSError, KeyError, plistlib.InvalidFileException):
        return Check("Chrome", FAIL, f"Google Chrome isn't installed (no {machine.chrome})",
                     "install it from https://www.google.com/chrome/")
    return Check("Chrome", OK, version)


def _engine(machine: Machine) -> Check:
    if not machine.engine.is_file():
        return Check("Fill engine", FAIL, f"no bundle at {machine.engine}",
                     "run `git submodule update --init` from the checkout (you need read access to the fill-engine repo)")
    return Check("Fill engine", OK, str(machine.engine))


def _chromium(machine: Machine) -> Check:
    """Only the tests need it: a warning, never a fail."""
    if not any(machine.playwright.glob("chromium-*")):
        return Check("Chromium for tests", WARN, f"not installed in {machine.playwright}; runs use Chrome, the browser "
                                                  "tests can't run", "run `uv run playwright install chromium` in apply-agent/")
    return Check("Chromium for tests", OK, f"installed in {machine.playwright}")


SIGN_IN = ("sign in to Google by hand, in a Chrome started with --user-data-dir={} --use-mock-keychain "
           "--password-store=basic (docs/accounts-setup.md, step 3)")


PLAIN_SEED = "run `uv run apply plain seed` once no plain Worker runs, and follow its steps (docs/plain-workers/guide.md)"


def _workers(machine: Machine) -> list[Check]:
    """The Workers policies.yaml's worker_mode runs: CDP Workers' profiles (cdp), the plain seed and its
    worker extension (plain), or both (protected: plain only on the hosts that block CDP)."""
    mode = _policy(machine, "worker_mode") or "cdp"
    return ([] if mode == "plain" else _worker_profiles(machine)) + ([] if mode == "cdp" else [_plain_seed(machine)])


def _plain_seed(machine: Machine) -> Check:
    """The seed profile every plain Worker starts as a copy of, with the worker extension Load unpacked
    registered in it, read from its files on disk. Chrome for Testing loads the extension itself."""
    name = "Plain seed"
    if (os.environ.get("APPLY_PLAIN_CHROME") or _policy(machine, "plain_chrome") or "chrome") == "testing":
        return Check(name, OK, "not needed: Chrome for Testing loads the worker extension itself (plain_chrome: testing)")
    seed = machine.profiles / SEED
    if not seed.is_dir():
        return Check(name, FAIL, f"no seed profile at {seed}", PLAIN_SEED)
    if not (folder := worker_extension.loaded_folder(seed)):
        return Check(name, FAIL, f"the worker extension isn't installed in {seed}", PLAIN_SEED)
    if not developer_mode(seed):
        return Check(name, WARN, f"Developer mode is off in {seed}, so Chrome disables the worker extension "
                                 "when it reloads", PLAIN_SEED)
    return Check(name, OK, f"the worker extension is installed, from {folder}")


def _worker_profiles(machine: Machine) -> list[Check]:
    """Read from each profile's files on disk; Chrome is never opened. A
    profile a browser has open (a run or a rehearsal) is skipped."""
    workers = sorted(p for p in machine.profiles.glob(WORKER_PROFILES) if p.is_dir())
    if not workers:
        return [Check("Worker profiles", FAIL, f"none in {machine.profiles}", SIGN_IN.format(machine.profiles / "worker-1"))]
    busy = [p for p in workers if in_use(p)]
    accounts = {p: google_account(p) for p in workers if p not in busy}
    web = {p: web_google_account(p) for p in workers if p not in busy and not accounts[p]}
    source = next((p for p, account in accounts.items() if account), None)
    checks = []
    for p in workers:
        if p in busy:
            checks.append(Check(p.name, WARN, "in use by another browser (a run or rehearsal?), skipped"))
        elif accounts[p]:
            checks.append(Check(p.name, OK, f"signed in to Google as {accounts[p]}"))
        elif web[p]:
            checks.append(Check(p.name, WARN, f"Google's pages list {web[p]}, but Chrome itself isn't signed in, so "
                                              "the files can't say if that session is still good",
                                SIGN_IN.format(p) + ", if a run hands off saying Google asked for more"))
        elif source or busy:
            copy = f"a run copies {source.name} over it" if source else "a run copies a signed-in profile over it"
            checks.append(Check(p.name, WARN, f"not signed in to Google; {copy}"))
        else:
            checks.append(Check(p.name, FAIL, "not signed in to Google, and no Worker profile is", SIGN_IN.format(p)))
    return checks


# Facts nearly every form asks (applicant-profile.template.yaml's freq notes): blank,
# each would be a Missing fact on most Applications.
REQUIRED = [
    "identity.legal_first_name", "identity.legal_last_name", "identity.email", "identity.phone",
    "identity.current_location.city", "identity.current_location.state", "identity.current_location.country",
    "files.resume_pdf", "links.linkedin_url",
    "education.school", "education.degree", "education.expected_graduation",
    "work_authorization.authorized_to_work_us", "work_authorization.requires_sponsorship_now_or_future",
]


TEMPLATE = CODE / "applicant-profile.template.yaml"


def _facts(machine: Machine) -> Check:
    if isinstance(machine.profile, NoProfile):
        return Check("Applicant profile", FAIL, machine.profile.why,
                     "run one `uv run apply rehearse <url>` to start on the Test Person sample data, or copy "
                     f"{TEMPLATE} to {machine.profile.path} and fill it in (README.md)")
    blank = [key for key in REQUIRED if machine.profile.get(key) in (None, "", [], {})]
    resume = machine.profile.get("files.resume_pdf")
    if resume and not Path(resume).is_file():
        blank.append(f"files.resume_pdf (no file at {resume})")
    if blank:
        return Check("Applicant profile", FAIL, f"blank: {', '.join(blank)}",
                     f"fill them in the Applicant profile in {machine.profile.folder}")
    return Check("Applicant profile", OK, f"all {len(REQUIRED)} required facts filled")


def _resume_gate(machine: Machine) -> Check:
    """The not-on-resume gate (gates.on_resume) reads the resume PDF's text; with none it passes every answer."""
    name = "Not-on-resume gate"
    if isinstance(machine.profile, NoProfile):
        return Check(name, WARN, "unchecked: no Applicant profile to read the resume from")
    resume = machine.profile.get("files.resume_pdf")
    if resume is None:
        return Check(name, WARN, "off: the Applicant profile names no resume PDF (files.resume_pdf)",
                     "set files.resume_pdf to your resume PDF")
    words = gates.resume_words(Path(resume))
    if not words:
        return Check(name, WARN, f"off: no text reads from {resume}", "export the resume as a PDF with real text, not an image")
    return Check(name, OK, f"on: {len(words)} words read from {resume}")


def _resume_source(machine: Machine) -> list[Check]:
    """The profile's resume against policies.yaml's resume_source. Unset, there is no such check and no line."""
    source = _policy(machine, "resume_source")
    if not source:
        return []
    name = "Resume"
    if isinstance(machine.profile, NoProfile):
        return [Check(name, WARN, "unchecked: no Applicant profile to read the resume from")]
    verdict = machine.resume_check(source, machine.profile.get("files.resume_pdf"))
    level = {resume_check.SAME: OK, resume_check.UNKNOWN: WARN, resume_check.STALE: FAIL}[verdict.state]
    return [Check(name, level, verdict.line)]


def _gmail(machine: Machine) -> Check:
    if isinstance(machine.profile, NoProfile):
        return Check("Gmail", WARN, "unchecked: no Applicant profile to read the email from")
    address = machine.profile.get("identity.email")
    if not address:
        return Check("Gmail", FAIL, "no email to read", "fill in identity.email in the Applicant profile")
    why = machine.mailbox(address).unavailable()
    if why:
        # Optional (README step 7): without it, a verification code waits on you.
        return Check("Gmail", WARN, "off: Apply can't read verification codes from your mail", why)
    return Check("Gmail", OK, f"an app password for {address} is in Keychain")


RECORDS_SETUP = "check you can push to {} (docs/records-setup.md)"


def _records(machine: Machine) -> Check:
    """A dry-run push from GitRecords' clone, as a save pushes: it signs in
    to the remote but sends nothing. With no clone yet, the remote is read.
    With no records_remote set, Records stay in the data folder."""
    remote, clone = machine.records or (_policy(machine, "records_remote"), CLONE)
    if not remote:
        return Check("Records", WARN, "off: no records_remote in policies.yaml, so Records stay in the data folder",
                     f"to keep them in a private git repo, set `records_remote: <its URL>` in {_folder(machine) / 'policies.yaml'} "
                     "(docs/records-setup.md)")
    if not (clone / ".git").exists():
        done = _git("ls-remote", "--heads", remote)
        if done.returncode:
            return Check("Records", FAIL, f"can't read {remote}: {_said(done)}", RECORDS_SETUP.format(remote))
        return Check("Records", WARN, f"{remote} is readable; no clone yet, so pushing is unchecked till the "
                                            f"first Record clones it to {clone}")
    if _git("-C", str(clone), "rev-parse", "-q", "--verify", "HEAD").returncode:
        done = _git("-C", str(clone), "ls-remote", "--heads", "origin")
        if done.returncode:
            return Check("Records", FAIL, f"can't read {remote}: {_said(done)}", RECORDS_SETUP.format(remote))
        return Check("Records", WARN, "the remote is readable; no Record yet, so pushing is unchecked")
    done = _git("-C", str(clone), "push", "--dry-run", "--porcelain", "origin", f"HEAD:{BRANCH}")
    if done.returncode == 0:
        return Check("Records", OK, f"can push from {clone}")
    if "[rejected]" in done.stdout:
        return Check("Records", OK, f"can push from {clone}; it is behind the remote, which the next save "
                                          "pulls first")
    return Check("Records", FAIL, f"can't push from {clone}: {_said(done)}", RECORDS_SETUP.format(remote))


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], capture_output=True, text=True, timeout=30,
                          env=os.environ | {"GIT_TERMINAL_PROMPT": "0"})  # never wait on a password prompt


def _said(done: subprocess.CompletedProcess) -> str:
    return " ".join((done.stderr or done.stdout).split())[-300:]


def _policy(machine: Machine, key: str):
    """A policy as the profile reads it, or the defaults' (with the data folder's policies.yaml) without one."""
    if isinstance(machine.profile, NoProfile):
        return load_policies().get(key)
    return machine.profile.policy(key)


def _live_runs(machine: Machine) -> Check:
    """On is the one switch that sends applications, so doctor warns while it is."""
    if _policy(machine, "live_runs") is not True:
        return Check("live_runs", OK, "off: apply run and approve-pass refuse to start (rehearsals still work)")
    who = "the applicant" if isinstance(machine.profile, NoProfile) else cover_letter.name(machine.profile)
    return Check("live_runs", WARN, f"on: apply run submits real applications as {who}",
                 f"set `live_runs: false` in {_folder(machine) / 'policies.yaml'} unless you mean to send them")


def _folder(machine: Machine) -> Path:
    return machine.profile.path.parent if isinstance(machine.profile, NoProfile) else machine.profile.folder


LOGIN = "run `uv run apply login`"


def _workit(machine: Machine) -> Check:
    """Optional, as Gmail is: only Apply's writes to the Applications Tracker need the login."""
    client = machine.workit()
    if not client.logged_in():
        return Check("WorkIt", WARN, "off: not logged in, so Apply can't write to your Applications Tracker "
                                     "(rehearsals work without it)", f"{LOGIN} if you have a WorkIt student account")
    try:
        account = client.me()
    except LoginExpired:
        return Check("WorkIt", WARN, "the login expired or was signed out", f"{LOGIN} again")
    except Unreachable as e:
        return Check("WorkIt", WARN, f"can't reach WorkIt ({e})",
                     f"check your network, and that {client.site.api} answers; Apply's login is still kept")
    if account.account_type != "applicant":
        return Check("WorkIt", WARN, f"logged in as {account.email}, a {account.account_type} account",
                     f"{LOGIN} with a student account: the Applications Tracker needs one")
    return Check("WorkIt", OK, f"logged in as {account.email}")


def _writes(machine: Machine) -> Check:
    """The writes to the Applications Tracker that could not reach WorkIt yet (KAN-544). Read-only."""
    waiting = machine.waiting_writes().waiting()
    if not waiting:
        return Check("WorkIt writes", OK, "none waiting")
    return Check("WorkIt writes", WARN, f"{len(waiting)} waiting to send to your Applications Tracker: "
                 + ", ".join(f"{w.company} ({', '.join(filter(None, [SHOWN[w.stage], cap_wait(w)]))})" for w in waiting),
                 "they go at the next run or rehearsal; if the WorkIt line says the login expired, "
                 f"{LOGIN} first")


def _tracker(machine: Machine) -> list[Check]:
    """Apply's Tracker file, read once, and from its rows how far the Calibration run is."""
    try:
        rows = machine.tracker().rows()
    except Exception as e:
        return [Check("Tracker", FAIL, f"its rows don't read: {type(e).__name__}: {e}",
                      "a run reads the same rows when it starts and would stop there too"),
                Check("Calibration run", WARN, "unknown: the Tracker doesn't read")]
    return [Check("Tracker", OK, f"{len(rows)} Applications"), _calibration(machine, rows)]


def _calibration(machine: Machine, rows) -> Check:
    """As the Orchestrator counts it: every row held or submitted (or being submitted)."""
    size = _policy(machine, "calibration_run") or 0
    filled = sum(1 for r in rows if r.status in (Status.HELD, Status.SUBMITTED) or r.reason == SUBMITTING)
    if not size:
        return Check("Calibration run", OK, "off: no Application is held to calibrate")
    if filled >= size:
        return Check("Calibration run", OK, f"done: {filled} of {size} Applications held or submitted")
    return Check("Calibration run", OK, f"{filled} of {size} Applications so far; "
                                        f"the next {size - filled} are held for you to judge")


def _accounts_host(machine: Machine) -> Check:
    """The Apply accounts host (KAN-592): optional, so never a fail. Without it, the WorkIt extension in
    Lisul's Chrome has no Sign In button for the Employer accounts Apply made."""
    name, fix = "Apply accounts host", "run `uv run apply chrome-passwords`"
    manifest = machine.native_hosts / f"{native_host.NAME}.json"
    try:
        written = json.loads(manifest.read_text())
    except (OSError, ValueError):
        return Check(name, WARN, f"not installed (no {manifest}): the extension can't fill Apply's Workday logins", fix)
    if written.get("allowed_origins") != [native_host.EXTENSION_ORIGIN]:
        return Check(name, WARN, f"{manifest} names other callers than the WorkIt extension", fix)
    wrapper = Path(written.get("path", ""))
    if not wrapper.is_file() or not os.access(wrapper, os.X_OK):
        return Check(name, WARN, f"its wrapper {wrapper} is gone or can't run", fix)
    return Check(name, OK, f"installed for the WorkIt extension ({native_host.EXTENSION_ID})")
