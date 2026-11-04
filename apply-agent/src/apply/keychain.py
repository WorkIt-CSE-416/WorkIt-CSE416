"""Where Employer account passwords (the Gmail app password, the ntfy topic) live: Lisul's
macOS login Keychain, one generic-password item per site, which he can see in
Keychain Access. Never in the Tracker, the repo or a log."""

import hmac
import re
import subprocess
import threading
from collections.abc import Callable
from pathlib import Path

# The Keychain service every Employer account password is saved under; the
# item's account is the site (a Workday tenant's host, say).
EMPLOYER_ACCOUNTS = "apply-ats"
# The Gmail app password the mailbox signs in with; the item's account is the address.
GMAIL = "apply-gmail"
# The ntfy topic Lisul's phone subscribes to for pushes; the item's account is PHONE_PUSH_HOST.
# Anyone who knows a topic can read its pushes, so it is kept like a password.
PHONE_PUSH = "apply-ntfy"
PHONE_PUSH_HOST = "ntfy.sh"
# `security find-generic-password` exits with this when there is no such item.
NOT_FOUND = 44
# One attribute line of `security dump-keychain` (no -d, so it prints no secret).
ATTRIBUTE = re.compile(r'^\s*"(svce|acct)"<blob>="(.*)"$')


def _quoted(word: str) -> str:
    """`word` as one argument on `security -i`'s command line, which reads double quotes and backslashes."""
    if "\n" in word or "\r" in word:
        raise ValueError("A Keychain item's site or password can't hold a line break.")
    return '"' + word.replace("\\", "\\\\").replace('"', '\\"') + '"'


class MacKeychain:
    """macOS Keychain through the `security` CLI. A password never goes in
    argv, which the process list shows: a save sends its command to `security
    -i` on stdin, and a read gets the password on stdout. Neither is logged."""

    def __init__(self, service: str = EMPLOYER_ACCOUNTS, keychain: Path | None = None,
                 run: Callable[..., subprocess.CompletedProcess] = subprocess.run):
        """`keychain` is a keychain file to use instead of the login keychain (tests); `run` runs a command, as
        `subprocess.run` does (tests pass a fake)."""
        self._service = service
        self._keychain = [str(keychain)] if keychain else []
        self._run = run

    def password(self, site: str) -> str | None:
        found = self._run(
            ["security", "find-generic-password", "-s", self._service, "-a", site, "-w", *self._keychain],
            capture_output=True, text=True,
        )
        if found.returncode == NOT_FOUND:
            return None
        if found.returncode:
            raise RuntimeError(f"security find-generic-password failed ({found.returncode}): {found.stderr.strip()}")
        return found.stdout.removesuffix("\n")

    def save(self, site: str, password: str) -> None:
        command = " ".join(["add-generic-password", "-U", "-s", _quoted(self._service), "-a", _quoted(site),
                            "-w", _quoted(password), *map(_quoted, self._keychain)])
        # `security -i` exits 0 even when a command fails, so the save is read back. Its stderr may echo the
        # command, so it is never shown.
        self._run(["security", "-i"], input=command + "\n", capture_output=True, text=True, check=True)
        if not hmac.compare_digest((self.password(site) or "").encode(), password.encode()):
            raise RuntimeError(f"security add-generic-password did not keep the password for {site}")

    def sites(self) -> list[str]:
        """Each site with a password under this service, read from `security
        dump-keychain` without -d: item attributes only, never a password, and
        no Keychain prompt."""
        dumped = self._run(["security", "dump-keychain", *self._keychain], capture_output=True, text=True, check=True)
        found, item = [], {}
        for line in dumped.stdout.splitlines() + ["keychain: end"]:
            if line.startswith("keychain:"):
                if item.get("svce") == self._service and item.get("acct"):
                    found.append(item["acct"])
                item = {}
            elif attribute := ATTRIBUTE.match(line):
                item[attribute[1]] = attribute[2]
        return found

    def forget(self, site: str) -> None:
        found = self._run(
            ["security", "delete-generic-password", "-s", self._service, "-a", site, *self._keychain],
            capture_output=True, text=True,
        )
        if found.returncode not in (0, NOT_FOUND):
            raise RuntimeError(f"security delete-generic-password failed ({found.returncode}): {found.stderr.strip()}")


class InMemoryKeychain:
    """A Keychain for tests. Workers save from their own threads."""

    def __init__(self, passwords: dict[str, str] | None = None):
        self._passwords = dict(passwords or {})
        self._lock = threading.Lock()

    def password(self, site: str) -> str | None:
        with self._lock:
            return self._passwords.get(site)

    def save(self, site: str, password: str) -> None:
        with self._lock:
            self._passwords[site] = password

    def sites(self) -> list[str]:
        with self._lock:
            return list(self._passwords)

    def forget(self, site: str) -> None:
        with self._lock:
            self._passwords.pop(site, None)
