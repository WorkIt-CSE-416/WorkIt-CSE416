# Scraper implementation guidance

The scraper's existing design and pacing rules are in `CLAUDE.md`.

Inline-description providers (Ashby, Lever, Recruitee, TikTok, Jibe) use
`providers.text._listing_page`: title eligibility first, then full-text
experience eligibility for ambiguous titles, then expensive card parsing only
for kept postings. Keep all listing IDs even when their page is omitted; board
completeness and metrics need them.

`Job.shortlist_tags` records that full-text decision. `None` means a legacy or
detail-only posting; an empty tuple means evaluated and rejected. Use
`shortlist.classify_job` for filtering, rendering and closing reasons. Never
reclassify a staged posting from its display description: section selection or
the 8,000-character cap can hide either a low or a high experience requirement.
Metrics reuse the same decision. The decision is serialized for offline renders;
inline readers refresh it on every complete read. Changes to classification rules
must account for these stored decisions, including postings on resting boards.

The full-text fallback deliberately differs from the former display-text check
when relevant requirements were removed or truncated. Regression tests cover both
newly discovered low-experience evidence and higher requirements beyond the cap.
HTML is parsed with the same entity/block-boundary rules used for card text; do
not replace it with tag stripping that joins words or matches tag attributes.

Run `uvx ruff check .`, `uvx ruff format --check .`, and `uvx pytest` from this
folder. On Windows with Python 3.13, set `PYTHONUTF8=1` for the existing gold corpus
fixtures, which use the platform's default encoding when reading UTF-8 JSON.
