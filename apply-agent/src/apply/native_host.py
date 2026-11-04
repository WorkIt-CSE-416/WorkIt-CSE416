"""The Apply accounts host (KAN-592): a Chrome native messaging host that gives
the WorkIt extension, in Lisul's own Chrome, the login of one Employer account
Apply made, so the extension fills that tenant's Workday Sign In and Chrome
offers to save the password in its own password manager.

Chrome starts it once per message (`chrome.runtime.sendNativeMessage`), as
Lisul, with the caller's origin as its first argument. One message is a
4-byte length in native byte order, then that many bytes of JSON; the answer
is framed the same way. https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging

What it gives, and to whom:
- Only the WorkIt extension (EXTENSION_ORIGIN, the ID manifest.json's key
  pins) gets an answer. Chrome checks the host manifest's allowed_origins
  too; this checks again.
- One request names one tenant (`jobOf(url).tenant`, as `workday.site_of`).
  The answer is a login only for a tenant in the Tracker's Employer accounts
  list, with a Keychain password, whose password sign-in has not failed.
  Else `{"none": why}`. It never lists passwords.
- `want: "known"` answers the company and login, never the password: the
  extension shows its button with it. `want: "login"` adds the password: the
  extension asks it only after Lisul pressed that button.
- The password goes only to stdout, to Chrome. Never to a log, stderr, a
  Record or a file. The log line names the tenant and the time.
"""

import json
import shlex
import struct
import sys
from collections.abc import Sequence
from datetime import date, datetime
from pathlib import Path
from typing import BinaryIO
from urllib.parse import urlsplit

from apply.accounts import failed_sites
from apply.home import HOME
from apply.tracker import EmployerAccount

NAME = "com.workit.apply_accounts"
# The WorkIt extension's ID: manifest.json's `key` pins it (autofiller_extension/store/extension-id.mjs).
EXTENSION_ID = "cpklhdkoafegnndlafmiceehfloodjgi"
EXTENSION_ORIGIN = f"chrome-extension://{EXTENSION_ID}/"
LOG = HOME / "apply-accounts-host.log"
# Chrome's limit on a message to a host.
MOST = 64 * 1024 * 1024
# Where Lisul's everyday Chrome looks for a host: NativeMessagingHosts in its user data folder.
CHROME_HOSTS = Path.home() / "Library/Application Support/Google/Chrome/NativeMessagingHosts"
WRAPPER = "apply-accounts-host"


def answer(origin: str, request: dict, tracker, keychain) -> dict:
    """The answer to one request from `origin`: a tenant's company and login
    (and its password for `want: "login"`), or `{"none": why}`."""
    if origin != EXTENSION_ORIGIN:
        return {"none": "only the WorkIt extension may ask"}
    tenant = request.get("tenant")
    if not isinstance(tenant, str) or not tenant:
        return {"none": "no tenant named"}
    account = next((a for a in tracker.employer_accounts() if a.site == tenant), None)
    if account is None:
        return {"none": "Apply made no account there"}
    if tenant in failed_sites([row.reason for row in tracker.rows()]):
        return {"none": "a sign-in with Apply's password failed there"}
    password = keychain.password(tenant)
    if not password:
        return {"none": "Keychain has no password for it"}
    login = {"company": account.company, "login": account.login}
    return login | {"password": password} if request.get("want") == "login" else login


def serve(argv: Sequence[str], stdin: BinaryIO, stdout: BinaryIO, tracker, keychain, log: Path = LOG) -> None:
    """Read one framed message, answer it, and log a released password's tenant."""
    origin = argv[0] if argv else ""
    try:
        request = _read(stdin)
        reply = answer(origin, request, tracker, keychain)
    except Exception as error:  # never the message or the password: only the error's kind
        request, reply = {}, {"none": f"Apply's host failed ({type(error).__name__})"}
    _write(stdout, reply)
    if "password" in reply:
        with log.open("a") as file:
            file.write(f"{datetime.now().isoformat(timespec='seconds')} gave the WorkIt extension "
                       f"the password of {request['tenant']}\n")


def _read(stdin: BinaryIO) -> dict:
    head = stdin.read(4)
    if len(head) != 4:
        raise EOFError("no message")
    (size,) = struct.unpack("=I", head)
    if size > MOST:
        raise ValueError("message too long")
    request = json.loads(stdin.read(size))
    if not isinstance(request, dict):
        raise TypeError("not an object")
    return request


def _write(stdout: BinaryIO, reply: dict) -> None:
    body = json.dumps(reply).encode()
    stdout.write(struct.pack("=I", len(body)) + body)
    stdout.flush()


def install(hosts: Path = CHROME_HOSTS, python: str = sys.executable, home: Path = HOME) -> Path:
    """Write the host's wrapper (in the data folder, Lisul's only, 0700) and
    the host manifest Chrome reads, which names only the WorkIt extension.
    The wrapper runs this checkout's venv Python straight (Chrome starts the
    host once per message, so no `uv run`). Returns the manifest's path."""
    home.mkdir(parents=True, exist_ok=True)
    wrapper = home / WRAPPER
    wrapper.write_text(f"#!/bin/sh\nAPPLY_HOME={shlex.quote(str(home))} exec {shlex.quote(python)} -m apply.native_host \"$@\"\n")
    wrapper.chmod(0o700)
    hosts.mkdir(parents=True, exist_ok=True)
    manifest = hosts / f"{NAME}.json"
    manifest.write_text(json.dumps({
        "name": NAME,
        "description": "Apply's Employer account logins, from Keychain, for the WorkIt extension's Sign In button",
        "path": str(wrapper),
        "type": "stdio",
        "allowed_origins": [EXTENSION_ORIGIN],
    }, indent=1) + "\n")
    return manifest


def adopt(keychain, tracker, login: str, today: date) -> list[str]:
    """List in the Tracker each site Keychain has an Employer account password
    for and the Tracker lacks (a Rehearsal before KAN-592 listed none). Its
    company is a Tracker row's on that host, else the host's first word.
    Reads only the sites, never a password. Returns those added."""
    listed = {a.site for a in tracker.employer_accounts()}
    companies = {urlsplit(row.posting_url).hostname: row.company for row in tracker.rows()}
    added = []
    for site in keychain.sites():
        if site in listed:
            continue
        company = companies.get(site.split("/")[0]) or site.split(".")[0].capitalize()
        tracker.add_employer_account(EmployerAccount(company, site, login, today))
        added.append(site)
    return added


def main() -> None:
    from apply.keychain import MacKeychain
    from apply.tracker import FileTracker

    serve(sys.argv[1:], sys.stdin.buffer, sys.stdout.buffer, FileTracker(), MacKeychain())


if __name__ == "__main__":
    main()
