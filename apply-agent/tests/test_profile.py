"""The Applicant profile: the template its owner fills once, and no secrets ever."""

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


def test_the_template_leaves_every_fact_blank_for_its_owner():
    import yaml

    filled = {key: value for key, value in leaves(yaml.safe_load(TEMPLATE.read_text())) if value not in (None, [], {})}
    assert filled == {}
    assert ApplicantProfile.load(TEMPLATE).get("work_authorization.citizenship") is None


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


def test_a_forms_values_joined_are_never_saved_as_one_answer(tmp_path):
    # Live (KAN-693): a held form's whole section, read as one field, was saved as the answer to the field
    # Lisul had left blank: his name, email and phone in one string; "Yes; No" for work authorization.
    path = tmp_path / "profile.yaml"
    path.write_text((FIXTURES / "profile.yaml").read_text())
    profile = ApplicantProfile.load(path)
    joined = "; ".join([profile.get("identity.legal_first_name"), profile.get("identity.email"), "Yes"])

    with pytest.raises(ValueError, match="several of the form's values"):
        profile.save_answered("Alternate Phone Number", joined)
    with pytest.raises(ValueError):
        profile.save_answered("Are you legally authorized to work here?", "Yes; No")
    profile.set_answered("State", joined)  # a Worker's plan keeps it out too, without failing
    profile.save_answered("Which tracks interest you?", "Software; Hardware")  # a multi-pick is one answer

    saved = ApplicantProfile.load(path)
    assert saved.answered("Alternate Phone Number") is None and saved.answered("State") is None
    assert saved.answered("Are you legally authorized to work here?") is None
    assert saved.answered("Which tracks interest you?") == "Software; Hardware"


def test_a_save_leaves_long_lines_unwrapped_so_a_long_question_reads_back(tmp_path):
    # Seen live: Datadog's 96-character question was wrapped onto two lines, which no YAML reader takes as a key.
    path = tmp_path / "profile.yaml"
    long_line = "note: " + "word " * 30 + "end\n"
    path.write_text((FIXTURES / "profile.yaml").read_text() + long_line)
    question = "Will participating in an internship during this period push your expected graduation date back?"

    ApplicantProfile.load(path).save_answered(question, "No")

    assert ApplicantProfile.load(path).answered(question) == "No"
    assert long_line in path.read_text()
