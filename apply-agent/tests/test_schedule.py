"""`apply schedule`: launchd jobs for the Daily sweep and the 5-minute
Requests check. Plists are checked on their XML; launchctl is a fake, and
nothing touches ~/Library."""

import os
import plistlib
from datetime import datetime
from pathlib import Path

import pytest
from conftest import APPLY

from apply import schedule
from apply.cli import main

UV = "/opt/homebrew/bin/uv"
PROJECT = Path("/Users/test-person/apply-repo/apply")
LOGS = Path("/Users/test-person/Library/Logs/apply")
PATH = "/opt/homebrew/bin:/usr/bin:/bin"


def plist_of(job: schedule.Job) -> dict:
    xml = schedule.plist(job, uv=UV, project=PROJECT, logs=LOGS, path=PATH)
    assert xml.startswith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist')
    return plistlib.loads(xml.encode())


def test_the_daily_sweep_runs_apply_run_from_the_repo_with_uv_once_a_day_at_its_time():
    [sweep, _] = schedule.jobs("07:30")

    assert plist_of(sweep) == {
        "Label": "local.apply.daily-sweep",
        "ProgramArguments": [UV, "run", "--project", str(PROJECT), "apply", "run"],
        "WorkingDirectory": str(PROJECT),
        "StartCalendarInterval": {"Hour": 7, "Minute": 30},
        "StandardOutPath": str(LOGS / "daily-sweep.log"),
        "StandardErrorPath": str(LOGS / "daily-sweep.log"),
        "EnvironmentVariables": {"PATH": PATH},
    }


def test_the_requests_check_runs_apply_run_requests_only_every_five_minutes():
    [_, check] = schedule.jobs("07:30")

    assert plist_of(check) == {
        "Label": "local.apply.requests-check",
        "ProgramArguments": [UV, "run", "--project", str(PROJECT), "apply", "run", "--requests-only"],
        "WorkingDirectory": str(PROJECT),
        "StartInterval": 300,
        "StandardOutPath": str(LOGS / "requests-check.log"),
        "StandardErrorPath": str(LOGS / "requests-check.log"),
        "EnvironmentVariables": {"PATH": PATH},
    }


@pytest.mark.parametrize("bad", ["25:00", "7", "7:5", "noon", 420])  # 420: YAML's reading of an unquoted 07:00
def test_a_daily_sweep_time_that_is_not_hh_mm_is_refused(bad):
    with pytest.raises(ValueError, match="daily_sweep_at"):
        schedule.jobs(bad)


class FakeLaunchctl:
    """launchctl in Lisul's GUI session: which labels are loaded, and every call made."""

    domain = "gui/501"

    def __init__(self, loaded: set[str] = frozenset()):
        self.loaded_labels = set(loaded)
        self.calls: list[tuple[str, str]] = []

    def bootstrap(self, plist: Path) -> None:
        self.calls.append(("bootstrap", str(plist)))
        self.loaded_labels.add(plistlib.loads(plist.read_bytes())["Label"])

    def bootout(self, label: str) -> None:
        self.calls.append(("bootout", label))
        self.loaded_labels.discard(label)

    def loaded(self, label: str) -> bool:
        return label in self.loaded_labels


SWEEP, CHECK = "local.apply.daily-sweep", "local.apply.requests-check"


def scheduler(tmp_path: Path, launchctl: FakeLaunchctl) -> schedule.Scheduler:
    return schedule.Scheduler(schedule.jobs("07:00"), launchctl, agents=tmp_path / "LaunchAgents",
                              logs=tmp_path / "Logs" / "apply", uv=UV, project=PROJECT, path=PATH)


def test_install_writes_both_plists_and_says_how_to_load_them_but_loads_nothing(tmp_path):
    launchctl = FakeLaunchctl()

    said = "\n".join(scheduler(tmp_path, launchctl).install())

    agents = tmp_path / "LaunchAgents"
    sweep, check = agents / f"{SWEEP}.plist", agents / f"{CHECK}.plist"
    assert plistlib.loads(sweep.read_bytes())["ProgramArguments"][-1] == "run"
    assert plistlib.loads(check.read_bytes())["ProgramArguments"][-1] == "--requests-only"
    assert (tmp_path / "Logs" / "apply").is_dir()
    assert launchctl.calls == []
    assert "apply schedule install --load" in said
    assert f"launchctl bootstrap gui/501 {sweep} {check}" in said


def test_install_with_load_bootstraps_each_job_reloading_one_already_loaded(tmp_path):
    launchctl = FakeLaunchctl(loaded={SWEEP})

    scheduler(tmp_path, launchctl).install(load=True)

    agents = tmp_path / "LaunchAgents"
    assert launchctl.calls == [
        ("bootout", SWEEP), ("bootstrap", str(agents / f"{SWEEP}.plist")),
        ("bootstrap", str(agents / f"{CHECK}.plist")),
    ]


def test_uninstall_unloads_the_loaded_jobs_and_removes_both_plists(tmp_path):
    launchctl = FakeLaunchctl()
    jobs = scheduler(tmp_path, launchctl)
    jobs.install()
    launchctl.loaded_labels = {CHECK}

    jobs.uninstall()

    assert launchctl.calls == [("bootout", CHECK)]
    assert list((tmp_path / "LaunchAgents").iterdir()) == []


def test_status_says_whether_each_job_is_loaded_and_when_it_last_ran(tmp_path):
    launchctl = FakeLaunchctl(loaded={SWEEP})
    jobs = scheduler(tmp_path, launchctl)
    jobs.install()
    log = tmp_path / "Logs" / "apply" / "daily-sweep.log"
    log.write_text("Dashboard: http://127.0.0.1:8765\n")
    ran = datetime(2026, 10, 16, 7, 0, 12).timestamp()
    os.utime(log, (ran, ran))

    assert jobs.status() == [
        f"{SWEEP}: loaded, daily at 07:00; last ran 2026-10-16 07:00 (its log: {log})",
        f"{CHECK}: installed, not loaded, every 5 minutes; never ran",
    ]


def test_the_daily_sweeps_time_is_read_from_its_installed_plist(tmp_path):
    assert schedule.daily_sweep_at(tmp_path / "LaunchAgents") is None
    schedule.Scheduler(schedule.jobs("06:30"), FakeLaunchctl(), agents=tmp_path / "LaunchAgents",
                       logs=tmp_path / "Logs" / "apply", uv=UV, project=PROJECT, path=PATH).install()

    assert schedule.daily_sweep_at(tmp_path / "LaunchAgents") == "06:30"


def test_status_of_a_job_never_installed_says_so(tmp_path):
    assert scheduler(tmp_path, FakeLaunchctl()).status() == [
        f"{SWEEP}: not installed (apply schedule install)",
        f"{CHECK}: not installed (apply schedule install)",
    ]


@pytest.fixture
def launch_agents(monkeypatch, tmp_path) -> FakeLaunchctl:
    """`apply schedule` over a temporary ~/Library and a fake launchctl."""
    launchctl = FakeLaunchctl()
    monkeypatch.setattr(schedule, "AGENTS", tmp_path / "LaunchAgents")
    monkeypatch.setattr(schedule, "LOGS", tmp_path / "Logs" / "apply")
    monkeypatch.setattr(schedule, "Launchctl", lambda: launchctl)
    return launchctl


def test_apply_schedule_install_runs_the_daily_sweep_at_the_policys_time_and_loads_nothing(
        launch_agents, monkeypatch, tmp_path, capsys):
    monkeypatch.setattr("apply.cli.load_policies", lambda: {"schedule": {"daily_sweep_at": "06:15"}})

    main(["schedule", "install"])

    sweep = plistlib.loads((tmp_path / "LaunchAgents" / f"{SWEEP}.plist").read_bytes())
    assert sweep["StartCalendarInterval"] == {"Hour": 6, "Minute": 15}
    assert sweep["WorkingDirectory"] == str(APPLY)
    assert launch_agents.calls == []
    assert "apply schedule install --load" in capsys.readouterr().out


def test_apply_schedule_install_load_then_status_then_uninstall(launch_agents, tmp_path, capsys):
    main(["schedule", "install", "--load"])  # at policies.yaml's own time
    main(["schedule", "status"])
    assert f"{SWEEP}: loaded, daily at" in capsys.readouterr().out

    main(["schedule", "uninstall"])

    assert [call for call, _ in launch_agents.calls] == ["bootstrap", "bootstrap", "bootout", "bootout"]
    assert list((tmp_path / "LaunchAgents").iterdir()) == []
