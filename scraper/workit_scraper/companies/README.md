# Board registry seed data

This directory is a placeholder. No company CSVs have been vendored yet.

The planned source is [ats-scrapers at the reviewed revision](https://github.com/kalil0321/ats-scrapers/tree/6b44a1badc9bfbf5cf176f75265cc5729e520e99)
(MIT, © 2026 Kalil Bouzigues); see [the notices](../THIRD_PARTY.md).
Import candidates for Greenhouse, Lever, Ashby, and SmartRecruiters into
per-provider CSVs with `name,slug,url`, retaining the original source URL and
regional host. Record the actual imported paths, revision, and row counts at
import time. There is no verified registry size in this scaffold.

Candidates are not automatically enabled sources. The planned `discover`
command validates provider hosts, preserves token case, and probes candidates
before registering boards. Deduplicate by `(ats, api_host, board_token)`, not
company display name. Preserve ambiguous or quiet candidates for later probing:
an empty SmartRecruiters response alone does not establish that a slug is dead.

Discovery neither creates memberships nor marks companies claimed. See the
[architecture](../../../docs/KAN-55_JOB_SCRAPER.md#registry-and-local-commands)
for registry behavior and the separate database-free dry-run input contract.
