"""The phone push: one ntfy message per run listing the Applications that
wait on Lisul. Every push goes to a fake HTTP poster; none is ever sent."""

import json
import shutil
import threading
from pathlib import Path

import pytest
import yaml
from conftest import FIXTURES
from fakes import FakeClaude, FakeClock, FakeMailbox, ScriptedUsage
from test_matches import NOW, NoBrowser, feed_record

from apply.adapters import Adapters
from apply.cli import main
from apply.feed import SimplifyFeed
from apply.fillers import FILLERS
from apply.keychain import InMemoryKeychain
from apply.model import Handoff, Question, Status
from apply.notify import NtfyNotifier, RecordingNotifier, live_phone, waiting
from apply.tracker import InMemoryTracker


class FakePoster:
    """Stands in for the HTTPS POST: keeps each (url, body, headers) it was sent."""

    def __init__(self, fails: Exception | None = None):
        self.sent: list[tuple[str, dict, dict]] = []
        self._fails = fails

    def __call__(self, url: str, body: bytes, headers: dict) -> None:
        if self._fails:
            raise self._fails
        self.sent.append((url, json.loads(body), headers))


def test_a_push_posts_the_title_and_message_to_the_topic_as_json():
    poster = FakePoster()

    NtfyNotifier("apply-k3x9-secret", poster).notify("Apply: 1 needs you", "Held: Acmé, Intern → reason")

    assert poster.sent == [(
        "https://ntfy.sh",
        {"topic": "apply-k3x9-secret", "title": "Apply: 1 needs you", "message": "Held: Acmé, Intern → reason"},
        {"Content-Type": "application/json"},
    )]


# Seam 2: whole `apply run`s, read off the pushes Lisul's phone would get.

HOUSING = Question("housing", "Do you have housing within 30 miles of our office?", "select", True, ("Yes", "No"))


class DecisionsFiller:
    """Stand-in Filler: a one-question form that is a Handoff at `handoffs`
    URLs, asks a question only Lisul can answer at `asks` URLs, and whose page
    drops the answer at `garbled` URLs (so it is held). The URL being filled
    is kept per Worker thread."""

    def __init__(self, handoffs=(), asks=(), garbled=()):
        self._handoffs, self._asks, self._garbled = set(handoffs), set(asks), set(garbled)
        self._worker = threading.local()

    def question_set(self, url, site):
        self._worker.url = url
        if url in self._handoffs:
            raise Handoff(f"Sign-in wall at {url}")
        return [Question("email", "Email", "text"), *([HOUSING] if url in self._asks else [])]

    def fill(self, page, questions, answers):
        return {} if self._worker.url in self._garbled else dict(answers)

    def submit(self, page):
        pass


def profile_dir(tmp_path, **policies) -> Path:
    """The test profile in a folder of its own, with these policies beside it."""
    for name in ("profile.yaml", "one-pager.pdf"):
        shutil.copy(FIXTURES / name, tmp_path / name)
    (tmp_path / "policies.yaml").write_text(yaml.safe_dump({"calibration_run": 0, **policies}))
    return tmp_path / "profile.yaml"


def run(monkeypatch, profile: Path, records: list[dict], phone=None, notifier=None, **filler) -> None:
    monkeypatch.setitem(FILLERS, "other", DecisionsFiller(**filler))
    main(
        ["run", "--profile", str(profile)],
        adapters=Adapters(
            feed=SimplifyFeed(lambda: json.dumps(records).encode()),
            tracker=InMemoryTracker(),
            site=NoBrowser(),
            claude=FakeClaude(needs_lisul=["Do you have housing"]),
            mailbox=FakeMailbox(),
            usage=ScriptedUsage(),
            clock=FakeClock(NOW),
            notifier=notifier or RecordingNotifier(),
            phone=phone,
        ),
    )


def test_a_run_pushes_one_message_listing_each_application_that_waits_on_lisul(monkeypatch, tmp_path):
    submitted, held, handoff, missing = (feed_record(company_name=name) for name in ("Done Co", "Hold Co", "Wall Co", "Ask Co"))
    phone = RecordingNotifier()

    run(monkeypatch, profile_dir(tmp_path, phone_push=True), [submitted, held, handoff, missing], phone,
        handoffs=[handoff["url"]], asks=[missing["url"]], garbled=[held["url"]])

    assert phone.sent == [(
        "Apply: 3 Applications need you",
        "Held: Hold Co, Software Engineer Intern: Pre-submit check failed. Email: meant 'test.person@example.com', page shows ''\n"
        f"Handoff: Wall Co, Software Engineer Intern: Sign-in wall at {handoff['url']}\n"
        "Missing fact: Ask Co, Software Engineer Intern: Do you have housing within 30 miles of our office?",
    )]


def test_with_the_phone_push_policy_off_a_run_pushes_nothing(monkeypatch, tmp_path):
    handoff = feed_record()
    phone = RecordingNotifier()

    run(monkeypatch, profile_dir(tmp_path), [handoff], phone, handoffs=[handoff["url"]])

    assert phone.sent == []


def test_a_run_that_leaves_nothing_for_lisul_pushes_nothing(monkeypatch, tmp_path):
    phone = RecordingNotifier()

    run(monkeypatch, profile_dir(tmp_path, phone_push=True), [feed_record()], phone)

    assert phone.sent == []


def test_with_no_topic_set_up_a_run_goes_on_without_a_push(monkeypatch, tmp_path):
    handoff = feed_record()
    notifier = RecordingNotifier()

    run(monkeypatch, profile_dir(tmp_path, phone_push=True), [handoff], phone=None, notifier=notifier,
        handoffs=[handoff["url"]])

    assert notifier.sent == [("Apply run finished", "0 submitted, 0 held, 1 handoff, 0 missing fact, 0 new Employer accounts")]


def test_a_push_that_fails_is_said_and_the_run_still_ends_as_usual(monkeypatch, tmp_path, capsys):
    handoff = feed_record()
    notifier = RecordingNotifier()
    phone = NtfyNotifier("apply-k3x9-secret", FakePoster(fails=OSError("network is unreachable")))

    run(monkeypatch, profile_dir(tmp_path, phone_push=True), [handoff], phone, notifier, handoffs=[handoff["url"]])

    assert notifier.sent == [("Apply run finished", "0 submitted, 0 held, 1 handoff, 0 missing fact, 0 new Employer accounts")]
    assert "Couldn't push the Applications waiting on you to your phone (network is unreachable)" in capsys.readouterr().err


def test_a_push_cuts_long_reasons_and_lists_at_most_twenty_applications():
    long = "Pre-submit check failed. " + "x" * 200
    many = [(Status.HANDOFF, f"Co {n}", "Intern", "Sign-in wall") for n in range(22)]

    title, message = waiting([(Status.HELD, "Acme", "Intern", long), *many])

    lines = message.split("\n")
    assert title == "Apply: 23 Applications need you"
    assert lines[0] == "Held: Acme, Intern: Pre-submit check failed. " + "x" * 74 + "…"
    assert len(lines) == 21
    assert lines[-1] == "and 3 more in the Tracker"


# Seam 3: the live topic, and `apply push-test`.

def test_the_live_push_goes_to_the_topic_saved_in_keychain():
    poster = FakePoster()

    live_phone(InMemoryKeychain({"ntfy.sh": "apply-k3x9-secret"}), poster).notify("Apply", "hello")

    [(_url, body, _headers)] = poster.sent
    assert body["topic"] == "apply-k3x9-secret"


def test_with_no_topic_in_keychain_there_is_no_live_push():
    assert live_phone(InMemoryKeychain(), FakePoster()) is None


def adapters_with(phone) -> Adapters:
    return Adapters(feed=None, tracker=None, site=None, claude=None, mailbox=None, usage=None, clock=None, phone=phone)


def test_push_test_sends_one_test_push(capsys):
    phone = RecordingNotifier()

    main(["push-test"], adapters=adapters_with(phone))

    assert phone.sent == [("Apply test push", "Apply can reach your phone. Pushes of what waits on you come here.")]
    assert "Sent a test push" in capsys.readouterr().out


def test_push_test_with_no_topic_says_how_to_set_one_up():
    with pytest.raises(SystemExit) as refused:
        main(["push-test"], adapters=adapters_with(None))

    assert "security add-generic-password -s apply-ntfy -a ntfy.sh -w" in str(refused.value)


def test_push_test_that_fails_says_why():
    phone = NtfyNotifier("apply-k3x9-secret", FakePoster(fails=OSError("network is unreachable")))

    with pytest.raises(SystemExit) as failed:
        main(["push-test"], adapters=adapters_with(phone))

    assert "network is unreachable" in str(failed.value)
