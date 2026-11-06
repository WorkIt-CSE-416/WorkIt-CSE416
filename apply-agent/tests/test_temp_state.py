"""KAN-665: a live run or rehearsal refuses to keep its state in a folder a reboot wipes."""

from pathlib import Path

import pytest
import yaml
from conftest import FIXTURES

from apply import cli, home, rehearsal


@pytest.mark.parametrize("path", ["/tmp/x", "/private/tmp/x/y", "/var/folders/ab/T/x", "/private/var/folders/ab/T/x", "/tmp"])
def test_a_temp_path_is_seen(path):
    assert home.in_temp(Path(path))


def test_a_link_into_temp_is_seen(tmp_path):
    link = Path.home() / ".apply-kan-665-link-test"
    link.symlink_to(tmp_path)
    try:
        assert home.in_temp(link)
    finally:
        link.unlink()


@pytest.mark.parametrize("path", ["/Users/me/.config/apply", "/tmpfiles/x", "/var/foldersish/x", "~/workit-work/x"])
def test_a_lasting_path_is_not(path):
    assert not home.in_temp(Path(path))


@pytest.fixture
def lasting(monkeypatch):
    """A run as outside a test: no test switch, and a lasting data folder."""
    monkeypatch.delenv(home.TEMP_OK)
    monkeypatch.setattr(home, "HOME", Path("/Users/me/.config/apply"))
    monkeypatch.setattr(home, "fill_from_sample", lambda: False)  # that folder is only a name: nothing is copied there


def test_the_data_folder_and_the_profiles_folder_are_each_refused(lasting, monkeypatch):
    assert home.temp_state(Path("/Users/me/.config/apply/profiles")) is None
    why = home.temp_state(Path("/private/tmp/profiles"))
    assert "APPLY_PROFILES" in why and "/private/tmp/profiles" in why
    monkeypatch.setattr(home, "HOME", Path("/tmp/home"))
    assert "APPLY_HOME is /tmp/home" in home.temp_state(Path("/Users/me/p"))


def test_the_test_switch_lets_it_through(monkeypatch):
    monkeypatch.setenv(home.TEMP_OK, "1")
    assert home.temp_state(Path("/tmp/p")) is None


def a_profile(folder, **facts):
    folder.mkdir()
    (folder / "applicant-profile.yaml").write_text(yaml.safe_dump(yaml.safe_load((FIXTURES / "profile.yaml").read_text()) | facts))
    (folder / "policies.yaml").write_text(yaml.safe_dump(yaml.safe_load((FIXTURES / "policies.yaml").read_text()) | {"live_runs": True}))
    return folder / "applicant-profile.yaml"


@pytest.mark.parametrize("command", [["rehearse", "https://jobs.example.com/a/1"], ["run"], ["approve-pass"]])
def test_a_live_start_says_why_and_what_to_do_instead(command, lasting, tmp_path, monkeypatch):
    monkeypatch.setenv("APPLY_PROFILES", "/private/tmp/worker-profiles")
    monkeypatch.setattr(cli, "live_adapters", lambda *a, **k: pytest.fail("a run started"))
    monkeypatch.setattr(rehearsal, "rehearse", lambda *a, **k: pytest.fail("a rehearsal started"))
    with pytest.raises(SystemExit) as stopped:
        cli.main([*command, "--profile", str(a_profile(tmp_path / "mine"))])
    message = str(stopped.value)
    assert message.startswith(f"apply {command[0]}: ") and "a reboot wipes it" in message and "lasting folder" in message


def test_test_person_needs_no_lasting_folder(lasting, tmp_path, monkeypatch):
    monkeypatch.setenv("APPLY_PROFILES", "/private/tmp/worker-profiles")
    sample = cli.ApplicantProfile.load(a_profile(tmp_path / "mine", sample_data=True))
    cli._refuse_temp_state(sample, "rehearse")  # no SystemExit
