"""Exercise direct-to-main discovery publishing against local Git."""

import json
import subprocess
from pathlib import Path

import pytest

import discovery_pr as publishing


def candidate(token, company=None):
    company = company or token.title()
    return {
        "ats": "lever",
        "token": token,
        "companies": [company],
        "status": "validated",
        "postings": 2,
        "evidence": [
            {
                "url": f"https://jobs.lever.co/{token}",
                "company": company,
                "source": "https://example.com/list",
            }
        ],
    }


class Repository:
    def __init__(self, root, origin, monkeypatch):
        self.root, self.origin = root, origin
        self.rows = []
        self.exit_code = 0
        self.on_discover = None
        self.excluded = None
        self.resolution = None
        self.resolution_offset = None
        self.real_command = publishing.command
        monkeypatch.setattr(publishing, "command", self.command)
        monkeypatch.setattr(publishing.discover_boards, "main", self.discover)

    def git(self, *args, cwd=None):
        return self.real_command(["git", *args], cwd or self.root)

    def command(self, args, cwd):
        return self.real_command(args, cwd)

    def discover(self, args):
        assert "--apply" not in args
        assert "--resolve" in args
        assert args[args.index("--resolve-limit") + 1] == "100"
        assert args[args.index("--resolve-seconds") + 1] == "120"
        self.resolution_offset = int(args[args.index("--resolve-offset") + 1])
        self.excluded = json.loads(Path(args[args.index("--exclude") + 1]).read_text())
        Path(args[args.index("--report") + 1]).write_text(
            json.dumps(
                {
                    "generated_at": "2026-10-28T12:00:00+00:00",
                    "candidates": self.rows,
                    "channel_failures": [] if not self.exit_code else [{"error": "TimeoutError"}],
                    "resolution": self.resolution,
                }
            )
        )
        if self.on_discover:
            callback, self.on_discover = self.on_discover, None
            callback()
        return self.exit_code

    def run(self):
        result = publishing.run(self.root, "owner/repo", publishing=True)
        # Sync local HEAD with origin/main so subsequent runs pass the HEAD check.
        self.git("fetch", "origin", "main")
        self.git("reset", "--hard", "FETCH_HEAD")
        return result

    def show_main(self, filename):
        self.git("fetch", "origin", "main")
        return self.git("show", f"FETCH_HEAD:{filename}")

    def main_has(self, filename):
        try:
            self.git("ls-tree", "--name-only", "origin/main", "--", filename)
            return True
        except subprocess.CalledProcessError:
            return False


@pytest.fixture
def repository(tmp_path, monkeypatch):
    root, origin = tmp_path / "repo", tmp_path / "origin.git"
    root.mkdir()

    def git(*args):
        subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)

    git("init", "--bare", str(origin))
    git("init", "-b", "main")
    git("config", "user.name", "Test Developer")
    git("config", "user.email", "test@example.com")
    (root / "scraper").mkdir()
    (root / publishing.CATALOG).write_text(
        "# Base catalog\nats,token,company\nlever,known,Original\n"
    )
    (root / ".gitignore").write_text("scraper/discovery-report.json\n")
    git("add", ".")
    git("commit", "-m", "Initial catalog")
    git("remote", "add", "origin", str(origin))
    git("push", "-u", "origin", "main")
    return Repository(root, origin, monkeypatch)


def test_discovery_commits_to_main(repository):
    repo = repository
    before = repo.show_main(publishing.CATALOG)
    repo.rows = [candidate("acme")]
    assert repo.run() == 0
    after = repo.show_main(publishing.CATALOG)
    assert after != before
    assert "lever,acme,Acme" in after
    # No extra branches created
    branches = repo.git("ls-remote", "--heads", "origin")
    assert branches.count("refs/heads/") == 1


def test_repeated_discovery_adds_more_boards(repository):
    repo = repository
    repo.rows = [candidate("acme")]
    repo.run()
    repo.rows = [candidate("acme"), candidate("another")]
    repo.run()
    catalog = repo.show_main(publishing.CATALOG)
    assert "lever,acme,Acme" in catalog
    assert "lever,another,Another" in catalog


def test_removed_row_is_rejected_and_not_restored(repository):
    repo = repository
    repo.rows = [candidate("acme")]
    repo.run()
    # Simulate rejection: remove the CSV row and mark rejected in ledger.
    # Local HEAD is already synced to origin/main by run().
    catalog = (repo.root / publishing.CATALOG).read_text()
    (repo.root / publishing.CATALOG).write_text(catalog.replace("lever,acme,Acme\n", ""))
    ledger = json.loads((repo.root / publishing.LEDGER).read_text())
    ledger["lever/acme"]["decision"] = "rejected"
    (repo.root / publishing.LEDGER).write_text(json.dumps(ledger))
    repo.git("add", "--", publishing.CATALOG, publishing.LEDGER)
    repo.git("commit", "-m", "Reject acme")
    repo.git("push", "origin", "main")
    # Next run should not re-add acme
    repo.rows = [candidate("acme")]
    repo.run()
    assert "lever,acme" not in repo.show_main(publishing.CATALOG)
    new_ledger = json.loads(repo.show_main(publishing.LEDGER))
    assert new_ledger["lever/acme"]["decision"] == "rejected"
    assert repo.excluded["lever/acme"]["decision"] == "rejected"


def test_no_candidates_creates_no_commit(repository):
    repo = repository
    before = repo.git("ls-remote", "origin", "refs/heads/main").split()[0]
    assert repo.run() == 0
    after = repo.git("ls-remote", "origin", "refs/heads/main").split()[0]
    assert before == after


def test_resolution_cursor_advances_even_without_new_boards(repository):
    repo = repository
    before = repo.show_main(publishing.CATALOG)
    repo.resolution = {"next_offset": 100}
    assert repo.run() == 0
    assert repo.resolution_offset == 0
    assert json.loads(repo.show_main(publishing.RESOLUTION_STATE)) == {"next_offset": 100}
    repo.resolution = {"next_offset": 103, "timed_out": True}
    assert repo.run() == 0
    assert repo.resolution_offset == 100
    assert json.loads(repo.show_main(publishing.RESOLUTION_STATE)) == {"next_offset": 103}
    assert repo.show_main(publishing.CATALOG) == before


def test_resolution_timeout_publishes_successes_and_cursor_together(repository):
    repo = repository
    repo.rows = [candidate("acme")]
    repo.resolution = {"next_offset": 2, "timed_out": True}
    assert repo.run() == 0
    assert "lever,acme,Acme" in repo.show_main(publishing.CATALOG)
    assert json.loads(repo.show_main(publishing.RESOLUTION_STATE)) == {"next_offset": 2}


def test_partial_failure_still_commits_successes(repository):
    repo = repository
    repo.rows = [candidate("acme")]
    repo.exit_code = 1
    assert repo.run() == 1
    assert "lever,acme,Acme" in repo.show_main(publishing.CATALOG)


def test_rejected_main_catalog_fails_before_collecting(repository):
    repo = repository
    (repo.root / publishing.LEDGER).write_text(
        json.dumps({"lever/known": {"decision": "rejected"}})
    )
    repo.git("add", "--", publishing.LEDGER)
    repo.git("commit", "-m", "Inconsistent rejected catalog")
    repo.git("push", "origin", "main")
    with pytest.raises(ValueError, match="(?i)reject"):
        repo.run()


def test_push_race_is_rejected_by_git(repository):
    """If someone pushes to main between fetch and push, git rejects non-fast-forward."""
    repo = repository
    repo.rows = [candidate("acme")]
    raced = False

    def racing_command(args, cwd):
        nonlocal raced
        if args[:2] == ["git", "push"] and not raced:
            raced = True
            # Push a commit to main while we're about to push
            subprocess.run(
                ["git", "commit", "--allow-empty", "-m", "Race"],
                cwd=repo.root,
                check=True,
                capture_output=True,
                env={
                    **subprocess.os.environ,
                    "GIT_AUTHOR_NAME": "Racer",
                    "GIT_AUTHOR_EMAIL": "r@example.com",
                    "GIT_COMMITTER_NAME": "Racer",
                    "GIT_COMMITTER_EMAIL": "r@example.com",
                },
            )
            subprocess.run(
                ["git", "push", "origin", "main"],
                cwd=repo.root,
                check=True,
                capture_output=True,
            )
        return repo.real_command(args, cwd)

    repo.on_discover = None
    original_command = publishing.command
    publishing.command = racing_command
    try:
        with pytest.raises(subprocess.CalledProcessError):
            repo.run()
    finally:
        publishing.command = original_command
    assert raced


@pytest.mark.parametrize("source", ["argument", "environment", "remote"])
def test_cli_resolves_repository_without_live_github(monkeypatch, source):
    monkeypatch.delenv("GITHUB_REPOSITORY", raising=False)
    seen = []
    if source == "environment":
        monkeypatch.setenv("GITHUB_REPOSITORY", "owner/from-env")
    elif source == "argument":
        monkeypatch.setenv("GITHUB_REPOSITORY", "owner/ignored-env")

    def command(args, cwd):
        assert source == "remote"
        assert args == ["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]
        return "owner/from-remote"

    def run(root, repository, *, publishing):
        seen.append((repository, publishing))
        return 0

    monkeypatch.setattr(publishing, "command", command)
    monkeypatch.setattr(publishing, "run", run)
    args = ["--repo", "owner/from-argument"] if source == "argument" else []
    assert publishing.main(args) == 0
    expected = {
        "argument": "owner/from-argument",
        "environment": "owner/from-env",
        "remote": "owner/from-remote",
    }
    assert seen == [(expected[source], False)]
