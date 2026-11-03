"""APPLY_HOME: the one data folder Apply reads the applicant's files from and writes its own to.

Run as a fresh process, since every data path is set when Apply is imported.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

from apply.profile import ApplicantProfile


def apply(args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess:
    """`apply <args>` in a fresh process, with `env` laid over this one's (None removes a variable)."""
    full = {k: v for k, v in (os.environ | env).items() if v is not None}
    return subprocess.run([sys.executable, "-m", "apply.cli", *args], env=full, capture_output=True, text=True)


def test_apply_home_set_holds_the_data(tmp_path):
    data = tmp_path / "data"
    done = apply(["trace"], {"APPLY_HOME": str(data)})
    assert f"No Trace in {data / 'traces'}." in done.stderr


def test_apply_home_unset_is_config_apply_in_the_home_folder(tmp_path):
    done = apply(["trace"], {"APPLY_HOME": None, "HOME": str(tmp_path)})
    assert f"No Trace in {tmp_path / '.config' / 'apply' / 'traces'}." in done.stderr


def test_the_story_bank_and_its_map_are_read_from_apply_home(tmp_path):
    (tmp_path / "story-bank.md").write_text("## Education\n- Led the robotics team to a regional win in 2025.\n")
    (tmp_path / "story-map.yaml").write_text(
        "episodes:\n- {id: education/gone, anchor: Taught a summer course on compilers to ten students, hash: x}\n")
    done = apply(["story-map", "--check"], {"APPLY_HOME": str(tmp_path)})
    assert done.stdout == "education/gone: its line is no longer in the story bank\n"


def test_the_applicant_profile_is_read_from_apply_home(tmp_path):
    done = apply(["doctor"], {"APPLY_HOME": str(tmp_path)})
    assert str(tmp_path / "applicant-profile.yaml") in done.stdout  # doctor names the missing profile in its fix line


SAMPLE = Path(__file__).parents[1] / "sample"


def test_the_first_run_fills_an_empty_apply_home_from_the_sample(tmp_path):
    data = tmp_path / "data"
    sample = {path.relative_to(SAMPLE): path.read_bytes() for path in SAMPLE.rglob("*") if path.is_file()}

    done = apply(["trace"], {"APPLY_HOME": str(data)})

    assert f"copied the Test Person sample data into {data}" in done.stderr
    assert {path.relative_to(data): path.read_bytes() for path in data.rglob("*") if path.is_file()} == sample
    (data / "applicant-profile.yaml").write_text("identity: {legal_first_name: Mine}\n")
    assert {path.relative_to(SAMPLE): path.read_bytes() for path in SAMPLE.rglob("*") if path.is_file()} == sample


def test_an_apply_home_with_a_profile_is_never_filled_from_the_sample(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    (data / "applicant-profile.yaml").write_text("identity: {legal_first_name: Mine}\n")

    done = apply(["trace"], {"APPLY_HOME": str(data)})

    assert "sample" not in done.stderr
    assert sorted(p.name for p in data.iterdir()) == ["applicant-profile.yaml"]


def test_policies_in_apply_home_override_the_defaults_key_by_key(tmp_path):
    (tmp_path / "policies.yaml").write_text("company_cap: 1\n")
    show = "from apply.profile import load_policies; p = load_policies(); print(p['company_cap'], p['daily_cap'])"
    done = subprocess.run([sys.executable, "-c", show], env=os.environ | {"APPLY_HOME": str(tmp_path)},
                          capture_output=True, text=True)
    assert done.stdout == "1 25\n"  # its own cap, and the default daily cap


@pytest.mark.parametrize(("written", "resolved"), [
    ("resume.pdf", "{data}/resume.pdf"),  # relative: from the data folder the profile is in
    ("/Users/someone/final/resume.pdf", "/Users/someone/final/resume.pdf"),  # absolute: as written
    ("~/final/resume.pdf", "{user}/final/resume.pdf"),  # from the home folder
])
def test_a_profiles_file_paths_resolve_from_its_data_folder(tmp_path, written, resolved):
    (tmp_path / "applicant-profile.yaml").write_text(f"files:\n  resume_pdf: {written}\n")
    profile = ApplicantProfile.load(tmp_path / "applicant-profile.yaml")
    assert profile.get("files.resume_pdf") == Path(resolved.format(data=tmp_path, user=Path.home()))
