"""Scheduled runs: the launchd jobs that start the Daily sweep once a day
and the Requests check every 5 minutes (`apply schedule`)."""

import os
import plistlib
import re
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

# The 5-minute Requests check between Daily sweeps.
REQUESTS_EVERY = 5 * 60
# Where Lisul's launchd agents and their logs live.
AGENTS = Path.home() / "Library" / "LaunchAgents"
LOGS = Path.home() / "Library" / "Logs" / "apply"
# Apply's folder (apply-agent/), which uv runs `apply` from.
PROJECT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Job:
    """One launchd job: an `apply` command, either once a day `at` (hour,
    minute) local time, or `every` so many seconds."""

    name: str
    command: tuple[str, ...]
    at: tuple[int, int] | None = None
    every: int | None = None

    @property
    def label(self) -> str:
        return f"local.apply.{self.name}"


def jobs(daily_sweep_at: str) -> list[Job]:
    """The Daily sweep, at `daily_sweep_at` ("HH:MM", policies.yaml:
    schedule.daily_sweep_at), and the Requests check."""
    return [
        Job("daily-sweep", ("run",), at=_time(daily_sweep_at)),
        Job("requests-check", ("run", "--requests-only"), every=REQUESTS_EVERY),
    ]


def plist(job: Job, *, uv: str, project: Path, logs: Path, path: str) -> str:
    """The launchd plist (XML) that runs `job` with `uv` from the `project`
    (Apply's folder, apply-agent/), logging to `logs`, with PATH `path` (launchd's own
    has neither uv's folder nor claude's)."""
    log = str(logs / f"{job.name}.log")
    spec = {
        "Label": job.label,
        "ProgramArguments": [uv, "run", "--project", str(project), "apply", *job.command],
        "WorkingDirectory": str(project),
        "StandardOutPath": log,
        "StandardErrorPath": log,
        "EnvironmentVariables": {"PATH": path},
    }
    if job.at:
        spec["StartCalendarInterval"] = {"Hour": job.at[0], "Minute": job.at[1]}
    if job.every:
        spec["StartInterval"] = job.every
    return plistlib.dumps(spec).decode()


class Scheduler:
    """Installs `jobs` as launchd agents: their plists in `agents`
    (~/Library/LaunchAgents), loaded through `launchctl` only when asked."""

    def __init__(self, jobs: list[Job], launchctl, *, agents: Path, logs: Path, uv: str, project: Path, path: str):
        self._jobs, self._launchctl, self._agents, self._logs = jobs, launchctl, agents, logs
        self._uv, self._project, self._path = uv, project, path

    def install(self, load: bool = False) -> list[str]:
        """Write each job's plist; with `load`, load it too (again, if it
        was loaded). What was done, in lines for the terminal."""
        self._agents.mkdir(parents=True, exist_ok=True)
        self._logs.mkdir(parents=True, exist_ok=True)
        said = []
        for job in self._jobs:
            self._plist(job).write_text(plist(job, uv=self._uv, project=self._project, logs=self._logs, path=self._path))
            said.append(f"Wrote {self._plist(job)}: apply {' '.join(job.command)} {_when(job)}.")
        if load:
            for job in self._jobs:
                if self._launchctl.loaded(job.label):
                    self._launchctl.bootout(job.label)
                self._launchctl.bootstrap(self._plist(job))
                said.append(f"Loaded {job.label}.")
        else:
            plists = " ".join(str(self._plist(job)) for job in self._jobs)
            said += ["Not loaded. Load (or reload) them with: apply schedule install --load",
                     f"  (or: launchctl bootstrap {self._launchctl.domain} {plists})"]
        said.append(f"Logs go to {self._logs}/. While live_runs is false in policies.yaml, each run refuses "
                     "to start and logs why.")
        return said

    def uninstall(self) -> list[str]:
        """Unload each loaded job and remove every plist."""
        said = []
        for job in self._jobs:
            if self._launchctl.loaded(job.label):
                self._launchctl.bootout(job.label)
                said.append(f"Unloaded {job.label}.")
            if self._plist(job).exists():
                self._plist(job).unlink()
                said.append(f"Removed {self._plist(job)}.")
        return said or ["Nothing was installed."]

    def status(self) -> list[str]:
        """For each job: installed, loaded, when it runs (as its installed
        plist says) and when it last ran (its log's last write)."""
        said = []
        for job in self._jobs:
            if not self._plist(job).exists():
                said.append(f"{job.label}: not installed (apply schedule install)")
                continue
            installed = plistlib.loads(self._plist(job).read_bytes())
            loaded = "loaded" if self._launchctl.loaded(job.label) else "installed, not loaded"
            log = Path(installed.get("StandardOutPath", self._logs / f"{job.name}.log"))
            ran = (f"last ran {datetime.fromtimestamp(log.stat().st_mtime):%Y-%m-%d %H:%M} (its log: {log})"
                   if log.exists() else "never ran")
            said.append(f"{job.label}: {loaded}, {_when(_installed(job, installed))}; {ran}")
        return said

    def _plist(self, job: Job) -> Path:
        return self._agents / f"{job.label}.plist"


class Launchctl:
    """launchctl in Lisul's GUI session, where a run can open its windows and read Keychain."""

    def __init__(self):
        self.domain = f"gui/{os.getuid()}"

    def bootstrap(self, plist: Path) -> None:
        self._launchctl("bootstrap", self.domain, str(plist))

    def bootout(self, label: str) -> None:
        self._launchctl("bootout", f"{self.domain}/{label}")

    def loaded(self, label: str) -> bool:
        return subprocess.run(["launchctl", "print", f"{self.domain}/{label}"], capture_output=True).returncode == 0

    def _launchctl(self, *args: str) -> None:
        done = subprocess.run(["launchctl", *args], capture_output=True, text=True)
        if done.returncode:
            raise RuntimeError(f"launchctl {' '.join(args)}: {done.stderr.strip() or done.returncode}")


def live(daily_sweep_at: str) -> Scheduler:
    """The Scheduler over ~/Library and the real launchctl, running this
    checkout's apply-agent/ with the uv and PATH of the shell that installs it."""
    return Scheduler(jobs(daily_sweep_at), Launchctl(), agents=AGENTS, logs=LOGS, uv=shutil.which("uv") or "uv",
                     project=PROJECT, path=os.environ.get("PATH", ""))


def daily_sweep_at(agents: Path = AGENTS) -> str | None:
    """When the installed Daily sweep runs each day, "07:00"; None while it is not installed."""
    plist = agents / f"{Job('daily-sweep', ()).label}.plist"
    if not plist.exists():
        return None
    at = plistlib.loads(plist.read_bytes()).get("StartCalendarInterval")
    return f"{at['Hour']:02d}:{at['Minute']:02d}" if at else None


def _installed(job: Job, spec: dict) -> Job:
    """`job` as its installed plist schedules it."""
    at = spec.get("StartCalendarInterval")
    return Job(job.name, job.command, at=(at["Hour"], at["Minute"]) if at else None, every=spec.get("StartInterval"))


def _when(job: Job) -> str:
    return f"daily at {job.at[0]:02}:{job.at[1]:02}" if job.at else f"every {job.every // 60} minutes"


def _time(text: str) -> tuple[int, int]:
    """(hour, minute) of "HH:MM". Unquoted in YAML, 07:00 reads as the number 420: refused."""
    time = re.fullmatch(r"(\d{1,2}):(\d{2})", text) if isinstance(text, str) else None
    if not time or int(time[1]) > 23 or int(time[2]) > 59:
        raise ValueError(f"schedule.daily_sweep_at in policies.yaml must be a quoted time of day, "
                         f"such as \"07:00\", not {text!r}")
    return int(time[1]), int(time[2])
