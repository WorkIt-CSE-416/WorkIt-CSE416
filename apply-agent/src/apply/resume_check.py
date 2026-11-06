"""Whether the resume a run attaches is the one its owner last accepted (KAN-663).

A profile can point at a resume file in an old checkout of a resume repo, and nothing else notices: every form
then gets the old resume. Set policies.yaml's `resume_source` to the repo and path of the accepted PDF, and
`apply doctor` and each start of `apply rehearse` and `apply run` compare the two by git blob sha. Unset, the
default, there is no check and `gh` never runs.

The repo's sha is kept in the data folder for a few minutes, so starts close together make one `gh` call, and
for when `gh` can't answer: then Apply warns and carries on, whatever the kept sha says, since only `gh`
knows what main holds now."""

import hashlib
import json
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from apply.home import HOME

CACHE = HOME / "resume-source.json"
FRESH_SECONDS = 600
GH_TIMEOUT = 15
SAME, STALE, UNKNOWN = "same", "stale", "unknown"


@dataclass(frozen=True)
class Verdict:
    state: str  # SAME, STALE or UNKNOWN
    line: str


def blob_sha(path: Path) -> str:
    """The sha git gives this file's contents, which is what GitHub's contents API says."""
    data = path.read_bytes()
    return hashlib.sha1(b"blob %d\0" % len(data) + data, usedforsecurity=False).hexdigest()


def _gh_sha(repo: str, path: str, branch: str) -> str:
    """The file's blob sha on the branch. Raises when `gh` can't say: not installed, offline or no such file."""
    done = subprocess.run(["gh", "api", f"repos/{repo}/contents/{quote(path)}?ref={quote(branch)}", "--jq", ".sha"],
                          capture_output=True, text=True, timeout=GH_TIMEOUT, stdin=subprocess.DEVNULL)
    sha = done.stdout.strip()
    if done.returncode or len(sha) != 40:
        raise RuntimeError(" ".join(done.stderr.split())[:200] or "no sha in gh's answer")
    return sha


def _kept(cache: Path, key: str, now: float) -> str | None:
    try:
        kept = json.loads(cache.read_text())
    except (OSError, ValueError):
        return None
    return kept["sha"] if isinstance(kept, dict) and kept.get("key") == key and now - kept.get("at", 0) < FRESH_SECONDS else None


def compare(source: dict | None, resume: Path | None, gh: Callable[[str, str, str], str] | None = None,
            cache: Path | None = None, now: Callable[[], float] = time.time) -> Verdict | None:
    """The profile's resume against the source's. None: no `resume_source`, so no check."""
    if not source:
        return None
    gh, cache = gh or _gh_sha, cache or CACHE
    repo, path, branch = source.get("repo"), source.get("path"), source.get("branch") or "main"
    if not repo or not path:
        return Verdict(UNKNOWN, "policies.yaml's resume_source needs both repo and path, so the resume was not checked")
    where = f"{path} on {repo} {branch}"
    if resume is None or not Path(resume).is_file():
        return Verdict(STALE, f"the Applicant profile's resume ({resume}) is not a file, so it can't match {where}")
    key = f"{repo}:{branch}:{path}"
    theirs = _kept(cache, key, now())
    if theirs is None:
        try:
            theirs = gh(repo, path, branch)
        except Exception as error:  # gh missing, offline, or timed out: never stops a run
            return Verdict(UNKNOWN, f"couldn't read {where} with gh, so the resume was not checked ({error})")
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps({"key": key, "sha": theirs, "at": now()}))
        except OSError:
            pass  # only a kept answer lost: the next start asks gh again
    mine = blob_sha(Path(resume))
    if mine == theirs:
        return Verdict(SAME, f"{resume} matches {where} ({mine})")
    return Verdict(STALE, f"the resume is out of date: {resume} is {mine}, but {where} is {theirs}. "
                          "Point files.resume_pdf at the latest PDF, or update that checkout")
