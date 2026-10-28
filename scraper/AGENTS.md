# Board discovery

Existing scraper architecture and provider rules are in `CLAUDE.md`; read that
file before changing a reader. This file adds the discovery contract.

`discover_boards.py` is an on-demand companion to `build_boards.py`. It does not
run in the three-hour scrape. It uses the existing provider registry, robots
checks, pacing, and HTTP client. Keep the scraper standard-library-only.

- Preview is the default. `--apply` adds only new boards whose existing provider
  reader completed and whose evidence supplies one unambiguous company name.
  An empty successful response is a live board; a failed or partial read is not.
- Search URLs without company attribution remain `needs_company` in the report.
  Do not turn their slugs or search snippets into company names: every downstream
  card trusts boards.csv. Supply a verified URL and company through the CLI.
- Candidate URLs must match an actual provider host, not an embedded URL in a
  query/path or a lookalike hostname. Preserve Oracle token case and Lever region.
- Keep source URLs and statuses in the report. Deduplicate known boards before
  applying the validation limit; truncating curated links first starves discoveries
  behind already-known boards. Existing company names and board rows never change.
- API credentials belong only in request headers, not logs or reports. The HTTP
  client retains its identifying User-Agent and rejects cross-origin redirects.
- Common Crawl is excluded under the robots restriction recorded in CLAUDE.md.
  Unsupported ATS URLs are reported; adding readers is a separate provider change.

Usage and credentials: `docs/discovery.md`.

Shared boundaries: `providers/urls.py` owns board URL recognition for both
commands; `board_read.py` owns the robots/pacing/read result; `catalog.py` owns
CSV serialization and atomic writes. Commands do not import each other or the
scrape entry point. Keep provider failures distinguishable from empty success.

`discovery_sources.py` declares each curated source's application URL field.
Do not scan arbitrary metadata recursively: company homepages are not ATS leads.
`discovery_channels.CHANNELS` owns channel dispatch and query requirements.
Collection returns evidence and per-source failures; a failed independent source
must not discard successful evidence. Reports retain company attribution per
evidence entry, and report/catalog paths must never alias, even during preview.
