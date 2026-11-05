"""The one macOS notification Lisul gets after each run, and the push to his
phone listing the Applications that wait on him."""

import json
import subprocess
import urllib.request
from collections import Counter
from collections.abc import Callable

from apply.asking import IN
from apply.keychain import PHONE_PUSH, PHONE_PUSH_HOST, MacKeychain
from apply.model import Status, one_line

TITLE = "Apply run finished"

# Passing the text as arguments means no quoting of it inside AppleScript.
SCRIPT = ["on run argv", "display notification (item 2 of argv) with title (item 1 of argv)", "end run"]


def summary(statuses: Counter, new_accounts: int, drafted: list[tuple[str, str]] = (),
            reused: list[tuple[str, str, int]] = ()) -> str:
    """The run's counts: submitted, held, handoff, missing fact, new Employer
    accounts; then each new answer Claude drafted into the Answer bank, for
    Lisul to review, as (question, answer); then each unreviewed draft the
    bank answered a form with again, as (question, answer, uses)."""
    counts = [f"{statuses[s]} {s}" for s in (Status.SUBMITTED, Status.HELD, Status.HANDOFF, Status.MISSING_FACT)]
    accounts = f"{new_accounts} new Employer account" + ("" if new_accounts == 1 else "s")
    line = ", ".join([*counts, accounts])
    if drafted:
        noun = "answer" if len(drafted) == 1 else "answers"
        line += f". Review {len(drafted)} {noun} Claude drafted: " + "; ".join(f"{q} → {a}" for q, a in drafted)
    if reused:
        noun = "draft" if len(reused) == 1 else "drafts"
        line += f". {len(reused)} unreviewed {noun} used again: " + used_again(reused)
    return line


# What the phone push lists: the Applications that wait on Lisul, in this order.
WAITING = (Status.HELD, Status.HANDOFF, Status.MISSING_FACT)
# A reason in a push is cut to this many characters; the Tracker has it whole.
SHORT_REASON = 100
SHORT_CONTEXT = 160  # characters of a Missing fact's context line in a push
# A push lists at most this many Applications, so it stays one short message.
MOST_LISTED = 20


def waiting(applications: list[tuple[Status, str, str, str]]) -> tuple[str, str]:
    """The phone push's title and message for the Applications that wait on
    Lisul, as (status, company, role, reason): one line each, by status. A
    Missing fact's context line (after "; In: ", apply.asking) is kept apart
    from its question, so cutting a long question never cuts it."""
    ordered = sorted(applications, key=lambda a: WAITING.index(a[0]))
    lines = [f"{status.capitalize()}: {company}, {role}: {_short(asked)}" + (f" ({_short(where, SHORT_CONTEXT)})" if where else "")
             for status, company, role, reason in ordered for asked, _, where in [reason.partition(f"; {IN}")]]
    if len(lines) > MOST_LISTED:
        lines[MOST_LISTED:] = [f"and {len(lines) - MOST_LISTED} more in the Tracker"]
    noun = "Application needs" if len(applications) == 1 else "Applications need"
    return f"Apply: {len(applications)} {noun} you", "\n".join(lines)


def _short(reason: str, most: int = SHORT_REASON) -> str:
    reason = one_line(reason)
    return reason if len(reason) <= most else reason[:most - 1].rstrip() + "…"


def used_again(reused: list[tuple[str, str, int]]) -> str:
    return "; ".join(f"{q} → {a} ({n} use{'' if n == 1 else 's'})" for q, a, n in reused)


class MacNotifier:
    """Shows a notification in macOS Notification Center through osascript."""

    def notify(self, title: str, message: str) -> None:
        args = [arg for line in SCRIPT for arg in ("-e", line)]
        subprocess.run(["osascript", *args, title, message], check=True, capture_output=True)


# ntfy.sh takes a message as JSON at its root, so a title or message in any
# language needs no header encoding. No account: whoever knows the topic can
# read it, so the topic is kept in Keychain (keychain.NTFY), never the repo.
NTFY = "https://ntfy.sh"
# Seconds a push may take before it is given up on.
PUSH_TIMEOUT = 10


def https_post(url: str, body: bytes, headers: dict) -> None:
    """POST `body` to `url`; raise on any failure or HTTP error."""
    with urllib.request.urlopen(urllib.request.Request(url, body, headers, method="POST"), timeout=PUSH_TIMEOUT):
        pass


class NtfyNotifier:
    """Pushes a notification to Lisul's phone through ntfy.sh: the ntfy app,
    subscribed to `topic`, shows it. `post` is the HTTPS POST (a fake in tests)."""

    def __init__(self, topic: str, post: Callable[[str, bytes, dict], None] = https_post):
        self._topic = topic
        self._post = post

    def notify(self, title: str, message: str) -> None:
        body = json.dumps({"topic": self._topic, "title": title, "message": message}).encode()
        self._post(NTFY, body, {"Content-Type": "application/json"})


# What `apply push-test` sends.
TEST_PUSH = ("Apply test push", "Apply can reach your phone. Pushes of what waits on you come here.")
# What `apply push-test` says while no topic is set up.
SET_UP = f"""No ntfy topic is set up, so Apply pushes nothing to your phone. To set one up:
  1. Install the ntfy app on your phone (App Store or Google Play) and allow its notifications.
  2. In the app, tap + and subscribe to a topic on ntfy.sh with a name nobody could guess,
     such as the output of: echo apply-$(openssl rand -hex 12)
  3. Save that name in Keychain: security add-generic-password -s {PHONE_PUSH} -a {PHONE_PUSH_HOST} -w <topic>
  4. Run `apply push-test` again; the test push shows on your phone.
  5. Set `phone_push: true` in policies.yaml in your data folder ($APPLY_HOME), and every run pushes what waits on you."""


def live_phone(keychain=None, post: Callable[[str, bytes, dict], None] = https_post) -> NtfyNotifier | None:
    """The push to Lisul's phone, to the ntfy topic saved in Keychain
    (service apply-ntfy, account ntfy.sh); None while there is none."""
    topic = (keychain or MacKeychain(PHONE_PUSH)).password(PHONE_PUSH_HOST)
    return NtfyNotifier(topic, post) if topic else None


class RecordingNotifier:
    """The notifier fake: keeps every (title, message) it was sent."""

    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    def notify(self, title: str, message: str) -> None:
        self.sent.append((title, message))
