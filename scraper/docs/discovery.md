# Discover more company boards

Run these commands from `scraper/` with Python 3.12 or newer. Discovery is
on demand; the existing scheduled scrape still reads its curated lists and
then the saved boards. No database access or additional packages are needed.

```sh
python discover_boards.py --channel curated --limit 20
python discover_boards.py --channel hn --months 3 --limit 20
python discover_boards.py --channel ddg --query "site:jobs.ashbyhq.com fintech"
python discover_boards.py --channel github --query "jobs.lever.co in:file"
python discover_boards.py --channel google --query "site:jobs.ashbyhq.com fintech"
```

Repeat `--channel` to combine sources. Curated discovery includes the existing
internship/new-grad lists and crypto-jobs-fyi's AI, crypto, finance, and tech
company datasets. HN reads the monthly “Who is hiring?” threads. Search channels
look for supported ATS links in search results or GitHub code fragments.

GitHub needs `GITHUB_TOKEN` or `GH_TOKEN` in the environment. Google needs
`GOOGLE_CSE_KEY` and `GOOGLE_CSE_CX` for an available Custom Search configuration.
These channels use your configured services and quotas. DuckDuckGo needs no
key but may refuse automated requests; refusals are reported, not bypassed.
Every source and board request respects robots.txt and existing pacing rules.

The command writes `discovery-report.json` by default (`--report` selects another
path). It records each candidate's source URL, company attribution, validation
status, and posting count. Unsupported URLs appear under `unmatched`; channel
failures are reported separately and cause a nonzero exit. `--limit` caps new
board validations and search result counts. Complete board validation can involve
multiple pages for Workday and Oracle. It never fetches individual job details.

Each curated source or HN thread is independent: its failure is recorded with
its source URL, successful discoveries are retained, and later sources are still
tried. With `--apply`, valid discoveries can be added even if another source
failed; the command still exits nonzero to signal partial failure. Each evidence
entry retains its company attribution, and HN entries link to individual comments
when an ID is supplied. Curated parsing uses the source's job URL field rather
than treating company homepages or unrelated metadata as application links.

Review the report. `validated` boards have a complete successful provider read;
zero postings is valid. `already_known` boards require no request. `deferred`
boards exceeded this run's limit. `needs_company` or `conflicting_companies`
require a verified company attribution; they cannot be applied automatically.

To add a discovered board with its verified name:

```sh
python discover_boards.py --url https://jobs.ashbyhq.com/acme --company "Acme" --apply
```

The URL above is illustrative. Use the real board URL from the report. You can
also repeat a discovery command with `--apply` to add its validated, named
candidates. Application revalidates boards and appends new rows atomically,
preserving existing names and rows. Repeating it is idempotent. `--boards` allows
an alternate CSV for experiments. Review and commit the `boards.csv` additions
so scheduled runs inherit them; local discovery does not deploy anything.

The report path must differ from the catalog path. Relative, absolute, symlink,
and hard-link aliases are rejected before any requests or writes. Catalog writes
use unique temporary files and atomic replacement; run catalog writers one at a
time, since this is not a concurrent database transaction.

New boards then enter the normal pipeline: ATS read, shortlist, feed, backend
import. Discovery does not change which job titles WorkIt keeps. There is no
new public contribution form, provider adapter, or scheduled search job in this
change; the named URL command is the manual contribution path.
