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
that use `call`.
"""

import base64
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
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from apply.home import HOME

LOGIN = HOME / "workit-login.json"
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


class SignInClosed(WorkItError):
    """The sign-in browser closed, or the time ran out, before the student signed in."""


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

    def logged_in(self) -> bool:
        return self._saved() is not None

    def me(self) -> Account:
        return _account(self.call("GET", "/auth/me"))

    def call(self, method: str, path: str, body: Any = None) -> Any:
        """One API call as the signed-in student; its JSON answer. A refused token is refreshed one time.
        Raises NotLoggedIn, LoginExpired, Unreachable, or WorkItError for another refusal."""
        for attempt in range(2):
            status, answer = _send(method, self.site.api + path, body, self._bearer(refresh=attempt > 0))
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
        """Put the job at `url` on the student's Applications Tracker (an unlisted job posting when WorkIt does not
        list it): its job id and the student's stage on it, saved when it is new there."""
        answer = self.call("POST", "/jobs/added-by-link", {"url": url, "company": company, "title": title})
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

    def accept(self, cookies: dict[str, str]) -> Account | None:
        """For `login`: the account of the web app's session in `cookies`, kept, or None while it has none
        that WorkIt accepts (not signed in yet, or a new Google sign-in that has no account type yet)."""
        session = _session(cookies, self.site.cookie)
        if session is None or session["access_token"] == self._tried:
            return None
        self._tried = session["access_token"]
        status, answer = _send("GET", self.site.api + "/auth/me", None, session["access_token"])
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
            status, answer = _send("POST", self.site.auth + "/auth/v1/token?grant_type=refresh_token",
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


def login(client: WorkIt, browser: Callable[[str, Callable[[dict[str, str]], Account | None]], Account] | None = None
          ) -> Account:
    """Sign in to WorkIt in a browser and keep the session: `apply login`. `browser(url, accept)` opens
    `url` and returns the first `accept(cookies)` that is not None (chrome_sign_in by default)."""
    return (browser or chrome_sign_in)(f"{client.site.web}/login", client.accept)


def chrome_sign_in(url: str, accept: Callable[[dict[str, str]], Account | None], chrome: str = CHROME_BINARY,
                   args: tuple[str, ...] = (), timeout: float = 900) -> Account:
    """Open `url` in a new Chrome with an empty profile and wait until the student signs in. Chrome is
    started as a plain process, not by Playwright, so Google's sign-in accepts it; Apply only reads its
    cookies through the DevTools port. Apply never types into it. Then it closes Chrome and deletes the profile."""
    from playwright.sync_api import Error, sync_playwright

    with tempfile.TemporaryDirectory(prefix="apply-workit-login-", ignore_cleanup_errors=True) as profile:
        process = subprocess.Popen(
            [chrome, f"--user-data-dir={profile}", "--remote-debugging-port=0", "--no-first-run",
             "--no-default-browser-check", *args, url],
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


def _send(method: str, url: str, body: Any, token: str | None, apikey: str | None = None) -> tuple[int, Any]:
    """The status and JSON answer. No answer, or a 5xx, is Unreachable."""
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
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    except (OSError, urllib.error.URLError) as error:
        raise Unreachable(f"{urlsplit(url).netloc}: {getattr(error, 'reason', error)}") from None
    if status >= 500:
        raise Unreachable(f"{urlsplit(url).netloc}: {status}")
    try:
        return status, json.loads(raw) if raw else None
    except ValueError:
        return status, raw.decode(errors="replace")[:200]


def _detail(answer: Any) -> str:
    if isinstance(answer, dict):
        return str(answer.get("error_description") or answer.get("detail") or answer.get("error") or answer)[:200]
    return str(answer)[:200]


def _account(answer: dict) -> Account:
    return Account(id=str(answer["id"]), email=answer["email"], full_name=answer.get("full_name", ""),
                   account_type=answer.get("account_type", ""))
