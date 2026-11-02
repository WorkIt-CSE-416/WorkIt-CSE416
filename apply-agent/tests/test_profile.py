"""The Applicant profile: the template Lisul fills once, and no secrets ever."""

import sys
import threading

import pytest
from conftest import APPLY, FIXTURES

from apply.profile import ApplicantProfile

TEMPLATE = APPLY / "applicant-profile.template.yaml"


def leaves(tree, prefix=""):
    for key, value in tree.items():
        if isinstance(value, dict):
            yield from leaves(value, f"{prefix}{key}.")
        else:
            yield f"{prefix}{key}", value


def test_the_template_settles_only_citizenship_and_sponsorship():
    import yaml

    filled = {key: value for key, value in leaves(yaml.safe_load(TEMPLATE.read_text())) if value not in (None, [], {})}
    assert filled == {"work_authorization.citizenship": "US citizen", "work_authorization.requires_sponsorship_now_or_future": False}
    profile = ApplicantProfile.load(TEMPLATE)
    assert profile.get("work_authorization.citizenship") == "US citizen"


@pytest.mark.parametrize("secret", ["gmail_app_password", "password", "api_key", "service_account_token", "client_secret"])
def test_a_profile_holding_a_secret_is_refused(tmp_path, secret):
    path = tmp_path / "profile.yaml"
    path.write_text(f"identity:\n  email: test.person@example.com\naccounts:\n  {secret}: hunter2\n")

    with pytest.raises(ValueError, match=secret):
        ApplicantProfile.load(path)


@pytest.fixture
def busy_threads():
    """Switch threads very often, so a save and a write interleave."""
    interval = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)
    yield
    sys.setswitchinterval(interval)


def test_workers_remembering_answers_while_the_profile_is_saved_lose_nothing(tmp_path, busy_threads):
    path = tmp_path / "profile.yaml"
    path.write_text((FIXTURES / "profile.yaml").read_text())
    profile = ApplicantProfile.load(path)
    errors = []

    def remember(worker: int) -> None:
        try:
            for n in range(300):
                profile.set_answered(f"Worker {worker} question {n}?", "Yes")
        except Exception as error:
            errors.append(error)

    workers = [threading.Thread(target=remember, args=(w,)) for w in range(3)]
    for worker in workers:
        worker.start()
    while any(worker.is_alive() for worker in workers):
        try:
            profile.save()
        except Exception as error:
            errors.append(error)
            break
    for worker in workers:
        worker.join()
    profile.save()

    assert errors == []
    saved = ApplicantProfile.load(path)
    assert all(saved.answered(f"Worker {w} question {n}?") == "Yes" for w in range(3) for n in range(300))


def test_a_save_keeps_what_changed_in_the_file_since_the_profile_was_loaded(tmp_path):
    # Seen live: a rehearsal's dashboard saved its start-of-run copy over a fact added meanwhile.
    path = tmp_path / "profile.yaml"
    path.write_text((FIXTURES / "profile.yaml").read_text())
    profile = ApplicantProfile.load(path)
    path.write_text(path.read_text() + "\nadded_meanwhile: kept\n")

    profile.save_answered("Which role are you applying to?", "Software Engineering")

    saved = ApplicantProfile.load(path)
    assert saved.get("added_meanwhile") == "kept"
    assert saved.answered("Which role are you applying to?") == "Software Engineering"


def test_a_save_leaves_long_lines_unwrapped_so_a_long_question_reads_back(tmp_path):
    # Seen live: Datadog's 96-character question was wrapped onto two lines, which no YAML reader takes as a key.
    path = tmp_path / "profile.yaml"
    long_line = "note: " + "word " * 30 + "end\n"
    path.write_text((FIXTURES / "profile.yaml").read_text() + long_line)
    question = "Will participating in an internship during this period push your expected graduation date back?"

    ApplicantProfile.load(path).save_answered(question, "No")

    assert ApplicantProfile.load(path).answered(question) == "No"
    assert long_line in path.read_text()
