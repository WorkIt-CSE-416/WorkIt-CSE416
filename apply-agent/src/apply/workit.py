"""The WorkIt client: the one module in Apply that calls WorkIt (KAN-541).

Apply signs in to WorkIt as the student, with the same Supabase project as
WorkIt's web app and extension. `apply login` opens WorkIt's sign-in page in a
new Chrome with an empty, temporary profile. The student signs in there (password,
Google or LinkedIn). Apply reads the web app's session cookie, as the
extension does (`autofiller_extension/src/background/webapp-session.js`),
checks it with `GET /auth/me`, and closes that Chrome and deletes its
profile. Then only Apply has that session, so Apply can refresh it with no
race against the web app (the extension cannot, see its CLAUDE.md, KAN-465).

The session is kept in `APPLY_HOME/workit-login.json` (mode 0600), never in
the repo and never printed. The access token lasts about one hour; `call`
refreshes it at Supabase Auth when it expires, and saves the new refresh
token (Supabase rotates it on each use). A lock file stops two processes
from using one refresh token.

The API checks the bearer token itself (`backend/app/deps.py`,
`security.py`): the token's signature, audience and issuer, then the
account row.

The Applications Tracker's reads and writes (find or add a job by its
link, set a stage and the applied date, keep a Sent resume) are methods
that use `call`. So is the read of the student's tailored resume for a
job (KAN-547).

Apply's writes to the student's Applications Tracker (KAN-544) are `Write`s
sent through `WaitingWrites`: it adds the job by its link, sets the stage, and
for a submit keeps the file sent as the application's Sent resume. A write
that cannot reach WorkIt (no answer, or no live login) waits in
`APPLY_HOME/workit-queue.json` and goes with the next send or `flush`.
"""

import base64
import dataclasses
import email.utils
import fcntl
import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from datetime import time as dtime
from email.message import Message
from enum import StrEnum
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from apply.home import HOME

LOGIN = HOME / "workit-login.json"
# Writes to the Applications Tracker that could not reach WorkIt yet.
QUEUE = HOME / "workit-queue.json"
# Refresh an access token this many seconds before it expires, so it does not expire on its way.
EARLY = 60
TIMEOUT = 20
# Cloudflare, in front of WorkIt's API, refuses Python-urllib's own user agent (error 1010).
USER_AGENT = "WorkIt-Apply/1"
CHROME_BINARY = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


@dataclass(frozen=True)
class Site:
    """Where WorkIt is: its web app, its API, and its Supabase project (URL and public anon key)."""

    web: str
    api: str
    auth: str
    anon_key: str

    @property
    def cookie(self) -> str:
        """The web app's session cookie name, as supabase-js makes it from the Supabase URL."""
        return f"sb-{urlsplit(self.auth).hostname.split('.')[0]}-auth-token"


# The live WorkIt. The same public values as autofiller_extension/src/shared/config.js
# (test_workit_login checks this). The anon key is public by design (root CLAUDE.md).
LIVE = Site(
    web="https://workitjobs.ai",
    api="https://api.workitjobs.ai",
    auth="https://zhdrvdrojipkluhzgsea.supabase.co",
    anon_key="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZHJ2ZHJvamlwa2x1aHpnc2VhIiwicm9sZSI6"
             "ImFub24iLCJpYXQiOjE3ODgyOTU4NDksImV4cCI6MjEwMzg3MTg0OX0.fdYqIGXIXqNQXMsc9cF5_6ZHcx496SGSzheDCncAqnU",
)


def site() -> Site:
    """LIVE, or a local WorkIt that the APPLY_WORKIT_* variables name (for a developer's own stack)."""
    return Site(
        web=os.environ.get("APPLY_WORKIT_WEB") or LIVE.web,
        api=os.environ.get("APPLY_WORKIT_API") or LIVE.api,
        auth=os.environ.get("APPLY_WORKIT_AUTH") or LIVE.auth,
        anon_key=os.environ.get("APPLY_WORKIT_ANON_KEY") or LIVE.anon_key,
    )


class WorkItError(Exception):
    """WorkIt refused a call. `status` is its HTTP status, when it answered one."""

    def __init__(self, message: str = "", status: int | None = None):
        super().__init__(message)
        self.status = status


class NotLoggedIn(WorkItError):
    pass


class LoginExpired(WorkItError):
    """The session was signed out, or its refresh token was refused: sign in again."""


class Unreachable(WorkItError):
    """No answer from WorkIt (or Supabase Auth), or a server error."""


class CapReached(WorkItError):
    """WorkIt's daily cap refused the call (429; for Apply, the cap of 50 added jobs a day). `until` (epoch
    seconds) is when to try again: the response's Retry-After, else the next UTC day (WorkIt's caps count UTC
    days)."""

    def __init__(self, message: str, until: float):
        super().__init__(message, 429)
        self.until = until


class SignInClosed(WorkItError):
    """The sign-in browser closed, or the time ran out, before the student signed in."""


class Stage(StrEnum):
    """A stage of an application on WorkIt's Applications Tracker, as WorkIt
    names it (backend `dto.application_stage`). The one place Apply spells them."""

    SAVED = "saved"
    QUEUED = "queued"
    NEEDS_YOU = "needs_you"
    SKIPPED = "skipped"
    APPLIED = "applied"
    INTERVIEWING = "interviewing"
    OFFER = "offer"
    REJECTED = "rejected"


# Applied or later: a record of an application sent (backend `dto.APPLIED_STAGES`). Apply never changes one.
APPLIED_STAGES = frozenset({Stage.APPLIED, Stage.INTERVIEWING, Stage.OFFER, Stage.REJECTED})


@dataclass(frozen=True)
class Account:
    """The signed-in account, as `GET /auth/me` returns it."""

    id: str
    email: str
    full_name: str
    account_type: str  # "applicant" (a student) or "company"


class WorkIt:
    def __init__(self, at: Site | None = None, login: Path = LOGIN):
        self.site = at or site()
        self.login = login
        self._tried: str | None = None  # the last access token `accept` checked
        self._account: Account | None = None  # the signed-in account, read once for the writes

    def logged_in(self) -> bool:
        return self._saved() is not None

    def me(self) -> Account:
        return _account(self.call("GET", "/auth/me"))

    def call(self, method: str, path: str, body: Any = None) -> Any:
        """One API call as the signed-in student; its JSON answer. A refused token is refreshed one time.
        Raises NotLoggedIn, LoginExpired, Unreachable, or WorkItError for another refusal."""
        for attempt in range(2):
            status, answer, headers = _send(method, self.site.api + path, body, self._bearer(refresh=attempt > 0))
            if status == 429:
                raise CapReached(f"{method} {path}: 429 {_detail(answer)}", _retry_at(headers.get("Retry-After")))
            if status == 401 and attempt == 0:
                continue
            if status == 401:
                raise LoginExpired("WorkIt refused the login")
            if status >= 400:
                raise WorkItError(f"{method} {path}: {status} {_detail(answer)}", status)
            return answer

    # The Applications Tracker's reads and writes (KAN-545), as the signed-in student.

    def listed_by_link(self, url: str) -> tuple[str, str | None] | None:
        """The listed job at `url` and the student's stage on it (None: no application), or None when WorkIt
        does not list it. Writes nothing."""
        try:
            answer = self.call("POST", "/jobs/listed-by-link", {"url": url})
        except WorkItError as error:
            if error.status == 404:
                return None
            raise
        return str(answer["job_id"]), answer.get("stage")

    def applications(self, applicant_id: str) -> list[dict]:
        """Every application on the student's Applications Tracker, as WorkIt lists them (job, stage, applied_at)."""
        return self.call("GET", f"/applicants/{applicant_id}/applications")

    def add_by_link(self, url: str, company: str, title: str) -> tuple[str, str]:
        """Put the job at `url` on the student's Applications Tracker (an added job when WorkIt does not list it):
        its job id and the student's stage on it, saved when it is new there. `track_only` is Apply's form of
        the extension's Write with Claude add: any link, a closed job kept as it is, and no stage moved."""
        answer = self.call("POST", "/jobs/added-by-link",
                           {"url": url, "company": company, "title": title, "track_only": True})
        return str(answer["job_id"]), answer["stage"]

    def send_resume(self, applicant_id: str, job_id: str, path: Path) -> str:
        """Keep the file at `path` as a Sent resume to the job: its id."""
        answer = self.call("POST", f"/applicants/{applicant_id}/sent-resumes/file", {
            "job_posting_id": job_id, "file_name": path.name,
            "content": base64.b64encode(path.read_bytes()).decode()})
        return str(answer["id"])

    def set_stage(self, applicant_id: str, job_id: str, stage: str, applied_on: date | None = None) -> None:
        """Move the application to `stage` (applied or later); `applied_on` becomes its applied date."""
        body = {"stage": stage} | ({"applied_on": applied_on.isoformat()} if applied_on else {})
        self.call("PUT", f"/applicants/{applicant_id}/applications/{job_id}/stage", body)

    def link_resume(self, job_id: str, sent_resume_id: str) -> None:
        """Name the Sent resume the application went out with. Its stage and applied date stay."""
        self.call("POST", f"/jobs/{job_id}/applied", {"sent_resume_id": sent_resume_id})

    def unsave(self, job_id: str) -> None:
        """Delete the student's saved application on the job. WorkIt refuses (409) one past saved."""
        self.call("DELETE", f"/jobs/{job_id}/saved")

    def dequeue(self, applicant_id: str, job_id: str) -> None:
        """Delete the student's queued application on the job. WorkIt refuses (409) one past queued."""
        self.call("DELETE", f"/applicants/{applicant_id}/applications/{job_id}")

    def record_applied(self, link: str, company: str, title: str, resume: Path | None = None,
                       stage: Stage = Stage.APPLIED, applied_on: date | None = None) -> str | None:
        """Put the job at `link` on the student's Applications Tracker at `stage` (applied or later), with the
        file at `resume` kept as its Sent resume: add by link, keep the Sent resume, set the stage and the
        applied date (`applied_on`, else today), then name the Sent resume. Apply's submit writes and the Tracker
        Sheet import both use it. An application already applied or later stays as it is: answers its stage
        then, else None."""
        job, before = self.add_by_link(link, company, title)
        if before in APPLIED_STAGES:
            return before
        me = self.applicant_id()
        sent = self.send_resume(me, job, resume) if resume else None
        self.set_stage(me, job, stage, applied_on)
        if sent:
            self.link_resume(job, sent)
        return None

    def tailored_resume(self, url: str) -> bytes | None:
        """The PDF of the student's tailored resume for the listed job at `url` (Tailor, KAN-217), rendered now;
        None when WorkIt does not list the job or the student has no tailored resume for it (KAN-547). Writes
        nothing."""
        listed = self.listed_by_link(url)
        if listed is None:
            return None
        me = self.applicant_id()
        resume = next((r for r in self.call("GET", f"/applicants/{me}/built-resumes")
                       if r.get("job_posting_id") == listed[0]), None)
        if resume is None:
            return None
        return base64.b64decode(self.call("GET", f"/applicants/{me}/built-resumes/{resume['id']}/render")["pdf"])

    def applicant_id(self) -> str:
        """The signed-in student's id, read once (`GET /auth/me`): the writes name it in their paths."""
        if self._account is None:
            self._account = self.me()
        return self._account.id

    def accept(self, cookies: dict[str, str]) -> Account | None:
        """For `login`: the account of the web app's session in `cookies`, kept, or None while it has none
        that WorkIt accepts (not signed in yet, or a new Google sign-in that has no account type yet)."""
        session = _session(cookies, self.site.cookie)
        if session is None or session["access_token"] == self._tried:
            return None
        self._tried = session["access_token"]
        status, answer, _ = _send("GET", self.site.api + "/auth/me", None, session["access_token"])
        if status != 200:
            return None
        self._save(session)
        return _account(answer)

    def _bearer(self, refresh: bool) -> str:
        with self._locked():
            saved = self._saved()
            if saved is None:
                raise NotLoggedIn(f"no WorkIt login in {self.login}")
            if not refresh and saved["expires_at"] - EARLY > time.time():
                return saved["access_token"]
            status, answer, _ = _send("POST", self.site.auth + "/auth/v1/token?grant_type=refresh_token",
                                   {"refresh_token": saved["refresh_token"]}, None, apikey=self.site.anon_key)
            if status != 200:
                raise LoginExpired(f"Supabase refused the refresh token: {_detail(answer)}")
            self._save(answer)
            return answer["access_token"]

    def _saved(self) -> dict | None:
        try:
            saved = json.loads(self.login.read_text())
        except (OSError, ValueError):
            return None
        return saved if saved.get("auth") == self.site.auth else None  # a login to another WorkIt isn't this one's

    def _save(self, session: dict) -> None:
        kept = {"auth": self.site.auth, "access_token": session["access_token"],
                "refresh_token": session["refresh_token"],
                "expires_at": session.get("expires_at") or int(time.time()) + int(session.get("expires_in", 3600))}
        self.login.parent.mkdir(parents=True, exist_ok=True)
        part = self.login.with_suffix(".part")
        part.unlink(missing_ok=True)
        with os.fdopen(os.open(part, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as file:
            json.dump(kept, file)
        part.replace(self.login)

    @contextmanager
    def _locked(self):
        self.login.parent.mkdir(parents=True, exist_ok=True)
        with open(self.login.with_suffix(".lock"), "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield


# Each Applications Tracker stage Apply writes, as the tracker names it.
SHOWN = {Stage.APPLIED: "Applied", Stage.NEEDS_YOU: "Needs you"}


@dataclass(frozen=True)
class Write:
    """One change to the student's Applications Tracker: the job (by its link,
    company and title) goes to `stage` (Stage.APPLIED or NEEDS_YOU).
    `resume`, for applied, is the file the form was given, kept as the
    application's Sent resume. `application_id` is Apply's, so a later write
    for the same Application replaces one still waiting. `not_before` keeps
    a write WorkIt's daily cap refused (429) until the cap resets."""

    application_id: str
    link: str
    company: str
    title: str
    stage: str
    resume: str = ""
    not_before: float = 0.0  # epoch seconds: past WorkIt's daily cap, the write waits until then


def cap_wait(write: Write) -> str:
    """'waits for WorkIt's daily cap ... until <local time>' for a write the cap holds back now, else ''."""
    if write.not_before <= time.time():
        return ""
    when = datetime.fromtimestamp(write.not_before).strftime("%Y-%m-%d %H:%M")
    return f"waits for WorkIt's daily cap of added jobs until {when}"


class WaitingWrites:
    """The Waiting writes (GLOSSARY.md). Sends Writes to the Applications Tracker, and keeps each one that
    cannot reach WorkIt in a queue file until a later send or flush. One
    process at a time sends (a lock file), so a write is never sent twice
    at once."""

    def __init__(self, client: WorkIt | None = None, path: Path = QUEUE):
        self.client = client or WorkIt()
        self.path = path

    def send(self, write: Write) -> str:
        """Queue `write` (in place of a waiting one for the same Application), send every waiting write,
        and say in a few words where this one is."""
        with self._locked():
            waiting = [w for w in self._read() if w.application_id != write.application_id] + [write]
            self._keep(waiting)
            said = self._flush()
        return said.get(write.application_id, f"in your Applications Tracker as {SHOWN[write.stage]}")

    def flush(self) -> list[str]:
        """Send every waiting write, oldest first; what went wrong, a line each (nothing when all went or
        WorkIt still cannot be reached: those stay queued)."""
        with self._locked():
            return [said for said in self._flush().values() if said.startswith("not in")]

    def waiting(self) -> list[Write]:
        return self._read()

    def _flush(self) -> dict[str, str]:
        """Send the queue in order, until WorkIt cannot be reached. A write the daily cap holds back stays and
        is not sent before its `not_before`. What happened to each, by Application."""
        said, waiting, kept = {}, self._read(), []
        for at, write in enumerate(waiting):
            if cap_wait(write):
                said[write.application_id] = f"kept to send to your Applications Tracker: it {cap_wait(write)}"
                kept.append(write)
                continue
            try:
                said[write.application_id] = self._deliver(write)
            except (NotLoggedIn, LoginExpired) as error:
                for w in waiting[at:]:
                    said[w.application_id] = f"kept to send to your Applications Tracker later ({error}): " \
                                             "run `apply login`"
                break
            except Unreachable as error:
                for w in waiting[at:]:
                    said[w.application_id] = f"kept to send to your Applications Tracker later ({error})"
                break
            except CapReached as error:
                kept.append(dataclasses.replace(write, not_before=error.until))
                said[write.application_id] = f"kept to send to your Applications Tracker: it {cap_wait(kept[-1])}"
            except WorkItError as error:  # refused for good: sending it again would fail again
                said[write.application_id] = f"not in your Applications Tracker: WorkIt refused it ({error})"
            self._keep(kept + waiting[at + 1:])
        return said

    def _deliver(self, write: Write) -> str:
        if write.stage == Stage.APPLIED:
            resume = Path(write.resume) if write.resume else None
            before = self.client.record_applied(write.link, write.company, write.title,
                                                resume if resume and resume.is_file() else None)
            if before:
                return f"already {SHOWN.get(before, before)} in your Applications Tracker"
        else:
            job, _ = self.client.add_by_link(write.link, write.company, write.title)
            try:
                self.client.set_stage(self.client.applicant_id(), job, write.stage)
            except WorkItError as refused:
                if refused.status != 409:
                    raise
                return "already Applied in your Applications Tracker"
        return f"in your Applications Tracker as {SHOWN[write.stage]}"

    def _read(self) -> list[Write]:
        try:
            # A Hold an older Apply kept as queued goes as needs_you (KAN-544).
            return [Write(**{**w, "stage": Stage.NEEDS_YOU if w["stage"] == Stage.QUEUED else w["stage"]})
                    for w in json.loads(self.path.read_text())]
        except FileNotFoundError:
            return []

    def _keep(self, waiting: list[Write]) -> None:
        if not waiting:
            self.path.unlink(missing_ok=True)
            return
        part = self.path.with_suffix(".part")
        part.write_text(json.dumps([dataclasses.asdict(w) for w in waiting], indent=1))
        part.replace(self.path)

    @contextmanager
    def _locked(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path.with_suffix(".lock"), "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield


def login(client: WorkIt, browser: Callable[[str, Callable[[dict[str, str]], Account | None]], Account] | None = None
          ) -> Account:
    """Sign in to WorkIt in a browser and keep the session: `apply login`. `browser(url, accept)` opens
    `url` and returns the first `accept(cookies)` that is not None (chrome_sign_in by default)."""
    return (browser or chrome_sign_in)(f"{client.site.web}/login", client.accept)


def chrome_sign_in(url: str, accept: Callable[[dict[str, str]], Account | None], chrome: str = CHROME_BINARY,
                   args: tuple[str, ...] = (), timeout: float = 900) -> Account:
    """Open `url` in a new Chrome with an empty profile and wait until the student signs in. Chrome is
    started as a plain process, not by Playwright; Apply only reads its cookies through the DevTools port.
    That port alone sets navigator.webdriver, and Google's sign-in then refuses the browser (2026-11-03), so
    Chrome starts with --disable-blink-features=AutomationControlled. Apply never types into it. Then it
    closes Chrome and deletes the profile."""
    from playwright.sync_api import Error, sync_playwright

    with tempfile.TemporaryDirectory(prefix="apply-workit-login-", ignore_cleanup_errors=True) as profile:
        process = subprocess.Popen(
            [chrome, f"--user-data-dir={profile}", "--remote-debugging-port=0", "--no-first-run",
             "--no-default-browser-check", "--disable-blink-features=AutomationControlled", *args, url],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            port = _devtools_port(Path(profile), process)
            with sync_playwright() as playwright:
                browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
                origin = f"{urlsplit(url).scheme}://{urlsplit(url).netloc}"
                deadline = time.time() + timeout
                while time.time() < deadline:
                    try:
                        context = browser.contexts[0]
                        if not context.pages:
                            break  # the student closed the window
                        found = accept({c["name"]: c["value"] for c in context.cookies(origin)})
                    except Error:
                        break  # Chrome quit
                    if found:
                        return found
                    time.sleep(1)
            raise SignInClosed("the sign-in window closed, or 15 minutes passed, before you signed in")
        finally:
            process.terminate()
            try:
                process.wait(10)
            except subprocess.TimeoutExpired:
                process.kill()


def _devtools_port(profile: Path, process: subprocess.Popen) -> int:
    """The port Chrome picked (--remote-debugging-port=0 writes it to DevToolsActivePort)."""
    for _ in range(300):
        try:
            return int((profile / "DevToolsActivePort").read_text().split()[0])
        except (OSError, ValueError, IndexError):
            if process.poll() is not None:
                raise SignInClosed(f"Chrome stopped as it started (exit {process.returncode})") from None
            time.sleep(0.1)
    raise SignInClosed("Chrome did not open its DevTools port in 30 seconds")


def _session(cookies: dict[str, str], name: str) -> dict | None:
    """The web app's session from its cookie, which @supabase/ssr may split into `<name>.0`, `<name>.1`, ..."""
    raw = cookies.get(name) or "".join(cookies[f"{name}.{i}"] for i in range(10) if f"{name}.{i}" in cookies)
    if not raw:
        return None
    try:
        if raw.startswith("base64-"):
            encoded = urllib.parse.unquote(raw.removeprefix("base64-"))
            session = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        else:
            session = json.loads(urllib.parse.unquote(raw))
    except (ValueError, TypeError):
        return None  # half written as the web app changes it: read it again
    if not isinstance(session, dict) or not session.get("access_token") or not session.get("refresh_token"):
        return None
    return session


def _send(method: str, url: str, body: Any, token: str | None, apikey: str | None = None
          ) -> tuple[int, Any, Message]:
    """The status, JSON answer and headers. No answer, or a 5xx, is Unreachable."""
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if apikey:
        headers["apikey"] = apikey
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            status, raw, headers = response.status, response.read(), response.headers
    except urllib.error.HTTPError as error:
        status, raw, headers = error.code, error.read(), error.headers
    except (OSError, urllib.error.URLError) as error:
        raise Unreachable(f"{urlsplit(url).netloc}: {getattr(error, 'reason', error)}") from None
    if status >= 500:
        raise Unreachable(f"{urlsplit(url).netloc}: {status}")
    try:
        return status, json.loads(raw) if raw else None, headers
    except ValueError:
        return status, raw.decode(errors="replace")[:200], headers


def _retry_at(retry_after: str | None) -> float:
    """When to try a capped call again: Retry-After (seconds or an HTTP date), else the next UTC midnight."""
    if retry_after:
        if retry_after.strip().isdigit():
            return time.time() + int(retry_after)
        try:
            return email.utils.parsedate_to_datetime(retry_after).timestamp()
        except (TypeError, ValueError):
            pass
    tomorrow = datetime.now(UTC).date() + timedelta(days=1)
    return datetime.combine(tomorrow, dtime(), UTC).timestamp()


def _detail(answer: Any) -> str:
    if isinstance(answer, dict):
        return str(answer.get("error_description") or answer.get("detail") or answer.get("error") or answer)[:200]
    return str(answer)[:200]


def _account(answer: dict) -> Account:
    return Account(id=str(answer["id"]), email=answer["email"], full_name=answer.get("full_name", ""),
                   account_type=answer.get("account_type", ""))
