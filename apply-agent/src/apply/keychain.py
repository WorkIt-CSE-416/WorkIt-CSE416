"""Where Employer account passwords (the Gmail app password, the ntfy topic) live: Lisul's
macOS login Keychain, one generic-password item per site, which he can see in
Keychain Access. Never in the Tracker, the repo or a log."""

import re
import subprocess
import threading
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


class MacKeychain:
    """macOS Keychain through the `security` CLI. The password is passed as an
    argument, so it shows in the process list for a moment: acceptable on
    Lisul's single-user Mac (see the sign-in research)."""

    def __init__(self, service: str = EMPLOYER_ACCOUNTS, keychain: Path | None = None):
        """`keychain` is a keychain file to use instead of the login keychain (tests)."""
        self._service = service
        self._keychain = [str(keychain)] if keychain else []

    def password(self, site: str) -> str | None:
        found = subprocess.run(
            ["security", "find-generic-password", "-s", self._service, "-a", site, "-w", *self._keychain],
            capture_output=True, text=True,
        )
        if found.returncode == NOT_FOUND:
            return None
        if found.returncode:
            raise RuntimeError(f"security find-generic-password failed ({found.returncode}): {found.stderr.strip()}")
        return found.stdout.removesuffix("\n")

    def save(self, site: str, password: str) -> None:
        subprocess.run(
            ["security", "add-generic-password", "-U", "-s", self._service, "-a", site, "-w", password, *self._keychain],
            check=True, capture_output=True,
        )

    def sites(self) -> list[str]:
        """Each site with a password under this service, read from `security
        dump-keychain` without -d: item attributes only, never a password, and
        no Keychain prompt."""
        dumped = subprocess.run(["security", "dump-keychain", *self._keychain], capture_output=True, text=True, check=True)
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
        found = subprocess.run(
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
