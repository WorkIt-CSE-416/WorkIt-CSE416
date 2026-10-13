# CLAUDE.md — job matching

How a listed job is scored against one applicant's experience bank (KAN-139;
the bank replaced the default resume in KAN-212). Loaded on
top of `../../../CLAUDE.md` (the Python API) and the repo root's. Read it before
changing anything in this folder or the columns it reads.

## The design (agreed 2026-10-09)

The pipeline is all open jobs, then hard filters, then candidates, then a score
per candidate, then a ranked list with a freshness boost. The filters are being
built separately (KAN-170), so scoring comes first and takes whatever list of
candidates it is given.

**It must work for any field, not only software.** A hand-written skill
vocabulary was tried first and dropped, because it built computer science into
the matcher. Learning terms from the postings alone fails too: a scratch test on
the 1,096-job feed came back mostly equal-opportunity boilerplate ("race",
"religion") and company phrases ("giving insurers").

| Component | How | Status |
|---|---|---|
| Semantic similarity | Gemini embeddings of the posting and of the experience bank, compared in Postgres (`1 - (job.embedding <=> bank.embedding)`) | Built — `scoring.py`, queried in `routers/jobs.py` |
| Skill overlap | The applicant's own listed skills searched for in each posting (`ts_rank(fts, plainto_tsquery(skills))`) normalized by max rank | Built — `scoring.py`, queried in `routers/jobs.py` |
| Title fit | Word overlap between the job title and the bank's Experience titles and first field of study, stop words removed | Built — `scoring.py` `title_fit()` |
| Eligibility | Years of experience check; a multiplier (1.0 / 0.5 / 0.0) | Built — `scoring.py` `eligibility()` |
| Freshness | `max(0.7, 1.0 - days_old / 300)` — newer postings rank higher, old ones don't drop below 70% | Built — `scoring.py` `freshness()` |

Nothing in this folder may assume what a software job is. Two consequences:

- **No "missing skill" caveats yet.** They need each job's own skill list, which
  only a taxonomy covering every field (ESCO, O*NET) can supply.
- **When other fields arrive:** leave soft skills out ("communication" is on
  every resume), and treat required licenses (RN, CPA, CDL) as eligibility, not
  skills.

## Embeddings — `embeddings.py`

- **One model, everywhere.** Laptops, the deployed API and the scheduled import
  all write into the same database, and vectors from two models can't be
  compared. So `MODEL` (`gemini-embedding-001`) and the size
  (`dto.EMBEDDING_DIMENSIONS`, 768) are constants, never settings, and there is
  no Ollama option for embeddings, even on a laptop.
- **Changing either one changes the database too.**
  - A new size needs a migration changing both columns' type (`ALTER COLUMN
    embedding TYPE extensions.vector(N) USING NULL`).
  - A new model at the same size needs a migration setting both columns to NULL.
  - A wrong size fails loudly: Postgres refuses the vector. A new model next to
    old vectors fails **silently**: the scores are wrong and nothing errors.
  - After either, the import re-embeds every job, and the migration also
    sets every `experience_banks.embedding` to NULL, so each bank is
    re-embedded on its next recommendations request.
- **Gemini's native REST API (`batchEmbedContents`), called through httpx.** The
  OpenAI-compatible endpoint documents neither the vector size nor batching.
  This also keeps `workit_scout/llm.py` the only module that imports `openai`.
  The key travels in the `x-goog-api-key` header, so it never shows up in a
  logged URL.
- **`embed()` takes at most `BATCH_SIZE` (100) texts and never raises on a
  provider failure.** No key, a refusal (429 is the free tier's quota) or an
  unreachable Gemini all return `None`. The caller stores nothing and tries
  again later, and a job or resume without a vector scores neutral on meaning.
  An upload or an import must never fail because Gemini is down.
- **Only the bank's text and public postings are sent**, never identity data
  (name, email, phone, address, links). That is Scout's rule
  (`../../../../scout/CLAUDE.md`), because Gemini's free tier may train on what
  it receives. `bank_input.bank_text()` is where that boundary lives (below).
- **Texts are cut to 6,000 characters**, since the model reads about 2,048
  tokens. A posting loses its tail, which is mostly benefits and legal
  boilerplate.

## When things are embedded

- **Jobs: ahead of time, by the import.** Each scheduled run embeds only the
  new or changed postings, never inside a user's request. Embedding on request
  would make the first person after each import wait for hundreds of vectors,
  and two people arriving together would both pay for them. *(Not written yet.)*
- **Banks: on demand.** `GET /jobs/recommended/{applicant_id}` embeds the
  bank when `experience_banks.embedding` is NULL, and stores it with
  `embedded_at`. Every entry, bullet or skill change sets it back to NULL
  (`services/bank.py`), so the bank routes never call Gemini themselves, and
  applicants who never open recommendations never cost a call.
- **A stale vector is never stored.** The write is conditional on the bank
  row's `updated_at` being the one read: a change that landed while Gemini
  answered already cleared the embedding, and the next request remakes it.
- **An empty bank (no entries, no skills) answers 404** and costs no call.

## What the recommender reads from the bank — `bank_input.py`

Pure functions over a loaded `services.bank.Bank` (KAN-212). Only the data
the recommender reads changed; the scoring did not.

- **`bank_text()`, the embedding input**, in order: skills; each degree and
  field of study; each entry's section, title and organization with its
  original bullets, newest first across sections (Present first, then by end
  month). Never a bullet variant, a link, a location, a grade or a date. The
  text then passes through `workit_scout.identity` with the profile's
  identity fields (`identity=` is required, with no empty default, so a
  caller cannot skip loading the profile), and is cut at 6,000 characters, so the oldest entries go
  first. One embedding per bank; per-entry embeddings are out of scope until
  matches prove poor.
- **Years of experience** sum Experience entries only (Leadership, Projects
  and the rest never count), both end months included (Jun to Aug is three
  months). Present counts up to this month, an end still to come is cut at
  this month, and an entry with no start month adds nothing.
- **The expected graduation date** is the latest end month on any Education
  entry, past or expected. It is computed and passed to `eligibility()`,
  which does not compare it yet (Still open).

## The columns

`job_postings.embedding` and `experience_banks.embedding` are `vector(768)`, and
`job_postings.fts` is a generated `tsvector`. `../../models/CLAUDE.md` has the
details, including why their migration must reach the database **before** the
code that maps them is deployed.

## Configuration

`GEMINI_API_KEY`, read as `Settings.gemini_api_key`. Unset, nothing is embedded
and matching runs without its semantic part, the same way the app runs without
`.env`. A value copied from `.env.example` is not a key: every call then answers
`API_KEY_INVALID`, which `embed()` logs and treats as `None`.

## Scoring — `scoring.py`

Pure functions, no DB access. Weights: `W_SEMANTIC=0.45`, `W_SKILL=0.25`,
`W_TITLE=0.15`, `W_ELIGIBILITY=0.15`. When no embedding exists, semantic
weight is redistributed across the others. Final score is
`round(weighted_sum * freshness * 100)`, clamped 0-100.

## Highlights — `highlights.py`

Takes the bank's skill names and field of study. Picks up to 3 reasons from a
priority list: skills matched, title alignment,
strong semantic fit (positive), then years mismatch and start term mismatch
(negative). Positives sort before negatives.

## Still open

- **Applying the migration that creates the columns.** It's `4485d7a7a712`,
  and it goes on the shared database right after its PR merges, before the
  deployment is live (`../../models/CLAUDE.md` says why).
- **The import's embedding step** — embedding jobs during import, so
  `GET /jobs/recommended` has vectors to compare against. Without it, jobs
  score 0 on the semantic component.
- **Unchecked against the live API:** whether Gemini still accepts `taskType`
  and `outputDimensionality` at the top level of each request. Google's
  reference marks them deprecated in favour of `embedContentConfig`.
- **Scoring weights and the freshness boost** are guesses until there is real
  data to tune them on.
- **Grad date vs start term** is not compared yet. The bank's expected
  graduation date reaches `eligibility()`, which only checks years of
  experience; comparing it is a scoring change, out of KAN-212's scope.
- **Dropping `resumes.embedding`** (the contract half of KAN-212's move). The
  model stopped mapping it; the drop migration is written and applied only
  after this code is deployed (`../../models/CLAUDE.md`).
