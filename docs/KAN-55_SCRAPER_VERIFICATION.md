# KAN-55 — Job scraper verification

How we prove the ingestion pipeline is correct, well-behaved, and fit to run
unattended against real employer ATS feeds. Read the
[architecture](KAN-55_JOB_SCRAPER.md) first; every gate below traces to a rule
stated there, and the section references are load-bearing.

This is the **post-implementation** document. The acceptance table in
architecture §7 is the *test plan* written alongside the code — the minimum
that must be green for a milestone to land. This document is the *verification
suite*: what we run after everything exists, to decide whether we are willing
to point it at 14,600 real boards and walk away.

The two differ in kind, not just in size. §7 asks "does this branch behave as
specified?" and is answered by unit tests against fixtures. This document asks
"is the specification itself satisfied in the world?" — which needs live
conformance, measured throughput, adversarial input, crash injection, and a
human comparing scraped rows against the employer's actual careers page.

## How to use this document

Work the gates **in order**. Each one assumes its predecessors pass, and later
gates are expensive: Gate H spends real requests against real providers, and
there is no point discovering a lifecycle bug there that Gate C would have
caught offline in milliseconds.

Every check has an **ID**, a **method**, and a **pass criterion that is
measurable**. If a criterion cannot be evaluated to true or false without
discussion, it is a defect in this document — fix the criterion rather than
arguing about the result.

| Column | Meaning |
| --- | --- |
| **ID** | Stable reference. Cite it in PRs, commit messages, and sign-off. |
| **Verifies** | The architecture rule under test, with section. |
| **Method** | `unit`, `integration`, `property`, `chaos`, `live`, `manual`, `static` |
| **Evidence** | What gets attached to sign-off. A green test name, a number, a saved artifact. |

**Evidence discipline.** "It worked when I ran it" is not evidence. A check
passes when a named, re-runnable artifact says so: a test ID, a metric with a
threshold, a saved report under `scraper/.verification/` (gitignored, like
`.scraped/`). Anything a human judged by eye — Gate G sampling, Gate H
reconciliation — gets a dated note with the sample size and who did it.

**On failure.** A failed check blocks the gate. Record the failure, fix it, and
re-run the whole gate rather than the single check — most of these rules
interact, and a fix to lifecycle handling routinely breaks caching.

---

## Gate A — Static integrity

Cheap, fully automated, runs on every commit. If Gate A is red nothing else is
worth running.

| ID | Verifies | Method | Pass criterion |
| --- | --- | --- | --- |
| A1 | Lint clean | static | `uv --directory scraper run ruff check .` exits 0 |
| A2 | Types clean under strict mode | static | `uv --directory scraper run mypy .` exits 0, no `# type: ignore` added without an inline justification comment |
| A3 | Formatting stable | static | `ruff format --check .` exits 0 |
| A4 | Test suite green offline | unit | `uv --directory scraper run pytest` exits 0 **with the network disabled** (see M2) |
| A5 | Adapters import without a database (§2) | static | Importing every module under `workit_scraper/sources/` in a subprocess with no DB env vars and no SQLAlchemy installed succeeds |
| A6 | Dry run does not import the ORM (§2, §6) | integration | After `poll --dry-run`, `sqlalchemy` is absent from `sys.modules` |
| A7 | No real captured responses in Git (§7, scraper/CLAUDE.md) | static | See A7 check below — CI-enforced, not a convention |
| A8 | Third-party attribution current | manual | `workit_scraper/THIRD_PARTY.md` lists every adapted file with its pinned upstream revision; reviewer confirms each entry against the actual import |
| A9 | No ad-hoc DDL in the scraper (§1) | static | `grep -rniE '\b(create|alter|drop)\s+(table|index|type|schema)\b' workit_scraper/` returns nothing outside comments |
| A10 | Single Alembic history (§1) | static | Exactly one `alembic_version` table and one `versions/` directory across the backend; `alembic heads` reports exactly one head |
| A11 | v1 runs with no database at all | integration | A full `poll --store json` completes with no DB env vars set and no database package importable |
| A12 | `.scraped/` output is gitignored | static | CI fails if any file under `scraper/.scraped/` or `scraper/.verification/` is staged |

**A7 in detail.** The fixture rule is the one most likely to erode quietly,
because pasting a real response is the fastest way to write a test. Enforce it
mechanically:

- Every file under `tests/fixtures/` is either synthetic or sanitized, and
  carries a header comment naming which.
- No fixture contains a string matching a real company domain from the seed
  registry, a real `boards-api.greenhouse.io` job ID pattern captured verbatim,
  or an email address outside `@example.com` / `@example.org`.
- `scraper/.scraped/` and `scraper/.verification/` are gitignored and CI fails
  if either appears in a commit.
- Live probe output never lands under `tests/`.

A reviewer should be able to read any fixture and tell, without external
lookup, that the company in it does not exist.

---

## Gate B — Provider contract conformance (offline)

Per-provider, against synthetic fixtures. This is where "universally working"
is won or lost: the four providers disagree about envelopes, identity,
pagination, and which fields exist at all, and the failure mode is a provider
that silently degrades rather than erroring.

### B.1 Envelope validation matrix

Run **every** case against **every** provider. The expected result differs by
provider, and that is the point — a validator that accepts Lever's array for
Greenhouse is a bug that only shows up when Greenhouse has an outage.

| Case | Greenhouse | Lever | Ashby | SmartRecruiters |
| --- | --- | --- | --- | --- |
| Well-formed populated listing | complete | complete | complete | complete |
| Well-formed **empty** listing | complete, 0 IDs | complete, 0 IDs | complete, 0 IDs | complete, 0 IDs |
| Top-level array | **reject** | accept | **reject** | **reject** |
| Top-level object with expected key | accept | **reject** | accept | accept |
| Truthy `error` field present | reject → partial/failed | reject | reject | reject |
| `error: null` and otherwise valid | **accept** | accept | accept | accept |
| Members not objects | partial | partial | partial | partial |
| Member missing usable ID | partial, ID not observed | partial | partial | partial |
| Duplicate conflicting IDs | partial | partial | partial | partial |
| Truncated JSON | failed | failed | failed | failed |
| HTML error page, 200 status | failed | failed | failed | failed |
| Valid JSON, wrong schema entirely | failed | failed | failed | failed |

| ID | Verifies | Method | Pass criterion |
| --- | --- | --- | --- |
| B1 | Envelope shapes per provider (§2, §3) | unit | Full matrix above passes; no cell is skipped for any provider |
| B2 | `error: null` alone does not invalidate (§2) | unit | Explicit test per provider |
| B3 | Malformed payload never becomes empty-board evidence (§7) | unit | For every reject/failed cell, the result's `observed_ids` is not treated as a complete absence set downstream |
| B4 | Rejected content with a valid ID still supplies presence (§2) | unit | Job with unparseable title but valid ID appears in `observed_ids`, absent from `jobs` |
| B5 | No random identities generated (§2) | unit | Records failing ID validation produce no row and no synthesized key |

### B.2 Identity, pagination, and request key

| ID | Verifies | Method | Pass criterion |
| --- | --- | --- | --- |
| B6 | SmartRecruiters exhausts all pages (§3) | unit | Fixture board of 347 postings yields 347 distinct IDs across 4 pages |
| B7 | No 300-job ceiling (§3, §7) | unit | Explicit assertion that a >300 board is complete, not truncated |
| B8 | Short page before reported total → partial | unit | Result `incomplete_reason == pagination_stalled` |
| B9 | Changing `totalFound` mid-traversal → partial | unit | `incomplete_reason == inconsistent_total` |
| B10 | Overlapping IDs across pages → partial | unit | Detected and reported, not silently deduplicated into "complete" |
| B11 | Repeated identical page → partial | unit | Loop detection fires; traversal terminates |
| B12 | Malformed total → incomplete, not complete-empty (§3) | unit | Empty list plus unparseable total is never complete |
| B13 | Safety limit → partial, never "board ended" (§3) | unit | `incomplete_reason == safety_limit`, sweeping does not act on it |
| B14 | Registry identity unique on `(ats, api_host, board_token)` (§3) | unit | Duplicate insert rejected; token case preserved |
| B15 | EU Lever host preserved (§3) | unit | `api.eu.lever.co` board retains its host through discovery, polling, and request key |
| B16 | Two requisitions, same title and location, stay distinct (§3) | unit | Two rows, two external IDs |
| B17 | Request key covers representation-affecting inputs only (§2, §4) | unit | Changing `pay_transparency` changes the key; changing an unrelated header does not |

### B.3 Normalized posting fidelity

The architecture's rule is **preserve, never manufacture**. Each check below
has an inverse worth testing explicitly: the pipeline must not invent a value
that the source did not supply.

| ID | Verifies | Method | Pass criterion |
| --- | --- | --- | --- |
| B18 | Required fields enforced (§2) | unit | Blank external ID, title, display name, or non-HTTP(S) apply URL rejects the record |
| B19 | Greenhouse pay in cents converted correctly (§3) | unit | `7500000` cents → `75000.00`, currency preserved, **period left null when absent** |
| B20 | Missing salary period is not guessed (§3) | unit | No default of `year` |
| B21 | Multi-tier compensation retained (§5, §7) | unit | Three tiers in → three in `compensation_ranges`; scalar min/max populated only for the unambiguous base range |
| B22 | Bonus/equity not merged into base (§5) | unit | Distinct components stay distinct |
| B23 | All locations preserved (§2, §7) | unit | Secondary/tertiary locations survive; `location_raw` retained alongside parsed values |
| B24 | Unknown remote status stays null (§5, §7) | unit | Never defaults to onsite |
| B25 | `posted_at_precision` correct across the four values (§2) | unit | `exact`, `date_only`, `relative_derived`, `unknown` each produced by an appropriate fixture |
| B26 | Modification time never becomes publication date (§4) | unit | Lever `createdAt` does not populate a modification field; upstream `updated_at` does not populate `source_published_at` |
| B27 | Ashby `publishedAt` treated as last publication (§3) | unit | Republication does not reset `first_seen_at` |
| B28 | `is_listed` independent of `active` (§2) | unit | All four combinations representable |
| B29 | Lever description assembly (§3) | unit | Lists and additional sections concatenated in source order, no content dropped |
| B30 | SmartRecruiters section concatenation (§3) | unit | Description, qualifications, additional info, company description all present |
| B31 | HTML retained as untrusted (§5) | unit | `description_html` stored verbatim; `description_text` derived; neither is sanitized at ingest |
| B32 | Unknown optional fields become null, not empty string (§2) | unit | Distinguishable downstream |

---

## Gate C — Lifecycle correctness

The state machine that decides whether a job is open, and the single place
where a bug costs us user trust rather than data quality. A false closure
removes a real job from the product; a false retention advertises a role that
no longer exists.

The architecture's evidence table (§4) is a **total function** from evidence to
action. Verify it as one, not as a handful of happy paths.

### C.1 The evidence truth table

| ID | Evidence | Expected action | Method |
| --- | --- | --- | --- |
| C1 | ID observed in complete listing | reset streak, `last_seen_at` updated, `active=true`, closure cleared | unit |
| C2 | ID observed in **partial** listing | same as C1 — presence is presence | unit |
| C3 | ID absent, complete listing, sweeping on | streak +1 (exactly once) | unit |
| C4 | ID absent, second complete listing | `active=false`, `closed_at` set, `closed_reason=gone_from_feed` | unit |
| C5 | ID absent from **partial** result | streak unchanged, not reset | unit |
| C6 | ID absent from **failed** result | streak unchanged | unit |
| C7 | ID absent from **skipped** result | streak unchanged | unit |
| C8 | ID absent from **304** result | streak unchanged | unit |
| C9 | Provider marks posting unlisted | `is_listed=false`, **not** closed | unit |
| C10 | Same observation delivered twice | applied at most once | unit |
| C11 | Source version conflict | not applied; attempt marked superseded | unit |
| C12 | Sweeping disabled, ID absent | no increment, no closure | unit |
| C13 | Sweeping disabled → re-enabled | pending streaks were reset at disable; confirmation starts fresh | unit |

**C14 — exhaustiveness.** Enumerate the cross product of
`{outcome} × {ID present, ID absent} × {sweeping on, off} × {job active, closed}`
and assert every combination has a defined, tested expectation. Any cell
without one is an unspecified behaviour, which in practice means "whatever the
code happens to do."

### C.2 Sequences

Single transitions are easy; the architecture's real content is in sequences.

| ID | Sequence | Expected | Method |
| --- | --- | --- | --- |
| C15 | present → missing → missing | closes on the second miss, not the first | integration |
| C16 | present → missing → present → missing | ends **active**; the reappearance reset the streak (§7) | integration |
| C17 | present → missing → *partial* → missing | closes — the partial supplied no evidence either way, and two *accepted complete* absences accumulated | integration |
| C18 | present → missing → *304* → missing | closes; the 304 did not count as a miss **or** a reset | integration |
| C19 | closed → identical content reappears | same row reopens, `first_seen_at` survives, closure fields clear (§7) | integration |
| C20 | closed → remains absent | stays closed, streak does not grow, `closed_at` does not move (§4) | integration |
| C21 | present → unlisted → absent | unlisted first, then normal closure path; the two are independent (§7) | integration |
| C22 | Detail fetch fails while ID stays listed | streak reset, previous content retained, detail retried next poll even if listing unchanged (§7) | integration |

**C17 and C18 are the checks most likely to be wrong.** "Two misses" means two
distinct *accepted complete* observations since the last positive one (§4).
Implementations routinely count consecutive polls instead, which closes jobs
during provider instability — exactly the false-closure mode the rule exists to
prevent.

### C.3 Property-based verification

Example tests confirm the cases we thought of. The lifecycle rules imply
invariants that should hold over *arbitrary* evidence sequences, and property
testing (Hypothesis) is how we check the ones we did not think of.

Generate random sequences of observations — mixed outcomes, mixed presence,
sweeping toggled, versions conflicting — and assert:

| ID | Invariant | Why it matters |
| --- | --- | --- |
| C23 | A job closes only if at least two accepted complete listings omitted it since its last positive observation | The core false-closure guarantee |
| C24 | `first_seen_at` never changes after creation | Application links and analytics depend on it |
| C25 | `missing_streak` is never negative and never exceeds 2 without closure | Detects off-by-one and double-increment |
| C26 | A job observed at any point in a run is `active` at the end of that run | Presence always wins |
| C27 | Replaying an identical observation sequence yields identical final state | Idempotence over sequences, not just single writes |
| C28 | No sequence of `partial`/`failed`/`skipped`/`304` results alone ever closes a job | The negative-evidence rule |
| C29 | Employer-origin rows are byte-identical before and after any scraped sequence | The origin boundary (§5) |

Run these with a high example count in CI nightly (≥1000 sequences), lower in
per-commit CI. Save the failing seed on any failure — a property failure
without its seed is not reproducible and therefore not actionable.

---

## Gate D — Transaction integrity and concurrency

Where correctness meets crashes.

**This gate is split by store implementation.** v1 ships `JsonStore`, and file
replacement genuinely provides atomicity — a crash mid-write leaves the
previous board intact — so most of the gate runs against it. What files cannot
provide is multi-writer concurrency and real row locking, so those checks wait
for `PostgresStore`.

| Runs against | Checks |
| --- | --- |
| **Both stores** | D1, D2, D6, D8, D9, D10, D11, D12, D13 |
| **`PostgresStore` only** | D3, D4, D5, D7, D14 |

Run the shared checks against **both** implementations from one parameterized
suite. If a check passes on files and fails on Postgres, that difference is the
finding — it means the protocol leaked an assumption.

Postgres checks need a **real Postgres**; SQLite substitutes silently change
locking semantics and will pass tests that production fails.

How the shared checks read against `JsonStore`:

- **D1** — one board's jobs, payloads, outcome and checkpoint all land, or none;
  `os.replace()` is atomic.
- **D2** — inject failure after the ETag arrives but before the replace; the
  next poll issues an unconditional request.
- **D4** — version comparison is store-independent, so the mismatch path is
  fully testable on files.
- **D10** — `SIGKILL` mid-write leaves the previous board file intact and the
  attempt recoverable.

| ID | Verifies | Method | Pass criterion |
| --- | --- | --- | --- |
| D1 | Board commits atomically (§5) | integration | Jobs, payloads, lifecycle, outcome, and checkpoint all present, or none |
| D2 | Failure rolls back everything including the ETag (§5, §7) | chaos | Inject a failure after the ETag arrives but before commit; next poll issues an **unconditional** request |
| D3 | Source locked with `FOR UPDATE` (§5) — *Postgres only* | integration | Second writer blocks until the first commits |
| D4 | Version mismatch → superseded, nothing changed (§5) | integration | Jobs, checkpoint, and health all unchanged; source retried later |
| D5 | Two workers, one starting version — *Postgres only* | integration | Exactly one application; missing count incremented at most once (§7) |
| D6 | Lost acknowledgement, retried commit (§7) | integration | Returns the committed outcome; does **not** mark it superseded |
| D7 | **No database lock held during HTTP** (§5) — *Postgres only* | integration | Instrument: assert no transaction is open while the HTTP client is in flight. See M4 |
| D8 | Board failure does not stop other boards (§7) | integration | One board raises; others commit independently |
| D9 | Attempt failure recorded in a separate transaction (§5) | integration | Visible after the main transaction rolls back |
| D10 | Unfinished attempt visible after a hard crash | chaos | `SIGKILL` mid-transaction; the attempt row remains for recovery, no partial job writes |
| D11 | Retried invocation gets a new run ID; retried observation keeps its ID (§5) | integration | Both asserted |
| D12 | Registry edit during in-flight fetch (§5) | integration | Disabling a source advances its version; the in-flight result is rejected as obsolete |
| D13 | Closure preserved when sweeping disabled mid-fetch (§7) | integration | `closed_at` unchanged; obsolete version rejected |
| D14 | Parameterized SQL only — *Postgres only* | static + integration | No string-built SQL anywhere; a fixture with `'; DROP TABLE jobs;--` as a job title round-trips as literal text |

**D7 deserves its own note.** Holding a transaction open across an HTTP call is
the single scaling mistake this design most carefully avoids (§5: "Do not hold
database locks during HTTP work"). At four pilot boards it is invisible. At
14,600 it exhausts the connection pool and the symptom presents as unrelated
API timeouts. Verify it by construction — assert in the store layer that the
HTTP client is unreachable from inside a transaction context — not by reading
the code and believing it.

---

## Gate E — Conditional requests and caching

ETags are an optimization layered on top of the lifecycle machinery, and the
architecture is explicit that they must never become a source of false
evidence. The failure mode here is subtle and silent.

| ID | Verifies | Method | Pass criterion |
| --- | --- | --- | --- |
| E1 | All four preconditions required (§4) | unit | Each of the four is independently sufficient to suppress `If-None-Match` |
| E2 | Pending missing-job confirmation bypasses the ETag (§4, §7) | integration | The `200 missing → 304 → 304` sequence does **not** strand a job at one miss |
| E3 | Rejected content blocks conditional eligibility (§4) | integration | Unconditional request issued until resolved |
| E4 | Failed required details block eligibility (§4) | integration | Same |
| E5 | Due detail refresh forces a body response (§4) | integration | Same |
| E6 | 24-hour unconditional refresh floor honoured (§4) | integration | A body request is issued at least every 24h regardless of ETag validity |
| E7 | 304 updates validation time and health only (§4) | integration | `last_seen_at`, missing streaks, and job rows all unchanged |
| E8 | 304 uses the same version check as body responses (§4) | integration | Version conflict on a 304 is also rejected |
| E9 | ETag persisted only with a successful commit (§4) | chaos | Covered by D2 from the caching side |
| E10 | Partial result invalidates eligibility (§4) | unit | Validator not stored |
| E11 | Representation change clears the validator (§4) | unit | Changing the request key discards the old ETag |
| E12 | Complete listing with detail failures may store the validator, but pending work still forces recovery (§4) | integration | Both halves asserted |
| E13 | `Vary: *` disables conditional requests (§4) | unit | And any `Vary` the request key cannot represent |
| E14 | Unexpected 304 without a usable checkpoint (§4) | integration | Retried without the validator; failure recorded if no body is obtained |
| E15 | SmartRecruiters listings unconditional in v1 (§4) | unit | No `If-None-Match` sent |
| E16 | 304s excluded from the completion-rate metric (§6) | unit | See K3 |

---

## Gate F — Network citizenship

The gate that decides whether we are a well-behaved client or a nuisance that
gets blocked. Everything here is externally observable by the providers, which
makes it reputational as well as technical.

Verify against a **local instrumented fake ATS** (see M3) that records arrival
times, headers, and concurrency — not against the real providers. Timing
assertions against a live third party are flaky and rude.

| ID | Verifies | Method | Pass criterion |
| --- | --- | --- | --- |
| F1 | Identifying User-Agent with contact address (§6) | integration | Every request carries a UA naming the project and a reachable contact; asserted on all request types including discovery |
| F2 | Robots directives respected (§6) | integration | A disallowed path is not requested; the source is recorded unavailable |
| F3 | Blocked source does not close its jobs (§6) | integration | Lifecycle untouched |
| F4 | Host/provider concurrency caps (§6) | integration | Max in-flight ≤ 8 per host, ≤ 5 for Ashby, ≤ 32 globally, measured at the fake server |
| F5 | Discovery, listing, and detail share the limits (§6) | integration | Combined in-flight across all three respects the cap |
| F6 | No unbounded detail batches (§6) | integration | 5,000 pending details do not produce 5,000 concurrent tasks |
| F7 | Retries bounded at 3, exponential, jittered (§6) | integration | Retry count and inter-retry gaps measured; jitter is non-zero across runs |
| F8 | Retries limited to transport errors and 429/500/502/503/504 (§6) | unit | 400/401/403/404 are **not** retried |
| F9 | Numeric `Retry-After` honoured exactly (§6) | integration | Delay ≥ requested |
| F10 | HTTP-date `Retry-After` honoured (§6) | integration | Parsed correctly, including a past date (retry immediately) |
| F11 | Long `Retry-After` beyond run budget defers the source (§6, §7) | integration | Next eligible poll persisted; no early retry; lifecycle unchanged |
| F12 | Delay never shortened to 120s (§6) | integration | A 900s `Retry-After` waits 900s |
| F13 | Provider cooldown coordinated in-process (§6) | integration | A 429 from one board throttles sibling boards on that provider |
| F14 | Breaker ladder: 6h → 12 → 24 → 48 → 72 cap (§6) | integration | Each step asserted; cap does not exceed 72h |
| F15 | Breaker resets on complete read or eligible 304 (§6) | integration | Both reset paths tested |
| F16 | Malformed/interrupted listing counts as a board failure (§6) | unit | Contributes to the breaker |
| F17 | Safety limits and detail-only failures stay separately visible (§6) | unit | Not conflated with transport failure |
| F18 | Complete empty listing is **not** a failure (§6) | unit | Breaker unaffected |
| F19 | Quarantine never changes job lifecycle (§6) | integration | Jobs stay as they were |
| F20 | Host allowlist enforced (§6) | unit | A registry entry pointing off-allowlist is refused, not fetched |
| F21 | Graceful shutdown | chaos | `SIGTERM` finishes the in-flight board or rolls it back cleanly; no orphaned attempt rows beyond the recoverable one |

---

## Gate G — Data quality

Gates B–F prove the machine runs. This gate asks whether what comes out is
*good* — the question a user actually experiences. It is the only gate that
requires human judgement, and it cannot be skipped for that reason.

### G.1 Ground-truth sampling

For each provider, draw a random sample of **30 postings** from a recent run
and compare each scraped row against the employer's live posting page, by hand.

| ID | Field | Pass criterion |
| --- | --- | --- |
| G1 | Title | 100% exact match. Any mismatch is a blocker, not a percentage |
| G2 | Apply URL | 100% resolve to the correct live posting (follow each one) |
| G3 | Description text | ≥ 95% contain the full body with no truncation and no boilerplate injection |
| G4 | Locations | ≥ 95% complete; **zero** cases of a dropped secondary location |
| G5 | Salary | Zero manufactured values. A missing salary must be null, never a guess |
| G6 | Employment type / department | ≥ 90% correct where the source supplies them |
| G7 | Publication date | ≥ 95% correct, and `posted_at_precision` honest about the rest |
| G8 | `is_listed` | 100% correct for Ashby direct-link-only postings |

Record the sample, the date, the reviewer, and every discrepancy. Re-sample
after any normalizer change.

**G5 is absolute for a reason.** Wrong salary data is worse than absent salary
data: a candidate makes a decision on it. Precision beats recall on every
compensation field.

### G.2 Corpus-level invariants

Cheap, automated, run over the whole output of a pilot run. These run against
whichever store is in use — over `jobs/*.jsonl` in v1, over the `jobs` table in
v2 — and the assertions are identical either way. Keep them store-independent;
a corpus check that only works against SQL will silently stop running in v1.

| ID | Invariant | Pass criterion |
| --- | --- | --- |
| G9 | No duplicate `(source_id, external_id)` | Zero |
| G10 | No job with blank title or apply URL | Zero |
| G11 | Apply URLs are HTTP(S) and well-formed | 100% |
| G12 | `salary_min ≤ salary_max` where both present | 100% |
| G13 | Currency present whenever a scalar salary is | 100% |
| G14 | Period present whenever a scalar salary is | 100% |
| G15 | `first_seen_at ≤ last_seen_at`, both ≤ now | 100% |
| G16 | No `closed_at` on an active job, and none absent from a closed one | 100% |
| G17 | `country_iso` is a valid ISO code or null | 100% |
| G18 | Description text contains no raw HTML tags | 100% |
| G19 | No control characters or lone surrogates in text fields | 100% |
| G20 | Salary distribution sane per currency | No value below 1,000 or above 10,000,000 in a yearly USD range without manual review |

### G.3 Adversarial content

Source HTML is untrusted (§5). These are fixtures, not live cases.

| ID | Input | Expected |
| --- | --- | --- |
| G21 | `<script>` in the description | Stored verbatim in `description_html`, stripped from `description_text`, never executed anywhere in the pipeline |
| G22 | 10 MB description | Rejected as oversized with an explicit error; conditional eligibility disabled; **no silent truncation** (§5) |
| G23 | Deeply nested HTML (10,000 levels) | Parser does not stack-overflow; bounded failure |
| G24 | Emoji, RTL text, CJK, combining characters in title | Round-trip byte-identical |
| G25 | Null bytes in a JSON string | Rejected cleanly; Postgres `text` cannot store them |
| G26 | Title of 100,000 characters | Bounded rejection, not a database error |
| G27 | A job titled `'; DROP TABLE jobs;--` | Stored as literal text (see D14) |
| G28 | Malformed UTF-8 in the response body | Failed result, not a crash or mojibake row |

---

## Gate H — Live conformance

The first gate that spends real requests. Everything above must be green first.
Opt-in, never in ordinary CI (§7).

### H.1 Pilot registry

Assemble a fixed registry (§6 Rollout) covering every shape that has ever
broken a scraper:

| ID | Board characteristic | Why |
| --- | --- | --- |
| H1 | One board per provider, populated | Baseline, all four |
| H2 | A genuinely empty board | Must be *complete and empty*, never "failed" |
| H3 | A board with > 300 postings | The 300-cap assumption (§3) |
| H4 | A SmartRecruiters board spanning ≥ 4 pages | Pagination under real latency |
| H5 | An EU Lever board on `api.eu.lever.co` | Regional host preservation |
| H6 | An Ashby board with an unlisted posting | `isListed=false` handling |
| H7 | A board with multi-location postings | Location arrays |
| H8 | A board with published compensation | Real salary shapes, real currencies |
| H9 | A board with non-English postings | Encoding and normalization |
| H10 | A known-invalid slug | Must be recorded unavailable, not crash |

### H.2 Reconciliation

For each pilot board, count postings on the employer's public careers page by
hand and compare against the run.

| ID | Check | Pass criterion |
| --- | --- | --- |
| H11 | Listing completeness | Scraped count == manual count, every board, **exactly**. A single missing posting is a bug, not rounding |
| H12 | No phantom postings | Zero scraped rows without a live counterpart |
| H13 | Detail success rate | ≥ 98% of observed IDs reach `detail_state = ready` within two polls |
| H14 | Empty board | `complete`, zero IDs, no failure recorded, breaker untouched |
| H15 | Invalid slug | Recorded unavailable; no jobs closed as a consequence (§6) |

### H.3 Stability over time

Run the pilot registry on its real 30-minute schedule for **seven consecutive
days** with **sweeping disabled** (§6 Rollout), then evaluate before enabling
sweeping anywhere.

| ID | Check | Pass criterion |
| --- | --- | --- |
| H16 | Proposed closures reviewed against fresh reads (§6) | 100% of proposed closures confirmed genuinely gone by manual check. **Any false positive blocks sweeping entirely** |
| H17 | No unexplained content churn | `content_updated_at` changes correspond to real employer edits; a field flapping between polls is a normalizer bug |
| H18 | No duplicate rows accumulated | G9 still zero after 336 runs |
| H19 | ETag hit rate measured | Reported, with a body-refresh floor still honoured (E6) |
| H20 | No provider complaints, blocks, or rate-limit escalation | Zero 403s attributable to our traffic |
| H21 | Memory stable | No monotonic growth across 336 invocations |
| H22 | Connection pool stable | No leaked connections; pool size flat |

**H16 is the gate on the whole feature.** Sweeping is the only irreversible
behaviour in the system — it hides jobs from users. Enabling it on a pipeline
that has not demonstrated zero false closures over a week of real data is the
mistake this entire rollout sequence exists to prevent.

---

## Gate I — Scale and performance

The pilot proves correctness at four boards. This gate asks whether the design
survives 14,600 (§6).

| ID | Check | Method | Pass criterion |
| --- | --- | --- | --- |
| I1 | p95 run duration | live | < **half** the scheduled interval — under 15 minutes on a 30-minute schedule (§6 Rollout). This is the stated expansion criterion |
| I2 | Throughput projection | manual | Measured per-board cost × registry size stays within the interval, with the arithmetic written down (§6: ~700,800 listing requests/day at 14,600 boards) |
| I3 | Request volume per run | live | Matches the projection within 10%; a surprise here means retry amplification |
| I4 | ETag byte savings | live | Measured, not asserted. ETags cut bytes, **not** request count (§6) |
| I5 | Payload size distribution | live | p50/p95/p99 recorded before setting storage budgets (§5) |
| I6 | Database growth rate | live | Projected from the pilot to full registry; storage budget signed off |
| I7 | Connection pool sizing | load | Sufficient at target concurrency with no exhaustion; verified with D7 in force |
| I8 | Memory ceiling | load | Bounded at maximum concurrency; no full-registry materialization |
| I9 | Concurrent board scaling | load | 100 simulated boards against the fake ATS complete without lock contention or pool starvation |
| I10 | Degradation is graceful | chaos | At 2× expected load the run produces partial results and defers sources; it does not corrupt state or close jobs |
| I11 | Stale source detection | live | Sources not successfully read within N intervals surface for operator attention (§6) |

---

## Gate J — Security and privacy

| ID | Check | Method | Pass criterion |
| --- | --- | --- | --- |
| J1 | No database credentials in client-prefixed variables (§5) | static | No `NEXT_PUBLIC_*` or equivalent holds a connection string, repo-wide |
| J2 | Credentials absent from logs | integration | Log output scanned for connection-string and password patterns across an error path, not just the happy path |
| J3 | Credentials absent from fixtures and `.scraped/` output | static | Automated scan |
| J4 | Browser client key never used as a database password (§5) | manual | Reviewed |
| J5 | Parameterized queries only | static + integration | See D14 |
| J6 | Service-only tables unreachable through the API (§5, post-KAN-93) | integration | Every FastAPI route enumerated; none exposes `job_sources`, `job_payloads`, `scrape_runs`, or `scrape_source_runs` |
| J7 | Public job reads filter `active AND is_listed` (§5) | integration | Enforced in one shared place; asserted per route, including any new route |
| J8 | Origin not client-editable (§5) | integration | Attempted origin escalation rejected |
| J9 | Employer rows untouched by ingestion (§5, §7) | integration | Byte-identical before and after (see C29) |
| J10 | Employer writes denied until membership checks exist (§5) | integration | Explicitly denied, not silently allowed |
| J11 | HTML sanitization boundary documented and enforced | manual | Consumers sanitize; ingest does not. The contract is written down and the consumer side is tested |
| J12 | No PII collected beyond public posting content | manual | Reviewed against what is actually stored |
| J13 | Dependency vulnerability scan | static | `uv pip audit` or equivalent clean; no known-critical advisories |
| J14 | Secrets not in Git history | static | Scanner run over full history, not just HEAD |

---

## Gate K — Observability

If it runs unattended, its output has to be legible at 3 a.m. without reading
the source.

| ID | Metric or signal | Pass criterion |
| --- | --- | --- |
| K1 | Source outcomes reported separately (§6) | attempted, complete, partial, failed, not-modified, skipped, superseded — seven distinct counters, none collapsed |
| K2 | Completion rate formula correct (§6) | complete ÷ (complete + partial) over **body** responses only |
| K3 | 304s cannot inflate completion (§6) | Revalidations and request failures reported separately; asserted with a fixture run |
| K4 | Detail backlog visible (§6) | Pending detail count per source |
| K5 | Reopens and closures counted (§6) | Separately, per run |
| K6 | Bytes, request counts, duration (§6) | Per run and per source |
| K7 | Age of last accepted validation per source (§6) | Queryable; drives K8 |
| K8 | Stale source alert | Fires before a board silently rots |
| K9 | Provider-wide count-change alerts are alerts only (§6) | Never gate a per-board sweep. Feashliaa's 7-day/3σ thresholds are explicitly **not** adopted as release criteria |
| K10 | Breaker state visible | Which boards are quarantined, and until when |
| K11 | Every failure is attributable | Error metadata is bounded but identifies source, provider, and phase |
| K12 | Run summary is human-readable | An operator can tell in 10 seconds whether a run was healthy |
| K13 | Runbook exists | Documented response for: provider outage, mass closure proposal, quarantine storm, pool exhaustion, schema drift |

---

## Gate L — Legal and ethical

Not optional, and not the last thing to think about.

| ID | Check | Pass criterion |
| --- | --- | --- |
| L1 | Provider Terms of Service reviewed | Documented per provider, with the date and the reviewer, before scheduled operation |
| L2 | Public, documented APIs only | No authenticated endpoint, no session replay, no paywall circumvention |
| L3 | Robots directives respected (§6) | See F2 |
| L4 | Identifying UA with contact (§6) | See F1. A provider must be able to reach us before they block us |
| L5 | Upstream attribution complete | `THIRD_PARTY.md` lists every adapted file with its pinned revision and license (A8) |
| L6 | License compatibility reviewed | Adapted code's license is compatible with this project's |
| L7 | No real captured responses in Git (§7) | See A7 |
| L8 | Presence in a feed is not asserted as active hiring (§1) | Product copy does not overclaim; the architecture is explicit that a listing does not prove a vacancy is genuine |
| L9 | Takedown path exists | A documented way for an employer to request removal, and a way to honour it that survives re-scraping |

---

## Verification methods

The tooling the gates above assume. Build these once; most checks are cheap
afterwards, and several checks are impossible without them.

**M1 — Synthetic fixture corpus.** One directory per provider, each holding the
full envelope matrix from B.1 plus the edge cases from B.2/B.3 and the
adversarial inputs from G.3. Invented companies, invented postings, real
structural quirks. This corpus is the single most valuable artifact in the
verification suite: it is what makes Gates B, C, and E run in milliseconds, and
it is what lets a contributor change the normalizer without fear.

**M2 — Network isolation in tests.** Offline is the default (§7), enforced
rather than assumed: a `conftest.py` autouse fixture that patches the HTTPX
transport to raise on any real connection. A test that reaches the internet by
accident should fail loudly, not pass slowly.

**M3 — Instrumented fake ATS.** A local server that speaks all four provider
dialects and can be told to misbehave: return 429 with either `Retry-After`
form, stall mid-page, change its total between pages, emit `Vary: *`, return a
304, serve 10 MB of description, drop a connection mid-body. It records arrival
timestamps, headers, and concurrency so Gate F can assert on measurements
instead of intentions. Gates F and I are not really possible without it.

**M4 — Transaction/HTTP interlock.** An assertion harness that fails any test
in which an HTTP request is issued while a database transaction is open (D7).
Implement it as a context-local flag set by the store and checked by the HTTP
client, so it holds for code nobody thought to test.

**M5 — Postgres integration harness.** Real Postgres, schema built by the same
Alembic revision production uses (§1), each test in a rolled-back transaction
or a fresh schema. Never SQLite.

**M6 — Chaos injection.** Deterministic failure injection at named points:
after ETag receipt, mid-transaction, between the job write and the checkpoint
write, during detail fetch. Gates D and I depend on these being reachable
points, not incidental timing.

**M7 — Property testing.** Hypothesis strategies for observation sequences
(C.3). Persist failing seeds.

**M8 — Live probe harness.** Opt-in, explicitly flagged, output to gitignored
`scraper/.verification/`. Never in ordinary CI (§7).

**M9 — Reconciliation worksheet.** A simple template for H.2 and G.1: board,
manual count, scraped count, discrepancies, reviewer, date. The value is in
having the numbers written down when someone asks three months later.

---

## Release criteria

The scraper is ready for scheduled operation against the full registry when
**all** of the following hold. These are gates, not goals; a red one blocks.

1. Gates A–G fully green, every check, every provider. No skipped cells in the
   B.1 matrix and no undefined cells in C14.
2. Gate H complete: pilot registry covering all ten shapes, reconciliation
   exact (H11), and **seven days of stable scheduled operation with sweeping
   disabled**.
3. **H16 clean** — every proposed closure over that week manually confirmed
   genuinely gone. One false positive blocks sweeping.
4. Gate I: p95 runtime below half the interval (I1), with the throughput
   arithmetic for the full registry written down and signed off.
5. Gates J, K, L green, including the runbook (K13), the ToS review (L1), and
   the takedown path (L9).
6. Sweeping enabled **incrementally** — a subset of boards first, watched — not
   registry-wide in one change.
7. Registry expansion continues only while I1 holds and the acceptance suite
   stays green (§6 Rollout).

### Ongoing verification

Verification is not a one-time event; ATS providers change their responses
without telling anyone, and that is the failure mode this suite must keep
catching.

| Cadence | What runs |
| --- | --- |
| Per commit | Gates A, B, C, E — offline, fast |
| Nightly | Gate D, high-count property tests (C.3), Gate F against the fake ATS |
| Weekly | Gate G.2 corpus invariants over live data; metric review (Gate K) |
| Monthly | Gate G.1 sampling, 10 postings per provider |
| Quarterly | Full Gate H reconciliation; Gate I re-measurement; Gate L re-review |
| On provider change | Gates B, G, H for that provider |
| On normalizer change | Gate B.3, Gate G, and a `reprocess` run over stored payloads |

### Sign-off

| Gate | Owner | Date | Evidence |
| --- | --- | --- | --- |
| A — Static integrity | | | |
| B — Provider contracts | | | |
| C — Lifecycle | | | |
| D — Transactions | | | |
| E — Caching | | | |
| F — Network citizenship | | | |
| G — Data quality | | | |
| H — Live conformance | | | |
| I — Scale | | | |
| J — Security | | | |
| K — Observability | | | |
| L — Legal and ethical | | | |

---

## What this document does not cover

Stated so the gaps are deliberate rather than discovered:

- **Downstream selection** — region, role, age, and per-company display limits
  are consumer concerns, not ingestion evidence (§1).
- **Matching, resume parsing, employer job creation, claim verification** —
  separate tickets (§1).
- **Cross-source deduplication** — explicitly out of scope; the same role on
  two ATSes is two rows by design.
- **The FastAPI read path** beyond the boundary checks in J6 and J7 — KAN-93's
  own verification.
- **Scheduler deployment** — a separate ticket (§6). This document verifies the
  scraper given a schedule; it does not verify the scheduler.
