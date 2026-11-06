"""KAN-663: a run stops when the profile's resume isn't the one on the resume repo's main branch."""

import hashlib
import subprocess

import pytest
import yaml
from conftest import FIXTURES

from apply import cli, doctor, rehearsal, resume_check
from apply.profile import ApplicantProfile
from apply.resume_check import SAME, STALE, UNKNOWN, blob_sha, compare

SOURCE = {"repo": "someone/resume", "path": "final/resume.pdf"}


@pytest.fixture
def resume(tmp_path):
    path = tmp_path / "resume.pdf"
    path.write_bytes(b"%PDF-accepted")
    return path


def test_blob_sha_is_gits(resume):
    assert blob_sha(resume) == subprocess.run(["git", "hash-object", str(resume)], capture_output=True, text=True).stdout.strip()


def test_unset_means_no_check_and_no_gh(resume, tmp_path):
    assert compare(None, resume, gh=lambda *a: pytest.fail("gh ran"), cache=tmp_path / "c") is None


def test_the_same_file_passes(resume, tmp_path):
    assert compare(SOURCE, resume, gh=lambda *a: blob_sha(resume), cache=tmp_path / "c").state == SAME


def test_a_different_file_names_both_shas_on_one_line(resume, tmp_path):
    theirs = hashlib.sha1(b"new").hexdigest()
    verdict = compare(SOURCE, resume, gh=lambda *a: theirs, cache=tmp_path / "c")
    assert verdict.state == STALE
    assert blob_sha(resume) in verdict.line and theirs in verdict.line and "\n" not in verdict.line


def test_gh_offline_only_warns(resume, tmp_path):
    def offline(*args):
        raise RuntimeError("could not connect")

    verdict = compare(SOURCE, resume, gh=offline, cache=tmp_path / "c")
    assert verdict.state == UNKNOWN and "could not connect" in verdict.line


def test_gh_not_installed_only_warns(resume, tmp_path, monkeypatch):
    monkeypatch.setenv("PATH", str(tmp_path))
    assert compare(SOURCE, resume, cache=tmp_path / "c").state == UNKNOWN


def test_the_kept_sha_saves_a_gh_call_until_it_ages(resume, tmp_path):
    calls, clock = [], [1000.0]

    def gh(*args):
        calls.append(args)
        return blob_sha(resume)

    for _ in range(2):
        compare(SOURCE, resume, gh=gh, cache=tmp_path / "c", now=lambda: clock[0])
    assert len(calls) == 1
    clock[0] += resume_check.FRESH_SECONDS + 1
    compare(SOURCE, resume, gh=gh, cache=tmp_path / "c", now=lambda: clock[0])
    assert len(calls) == 2
    compare({**SOURCE, "path": "other.pdf"}, resume, gh=gh, cache=tmp_path / "c", now=lambda: clock[0])
    assert len(calls) == 3  # another file's answer is never reused


def test_a_resume_that_is_not_a_file_stops(tmp_path):
    assert compare(SOURCE, tmp_path / "gone.pdf", gh=lambda *a: "x" * 40, cache=tmp_path / "c").state == STALE


def test_the_default_policies_are_empty_for_everyone():
    assert yaml.safe_load((cli.home.CODE / "policies.default.yaml").read_text())["resume_source"] is None


def a_profile(folder, **policies):
    folder.mkdir()
    (folder / "applicant-profile.yaml").write_text((FIXTURES / "profile.yaml").read_text())
    (folder / "one-pager.pdf").write_bytes((FIXTURES / "one-pager.pdf").read_bytes())
    rules = yaml.safe_load((FIXTURES / "policies.yaml").read_text()) | {"live_runs": True} | policies
    (folder / "policies.yaml").write_text(yaml.safe_dump(rules))
    return folder / "applicant-profile.yaml"


@pytest.mark.parametrize("command", [["rehearse", "https://jobs.example.com/a/1"], ["run"], ["approve-pass"]])
def test_a_stale_resume_stops_a_live_start_before_anything_runs(command, tmp_path, monkeypatch):
    path = a_profile(tmp_path / "mine", resume_source=SOURCE)
    theirs = hashlib.sha1(b"new").hexdigest()
    monkeypatch.setattr(resume_check, "_gh_sha", lambda *a: theirs)
    monkeypatch.setattr(resume_check, "CACHE", tmp_path / "c")
    monkeypatch.setattr(cli, "live_adapters", lambda *a, **k: pytest.fail("a run started"))
    monkeypatch.setattr(rehearsal, "rehearse", lambda *a, **k: pytest.fail("a rehearsal started"))
    with pytest.raises(SystemExit) as stopped:
        cli.main([*command, "--profile", str(path)])
    message = str(stopped.value)
    assert message.startswith(f"apply {command[0]}: the resume is out of date") and theirs in message and "\n" not in message


def test_gh_offline_warns_at_a_live_start_and_carries_on(tmp_path, monkeypatch, capsys):
    path = a_profile(tmp_path / "mine", resume_source=SOURCE)

    def offline(*args):
        raise RuntimeError("could not connect")

    monkeypatch.setattr(resume_check, "_gh_sha", offline)
    monkeypatch.setattr(resume_check, "CACHE", tmp_path / "c")
    cli._refuse_stale_resume(ApplicantProfile.load(path), "run")
    assert "warning" in capsys.readouterr().err


@pytest.mark.parametrize(("state", "level"), [(SAME, doctor.OK), (UNKNOWN, doctor.WARN), (STALE, doctor.FAIL)])
def test_doctor_says_each_verdict(state, level, tmp_path):
    profile = ApplicantProfile({"files": {"resume_pdf": "resume.pdf"}}, tmp_path, {"resume_source": SOURCE})
    machine = doctor.Machine(profile, resume_check=lambda source, resume: resume_check.Verdict(state, "said"))
    assert [(c.name, c.level) for c in doctor._resume_source(machine)] == [("Resume", level)]


def test_doctor_prints_no_line_when_unset(tmp_path):
    machine = doctor.Machine(ApplicantProfile({}, tmp_path, {}), resume_check=lambda *a: pytest.fail("checked"))
    assert doctor._resume_source(machine) == []
