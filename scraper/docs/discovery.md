# Discover more company boards

Discovery finds candidate boards on supported ATS platforms. A successful
provider read confirms that a board is live; it does **not** prove that the
company name supplied by a third-party source is correct. Developers make that
decision in a pull request before the three-hour scrape uses a new board.

## Daily discovery and review

`.github/workflows/discover-boards.yml` runs daily at 05:43 UTC after merging to
main, or manually on main. It runs `python3 scraper/discovery_pr.py --publish`
from the repository root. Curated lists and the latest Hacker News hiring thread
supply leads; no search API credentials are needed. The validation limit is 20,
with a UTC-day offset that rotates through candidates rather than repeatedly
checking only the first ones.

**The repository must let GitHub Actions open pull requests** (Settings →
Actions → General → Workflow permissions → "Allow GitHub Actions to create and
approve pull requests"). With it off, the first scheduled run (2026-10-29)
pushed `codex/board-discovery-after-0` and then failed at `gh pr create` with
"GitHub Actions is not permitted to create or approve pull requests", so no PR
appeared. A PR opened with `github.token` also starts no other workflow, so CI
does not run on it until a person pushes to the branch or closes and reopens it.

The workflow maintains **one rolling PR**. Validated candidates become proposed
rows in `scraper/boards.csv`, accompanied by `scraper/discovery-review.json`
(the durable decision and evidence ledger) and generated
`scraper/discovery-review.md` (the readable review summary). Evidence records
include the source URL, claimed company, ATS, board token, observed posting
count, and validation time. Zero postings is a valid complete read, but still
requires human review of the company association.

Review the evidence and the real company careers page, then edit the PR branch:

- Keep accepted CSV rows. They enter the scraping catalog only when the PR is
  merged by a developer.
- Correct the company name in the CSV when needed. Later discovery runs preserve
  that correction.
- Remove a proposed CSV row to reject it. Later runs infer the rejection from the
  existing ledger and do not restore it, even when the same source finds it again.
  Setting its ledger `decision` to `rejected` queues removal for the next discovery
  run; it does not remove the CSV row immediately. **Before merging, remove the
  rejected CSV row yourself or wait for discovery to remove it.** Run the checks
  again after removal. CI and the scraper refuse a catalog that still contains
  explicitly rejected boards.
- Keep the ledger in the PR when merging, including rejected entries. If all
  proposals are rejected, remove their CSV rows and merge the ledger changes so
  those decisions persist on main. To intentionally reconsider a rejection,
  remove its ledger entry in a reviewed change.

Do not edit the generated Markdown evidence summary; it is regenerated from the
ledger. It presents observations, not independent proof of company ownership.
There is no trusted-company manifest and no automated ownership approval.

Repeated daily runs update the same `codex/board-discovery-<cycle>` branch using
normal pushes. Main updates are merged into the proposal branch without force
pushes; conflicts stop the run for review. Once the PR is merged, the next
proposal starts a new cycle. Closing the PR without merging pauses automation
rather than opening a replacement that discards the review; reopen it to resume,
or merge the rejection ledger before closing the cycle.

The workflow does not approve or merge PRs, or push catalog changes to main.
The three-hour workflow reads only the catalog already committed on main and no
longer calls `build_boards.py`. On an unprotected main branch, requiring a human
review remains a team convention; configure branch protection if it must be
enforced by GitHub. Adding commits to a rolling PR may dismiss previous
approvals according to the repository's review settings.

Enable **Allow GitHub Actions to create and approve pull requests** under the
repository's Actions workflow permissions. The workflow requests `contents:
write` and `pull-requests: write`; despite the setting's name, it only creates or
updates a PR, never approves one. Scheduled and manual publishing use trusted
main code; proposal-branch code is never executed, and only proposal data is read.

As verified on 2026-10-28, this repository's Actions PR-creation setting is still
disabled, so publishing is not active until it is enabled. PR events created with
`GITHUB_TOKEN` create approval-required workflow runs: a developer must choose
**Approve workflows**, then wait for the checks to pass before merging. See
[GitHub's workflow-trigger documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

The discovery report is uploaded as a workflow artifact for 30 days, including
failure runs. Independent source failures preserve successful proposals but
still fail the run visibly. A malformed report or publishing conflict must not
silently replace review decisions.

## Local discovery

Run these commands from `scraper/` with Python 3.12 or newer:

```sh
python discover_boards.py --channel curated --limit 20
python discover_boards.py --channel hn --months 3 --limit 20
python discover_boards.py --channel ddg --query "site:jobs.ashbyhq.com fintech"
python discover_boards.py --channel github --query "jobs.lever.co in:file"
python discover_boards.py --channel google --query "site:jobs.ashbyhq.com fintech"
```

Repeat `--channel` to combine sources. Curated discovery includes the existing
internship/new-grad lists and crypto-jobs-fyi's AI, crypto, finance, and tech
company datasets. HN reads monthly “Who is hiring?” threads. Search channels
look for supported ATS links in search results or GitHub code fragments.

GitHub search needs `GITHUB_TOKEN` or `GH_TOKEN`. Google needs `GOOGLE_CSE_KEY`
and `GOOGLE_CSE_CX`. These use the configured services and quotas. DuckDuckGo
needs no key but may refuse requests. All source and board requests respect
robots.txt and pacing; refusals are reported, not bypassed. The scraper remains
standard-library-only and discovery does not access the database.

`discovery-report.json` records candidates, their source evidence, statuses,
posting counts, and the report's `generated_at` timestamp. Unsupported URLs
appear under `unmatched`; source failures appear separately and cause a nonzero
exit. Successful results remain in the report if an independent source fails.
`--limit` caps new board validations and search result counts; `--offset` rotates
candidate validation after known boards and ambiguous company names are excluded.
Complete validation may read multiple pages for Workday or Oracle, but does not
fetch individual posting details.

`validated` means a complete successful ATS read. `already_known` boards need
no request. `deferred` boards were outside this run's validation window.
`needs_company` and `conflicting_companies` need a reviewed company attribution;
they are not proposed automatically. A live board with the wrong company name
is still wrong, so do not treat `validated` as approval to merge.

For a named candidate, use the real board URL and company name:

```sh
python discover_boards.py --url https://jobs.ashbyhq.com/acme --company "Acme"
```

That URL is illustrative. Preview is the default. `--apply` remains an explicit
local operation that appends validated, unambiguously named rows to a CSV; review
and commit those changes manually. Scheduled discovery never uses this path to
write main. `--boards` and `--report` allow alternate files for experiments;
report and catalog must not alias, including symlinks and hard links. Catalog
updates are atomic and additive; run local writers one at a time.

To preview the rolling PR update, run `python3 scraper/discovery_pr.py` from the
repository root with GitHub CLI authentication. The command discovers the
repository through `gh repo view` outside Actions; `--repo owner/repository`
overrides that selection. Publishing requires its explicit `--publish` flag and
a current main checkout. This is separate from the collector's local `--apply`.
Each cycle uses a stable branch name, so a failed PR-creation request resumes
the already-pushed proposal on retry instead of creating orphan branches.

New merged boards enter the existing ATS-read, shortlist, feed, and backend-import
pipeline. Discovery does not change title filters or add new ATS provider readers.
`build_boards.py` remains a local legacy importer; its output also requires review
and must not be restored to the automatic three-hour scrape.
