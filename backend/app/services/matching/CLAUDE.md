# CLAUDE.md — job matching

How a listed job is scored against one applicant's resume (KAN-139). Loaded on
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
| Semantic similarity | Nomic embeddings of the posting and of the resume's parsed sections, compared in Postgres (`1 - (job.embedding <=> resume.embedding)`) | Built — `scoring.py`, queried in `queries/jobs/recommendations.py` |
| Skill overlap | The applicant's own listed skills searched for in each posting (`ts_rank(fts, plainto_tsquery(skills))`) normalized by max rank | Built — `scoring.py`, queried in `queries/jobs/recommendations.py` |
| Title fit | Word overlap between the job title and the applicant's titles and field of study, stop words removed | Built — `scoring.py` `title_fit()` |
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
  compared. Use Ollama's `nomic-embed-text:v1.5` at
  `dto.EMBEDDING_DIMENSIONS` (768) for every job and resume vector.
- **Changing either one changes the database too.**
  - A new size needs a migration changing both columns' type (`ALTER COLUMN
    embedding TYPE extensions.vector(N) USING NULL`).
  - A new model at the same size requires clearing both columns before vectors
    from the new model are written; there is no model-provenance column.
  - A wrong size fails loudly: Postgres refuses the vector. A new model next to
    old vectors fails **silently**: the scores are wrong and nothing errors.
  - After either, the import re-embeds every job, and each resume is
    re-embedded on its next request.
- **Ollama's native `/api/embed` endpoint, called through httpx.** The local
  server defaults to `http://localhost:11434`; `OLLAMA_EMBEDDING_URL` can point
  to another Ollama server. Install the model with `ollama pull
  nomic-embed-text:v1.5`.
- **`embed()` takes at most `BATCH_SIZE` (100) texts and never raises when
  Ollama is unavailable.** A failed request returns `None`. The caller stores
  nothing and tries again later, and a job or resume without a vector scores
  neutral on meaning. An upload or an import must never fail because Ollama is
  down.
- **Only parsed resume sections and public postings are sent**, never the raw
  resume text with its name, email, phone and links. `resume_text()` enforces
  that boundary. The local Ollama endpoint keeps the text on that machine.
- **Texts are cut to 6,000 characters**, since the model reads about 2,048
  tokens. A posting loses its tail, which is mostly benefits and legal
  boilerplate.

## When things are embedded

- **Jobs: ahead of time, by the import.** Each scheduled run embeds only the
  new or changed postings (embedding IS NULL), never inside a user's request.
  Embedding runs **after** the import transaction commits, so the upsert stays
  fast and a dry-run never calls Ollama. A changed job's embedding is cleared
  in the upsert's `set_` dict, so it gets a fresh vector. Each batch of 100
  is committed independently; if Ollama goes down mid-run, the next scheduled
  run picks up the rest.
- **Resumes: on demand.** `GET /jobs/recommended` embeds the chosen resume when
  its `embedding` is NULL, and stores the result. The resume `PUT` that replaces
  `parsed_json` clears `embedding`, and a new upload starts NULL, so the resume
  routes never call Ollama themselves. Applicants who never open
  recommendations never cost a call. 

## The columns

`job_postings.embedding` and `resumes.embedding` are `vector(768)`, and
`job_postings.fts` is a generated `tsvector`. `../../models/CLAUDE.md` has the
details, including why their migration must reach the database **before** the
code that maps them is deployed.

## Configuration

Ollama is expected at `OLLAMA_EMBEDDING_URL` with `nomic-embed-text:v1.5`
installed. If Ollama is unavailable, embedding returns no vector and the import
or recommendation request can retry later.

## Scoring — `scoring.py`

Pure functions, no DB access. Weights: `W_SEMANTIC=0.45`, `W_SKILL=0.25`,
`W_TITLE=0.15`, `W_ELIGIBILITY=0.15`. When no embedding exists, semantic
weight is redistributed across the others. Final score is
`round(weighted_sum * freshness * 100)`, clamped 0-100.

## Highlights — `highlights.py`

Picks up to 3 reasons from a priority list: skills matched, title alignment,
strong semantic fit (positive), then years mismatch and start term mismatch
(negative). Positives sort before negatives.

## Recommendations — `fetch_recommended()` and `GET /jobs/recommended/{applicant_id}`

Both in `routers/jobs.py`. `fetch_recommended(db, applicant_id, filters=,
min_match=, limit=, offset=)` loads the default resume, has
`queries/jobs/recommendations.py`'s `score_jobs` score and sort the jobs,
then applies `min_match` and the page; it returns `list[ScoredJob]`, best
first. The route checks ownership and calls it. Python code that needs
recommendations (auto apply's queue) calls the function, not the route. It
checks no ownership itself, so its caller must.

It scores against the **default resume only**
(`applicant_profiles.default_resume_id`); no other resume or profile field
counts. No default resume, or one that never parsed, raises `NoResume`,
which the route answers as a 404.

- **It scores every listed job each call, then sorts and slices.** Every
  query parameter that narrows the list (the Jobs page's filters,
  `min_match`) applies before `offset`, so a page never comes back short with
  more matches behind it.
- **`min_match` (0–100, default 0)** drops jobs scored below it. Auto apply
  asks for 60 (`auto-apply/architecture.md`, "Match (built)"). It moves with the
  weights: retune it when they change.

## Still open

- **Applying the migration that creates the columns.** It's `4485d7a7a712`,
  and it goes on the shared database right after its PR merges, before the
  deployment is live (`../../models/CLAUDE.md` says why).
- **The rest of the pipeline:** the resume `PUT`
  clearing `embedding`, scoring, and `GET /jobs/recommended`.
- **Scoring weights and the freshness boost** are guesses until there is real
  data to tune them on.
- **Grad date vs start term** is not compared yet (eligibility only checks
  years of experience).
