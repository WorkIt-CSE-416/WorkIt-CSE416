"""Exercise proposal publishing against local Git, never real GitHub."""

import json
import subprocess
from copy import deepcopy
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
        self.prs = []
        self.creates = 0
        self.create_failures = 0
        self.calls = 0
        self.rows = []
        self.exit_code = 0
        self.on_discover = None
        self.excluded = None
        self.real_command = publishing.command
        monkeypatch.setattr(publishing, "command", self.command)
        monkeypatch.setattr(publishing, "pull_requests", lambda *_: deepcopy(self.prs))
        monkeypatch.setattr(publishing.discover_boards, "main", self.discover)

    def git(self, *args, cwd=None):
        return self.real_command(["git", *args], cwd or self.root)

    def command(self, args, cwd):
        if args[:3] != ["gh", "pr", "create"]:
            return self.real_command(args, cwd)
        if self.create_failures:
            self.create_failures -= 1
            raise subprocess.CalledProcessError(1, args, stderr="Temporary API failure")
        self.creates += 1
        branch = args[args.index("--head") + 1]
        sha = self.git("ls-remote", "origin", f"refs/heads/{branch}").split()[0]
        pr = {
            "number": self.creates,
            "state": "open",
            "merged_at": None,
            "head": {"ref": branch, "sha": sha, "repo": {"full_name": "owner/repo"}},
            "html_url": f"https://github.com/owner/repo/pull/{self.creates}",
        }
        self.prs.append(pr)
        return pr["html_url"]

    def discover(self, args):
        assert "--apply" not in args
        self.calls += 1
        self.excluded = json.loads(Path(args[args.index("--exclude") + 1]).read_text())
        Path(args[args.index("--report") + 1]).write_text(
            json.dumps(
                {
                    "generated_at": "2026-10-28T12:00:00+00:00",
                    "candidates": self.rows,
                    "channel_failures": [] if not self.exit_code else [{"error": "TimeoutError"}],
                }
            )
        )
        if self.on_discover:
            callback, self.on_discover = self.on_discover, None
            callback()
        return self.exit_code

    def run(self):
        result = publishing.run(self.root, "owner/repo", publishing=True)
        self.refresh_head()
        return result

    def refresh_head(self):
        for pr in self.prs:
            if pr["state"] == "open":
                pr["head"]["sha"] = self.git("ls-remote", "origin", pr["head"]["ref"]).split()[0]

    def show(self, filename, *, main=False):
        branch = "main" if main else self.prs[-1]["head"]["ref"]
        self.git("fetch", "origin", branch)
        return self.git("show", f"FETCH_HEAD:{filename}")

    def edit(self, transform, filename=publishing.CATALOG):
        branch = self.prs[-1]["head"]["ref"]
        self.git("fetch", "origin", branch)
        path = self.root.parent / "reviewer"
        self.git("worktree", "add", "--detach", str(path), "FETCH_HEAD")
        try:
            target = path / filename
            target.write_text(transform(target.read_text() if target.exists() else ""))
            self.git("add", "--", filename, cwd=path)
            self.git("commit", "-m", "Developer review", cwd=path)
            self.git("push", "origin", f"HEAD:{branch}", cwd=path)
        finally:
            self.git("worktree", "remove", "--force", str(path))
        self.refresh_head()

    def merge(self):
        pr = self.prs[-1]
        self.git("fetch", "origin", pr["head"]["ref"])
        self.git("merge", "--ff-only", "FETCH_HEAD")
        self.git("push", "origin", "main")
        pr.update(state="closed", merged_at="2026-10-28T13:00:00Z")


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


def test_repeated_discovery_updates_one_pr_and_never_main(repository):
    repo = repository
    before = repo.show(publishing.CATALOG, main=True)
    repo.rows = [candidate("acme")]
    assert repo.run() == 0
    branch = repo.prs[0]["head"]["ref"]
    assert branch.startswith(publishing.PREFIX)
    assert "lever,acme,Acme" in repo.show(publishing.CATALOG)
    assert repo.show(publishing.CATALOG, main=True) == before
    repo.rows = [candidate("acme"), candidate("another")]
    assert repo.run() == 0
    assert repo.creates == 1
    assert repo.prs[0]["head"]["ref"] == branch
    assert "lever,another,Another" in repo.show(publishing.CATALOG)
    assert repo.show(publishing.CATALOG, main=True) == before


def test_removed_row_is_rejected_and_not_restored(repository):
    repo = repository
    repo.rows = [candidate("acme")]
    repo.run()
    repo.edit(lambda text: text.replace("lever,acme,Acme\n", ""))
    repo.run()
    assert "lever,acme" not in repo.show(publishing.CATALOG)
    ledger = json.loads(repo.show(publishing.LEDGER))
    assert ledger["lever/acme"]["decision"] == "rejected"
    assert repo.excluded["lever/acme"]["decision"] == "rejected"
    assert repo.creates == 1


def test_reviewer_company_edit_survives_new_candidates(repository):
    repo = repository
    repo.rows = [candidate("acme")]
    repo.run()
    repo.edit(lambda text: text.replace("lever,acme,Acme", "lever,acme,Acme Corporation"))
    repo.rows.append(candidate("another"))
    repo.run()
    assert "lever,acme,Acme Corporation" in repo.show(publishing.CATALOG)
    assert repo.creates == 1


def test_merged_pr_starts_new_cycle_with_rejections_remembered(repository):
    repo = repository
    repo.rows = [candidate("acme"), candidate("rejected")]
    repo.run()
    old_branch = repo.prs[-1]["head"]["ref"]
    repo.edit(lambda text: text.replace("lever,rejected,Rejected\n", ""))
    # Merge before another discovery run records the row deletion.
    repo.merge()
    repo.rows.append(candidate("next"))
    repo.run()
    assert repo.creates == 2
    assert repo.prs[-1]["head"]["ref"] != old_branch
    assert "lever,next,Next" in repo.show(publishing.CATALOG)
    assert "lever,rejected" not in repo.show(publishing.CATALOG)
    assert repo.excluded["lever/rejected"]["decision"] == "rejected"
    assert "lever,next" not in repo.show(publishing.CATALOG, main=True)


def test_closed_unmerged_pr_blocks_reproposal(repository):
    repo = repository
    repo.rows = [candidate("acme")]
    repo.run()
    repo.prs[0]["state"] = "closed"
    with pytest.raises(ValueError, match="closed without merging"):
        repo.run()
    assert repo.calls == 1
    assert repo.creates == 1


def test_reviewer_commit_during_discovery_blocks_publish(repository):
    repo = repository
    repo.rows = [candidate("acme")]
    repo.run()
    repo.rows.append(candidate("another"))
    repo.on_discover = lambda: repo.edit(
        lambda text: text.replace("lever,acme,Acme", "lever,acme,Reviewed Acme")
    )
    with pytest.raises(ValueError, match="reviewer updated"):
        repo.run()
    assert "lever,acme,Reviewed Acme" in repo.show(publishing.CATALOG)
    assert "lever,another" not in repo.show(publishing.CATALOG)


def test_non_review_changes_on_proposal_branch_are_rejected(repository):
    repo = repository
    repo.rows = [candidate("acme")]
    repo.run()
    repo.edit(lambda _: "print('untrusted')\n", "unexpected.py")
    with pytest.raises(ValueError, match="non-review changes"):
        repo.run()
    assert repo.calls == 1


def test_partial_collection_failure_still_proposes_successes(repository):
    repo = repository
    repo.rows = [candidate("acme")]
    repo.exit_code = 1
    assert repo.run() == 1
    assert repo.creates == 1
    assert "lever,acme,Acme" in repo.show(publishing.CATALOG)


def test_no_candidates_creates_no_pr(repository):
    assert repository.run() == 0
    assert repository.creates == 0
    assert repository.git("ls-remote", "--heads", "origin").count("refs/heads/") == 1


def test_failed_pr_creation_recovers_same_branch_and_evidence(repository):
    repo = repository
    repo.rows = [candidate("acme")]
    repo.create_failures = 1
    before = repo.show(publishing.CATALOG, main=True)
    with pytest.raises(subprocess.CalledProcessError):
        repo.run()
    branch = publishing.PREFIX + "after-0"
    repo.git("fetch", "origin", branch)
    original_head = repo.git("rev-parse", "FETCH_HEAD")
    original_ledger = repo.git("show", f"FETCH_HEAD:{publishing.LEDGER}")
    assert repo.prs == []
    # Retry with no matching source records: earlier proposals must survive,
    # and the exact unchanged branch still needs its PR created.
    repo.rows = []
    assert repo.run() == 0
    assert repo.creates == 1
    assert repo.prs[0]["head"]["ref"] == branch
    assert repo.prs[0]["head"]["sha"] == original_head
    assert repo.show(publishing.LEDGER) == original_ledger
    assert "lever,acme,Acme" in repo.show(publishing.CATALOG)
    assert repo.git("ls-remote", "--heads", "origin").count("refs/heads/") == 2
    assert repo.show(publishing.CATALOG, main=True) == before


def test_push_race_rejects_without_overwriting_reviewer(repository, monkeypatch):
    repo = repository
    repo.rows = [candidate("acme")]
    repo.run()
    repo.rows.append(candidate("another"))
    raced = False

    def command(args, cwd):
        nonlocal raced
        if args[:2] == ["git", "push"] and not raced:
            raced = True
            # This happens after publish's API head check, exercising Git's
            # non-fast-forward rejection rather than the earlier API guard.
            repo.edit(lambda text: text.replace("lever,acme,Acme", "lever,acme,Reviewed Acme"))
        return repo.command(args, cwd)

    monkeypatch.setattr(publishing, "command", command)
    with pytest.raises(subprocess.CalledProcessError):
        repo.run()
    assert raced
    assert "lever,acme,Reviewed Acme" in repo.show(publishing.CATALOG)
    assert "lever,another" not in repo.show(publishing.CATALOG)
    assert repo.creates == 1


def test_new_cycle_is_rechecked_before_first_publish(repository):
    repo = repository
    repo.rows = [candidate("acme")]
    # Another publishing actor completed a PR cycle during collection. Neither
    # snapshot has an open PR, but the old after-0 cycle must not be published.
    repo.on_discover = lambda: repo.prs.append(
        {"number": 7, "state": "closed", "merged_at": "2026-10-28T13:00:00Z"}
    )
    with pytest.raises(ValueError, match="cycle changed"):
        repo.run()
    assert repo.creates == 0
    assert repo.git("ls-remote", "--heads", "origin").count("refs/heads/") == 1


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
    assert repo.calls == 0
    assert repo.creates == 0


def test_pending_ledger_rejection_is_reconciled_before_validation(repository):
    repo = repository
    repo.rows = [candidate("acme")]
    repo.run()

    def reject(text):
        ledger = json.loads(text)
        ledger["lever/acme"]["decision"] = "rejected"
        return json.dumps(ledger)

    repo.edit(reject, publishing.LEDGER)
    assert repo.run() == 0
    assert "lever,acme" not in repo.show(publishing.CATALOG)
    assert repo.excluded["lever/acme"]["decision"] == "rejected"


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
