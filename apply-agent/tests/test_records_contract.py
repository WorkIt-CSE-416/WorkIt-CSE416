"""The Records contract, run against every Records adapter so they stay in step:
the in-memory fake, the git repo adapter over a local bare repo, the local
folder a rehearsal keeps its Records in, and the live GitHub repo (skipped
unless APPLY_TEST_RECORDS_REMOTE names a scratch repo)."""

import os
import subprocess
import threading
import uuid
from datetime import date
from pathlib import Path

import pytest

from apply.model import Posting, Question, Status
from apply.records import Filled, FolderRecords, GitRecords, InMemoryRecords, Record

WEB = "https://github.com/test-person/apply-records"
PNG = b"\x89PNG\r\n\x1a\nfake"


def record(company: str = "Arc", email: str = "test.person@example.com", status: Status = Status.SUBMITTED) -> Record:
    posting = Posting(str(uuid.uuid4()), company, "Software Engineer Intern", "https://jobs.example.com/1")
    filled = Filled([Question("email", "Email", "text")], {"email": email}, {"email": email}, PNG)
    return Record(posting, status, "", filled, date(2026, 10, 15))


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


class Memory:
    def __init__(self, tmp_path: Path):
        self.records = InMemoryRecords()

    def read(self, link: str) -> dict[str, bytes]:
        return self.records.files(link)


class Folder:
    def __init__(self, tmp_path: Path):
        self.root = tmp_path / "rehearsals"
        self.records = FolderRecords(self.root)

    def read(self, link: str) -> dict[str, bytes]:
        folder = Path(link)
        assert folder.is_relative_to(self.root)
        return {file.name: file.read_bytes() for file in folder.iterdir()}


class LocalGit:
    """GitRecords pushing to a bare repo on disk, standing in for GitHub."""

    def __init__(self, tmp_path: Path):
        self.remote = tmp_path / "apply-records.git"
        git("init", "-q", "--bare", str(self.remote))
        self.records = GitRecords(str(self.remote), clone=tmp_path / "clone", web=WEB)

    def read(self, link: str) -> dict[str, bytes]:
        """The Record's files as pushed to the remote, found from its link."""
        assert link.startswith(f"{WEB}/tree/main/")
        folder = link.removeprefix(f"{WEB}/tree/main/")
        names = git("--git-dir", str(self.remote), "ls-tree", "--name-only", f"main:{folder}").split()
        return {
            name: subprocess.run(
                ["git", "--git-dir", str(self.remote), "show", f"main:{folder}/{name}"], check=True, capture_output=True
            ).stdout
            for name in names
        }


class LiveGitHub(LocalGit):
    def __init__(self, tmp_path: Path):
        remote = os.environ.get("APPLY_TEST_RECORDS_REMOTE")
        if not remote:
            pytest.skip("set APPLY_TEST_RECORDS_REMOTE to a scratch GitHub repo to run against the live remote")
        self.remote = tmp_path / "mirror.git"
        self.url = remote
        self.records = GitRecords(remote, clone=tmp_path / "clone", web=WEB)

    def read(self, link: str) -> dict[str, bytes]:
        git("clone", "-q", "--mirror", self.url, str(self.remote))
        return super().read(link)


@pytest.fixture(params=[Memory, LocalGit, Folder, LiveGitHub], ids=["memory", "git", "folder", "live-github"])
def backend(request, tmp_path):
    return request.param(tmp_path)


def test_a_saved_record_is_at_its_link(backend):
    saved = record()
    link = backend.records.save(saved)

    files = backend.read(link)
    assert files["form.png"] == PNG
    assert b"test.person@example.com" in files["answers.json"]
    assert b"Arc: Software Engineer Intern" in files["README.md"]


def test_a_record_keeps_its_essays_as_written(backend):
    essays = "## Why Arc?\nI build boats' software.\n"
    link = backend.records.save(Record(**{**record().__dict__, "essays": essays}))

    assert backend.read(link)["essays.md"] == essays.encode()


def test_records_of_two_applications_have_their_own_links(backend):
    first, second = backend.records.save(record("Arc")), backend.records.save(record("Skydio"))

    assert first != second
    assert b"Arc" in backend.read(first)["README.md"]
    assert b"Skydio" in backend.read(second)["README.md"]


def test_saving_an_application_again_replaces_its_record(backend):
    held = record(email="typo@example.co", status=Status.HELD)
    backend.records.save(held)
    link = backend.records.save(Record(held.posting, Status.SUBMITTED, "", record().filled, held.day))

    files = backend.read(link)
    assert b"typo@example.co" not in files["answers.json"]
    assert b"submitted" in files["README.md"]


def test_saving_again_with_no_screenshot_keeps_the_one_it_had(backend):
    # Visa, Northrop and Zillow (2026-11-03): a shutdown closed the page, and the Record saved after it had no screenshot.
    held = record(status=Status.HELD)
    backend.records.save(held)
    gone = Record(held.posting, Status.HANDOFF, "", Filled([], {}, {}, b""), held.day)
    link = backend.records.save(gone)

    files = backend.read(link)
    assert files["form.png"] == PNG
    assert b"handoff" in files["README.md"]


# The git adapter alone: what a real clone and remote add.


def test_a_record_saved_while_the_remote_is_unreachable_goes_up_with_the_next(tmp_path):
    local = LocalGit(tmp_path)
    local.records.save(record("Warmup"))  # the clone exists from an earlier run
    offline = local.remote.rename(tmp_path / "away.git")

    waiting = local.records.save(record("Arc"))
    offline.rename(local.remote)
    later = local.records.save(record("Skydio"))

    assert b"Arc" in local.read(waiting)["README.md"]
    assert b"Skydio" in local.read(later)["README.md"]


def test_workers_saving_at_once_lose_no_record(tmp_path):
    local = LocalGit(tmp_path)
    links: list[str] = []

    def worker(n: int) -> None:
        for i in range(3):
            links.append(local.records.save(record(f"Company {n}-{i}")))

    threads = [threading.Thread(target=worker, args=(n,)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(set(links)) == 12
    for link in links:
        assert local.read(link)["form.png"] == PNG


def test_a_new_clone_of_a_remote_with_records_keeps_them(tmp_path):
    local = LocalGit(tmp_path)
    old = local.records.save(record("Arc"))

    local.records = GitRecords(str(local.remote), clone=tmp_path / "new-mac", web=WEB)
    new = local.records.save(record("Skydio"))

    assert b"Arc" in local.read(old)["README.md"]
    assert b"Skydio" in local.read(new)["README.md"]
