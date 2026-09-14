# Third-party notices

The architecture draws on the projects below. At this revision the backend is
a scaffold: no scraper implementation or company CSVs have been copied into
it. The entries describe design influences and planned reuse, not an inventory
of already vendored code. Record actual copied paths and data counts when
those changes land, retaining the relevant notices with the adapted material.

The [research appendix](../../docs/KAN-55_SCRAPER_RESEARCH.md) records inspected
revisions and the adaptation map. The MIT copyright notices and license text
for these four references are retained below.

---

## Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships

Copyright (c) 2026 Shah Zain — MIT
<https://github.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships>

Reviewed revision: `fd622ad36b2f85cfbc2c103bf7c05a45dbfb1a89`.

Planned adaptation: provider-envelope validation, completeness and presence
contracts, lifecycle regression cases, two-miss closure/reopening, HTTPX
network policy, and breaker schedule. WorkIt replaces JSON/mirror persistence
with per-board transactions and permits authoritative publication corrections.

## ats-scrapers

Copyright (c) 2026 Kalil Bouzigues — MIT
<https://github.com/kalil0321/ats-scrapers>

Reviewed revision: `6b44a1badc9bfbf5cf176f75265cc5729e520e99`.

Planned adaptation: selected provider mappings and candidate company
directories. The `companies/` directory currently contains only a README.
The bounded upstream `raw` field is not WorkIt's full-payload replay policy.

## job-board-aggregator

Copyright (c) 2026 Riley Dorrington — MIT
<https://github.com/Feashliaa/job-board-aggregator>

Reviewed revision: `e694d83cc6c706bbda88321c1f43ace648836e6c`.

Design influence: provider-level anomaly alerts and conservative Ashby
concurrency. The upstream alert thresholds are not copied as a per-board
closure gate or WorkIt release criterion.

## job-board-scraper

Copyright (c) 2023 Andrew Gramigna — MIT
<https://github.com/adgramigna/job-board-scraper>

Reviewed revision: `c40daade3b9dc842d4d9e886eeeb7ffc5b4ebe37`.

Design influence: run provenance and expected-source coverage checks. WorkIt
does not adopt Python-created tables, per-item commits, or same-day activity
inference.

## Additional design references

[Scrapy](https://docs.scrapy.org/en/latest/) informed the cache/error distinction
and network policy; [Airbyte](https://github.com/airbytehq/airbyte) informed
checkpoint-after-commit semantics. Neither contributes copied code or a
runtime dependency in this change.

---

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
