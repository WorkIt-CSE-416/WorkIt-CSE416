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
| Semantic similarity | Gemini embeddings of the posting and of the resume's parsed sections, compared in Postgres (`job.embedding <=> resume.embedding`) | Client and columns built, not wired |
| Skill overlap | The applicant's own listed skills searched for in each posting (`job_postings.fts`), rarer skills counting more | Column built, query not written |
| Title fit | Word overlap between the job title and the applicant's titles and field of study, rarer words counting more | Not written |
| Eligibility | Graduation date against the start term, and years of experience. A multiplier, not a weight: a great fit for an internship that starts after you graduate is still not a job you can take | Not written |
| Freshness | Newer postings rank higher | Not written |

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
  - After either, the import re-embeds every job, and each resume is
    re-embedded on its next request.
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
- **Only parsed resume sections and public postings are sent**, never the raw
  resume text with its name, email, phone and links. That is Scout's rule
  (`../../../../scout/CLAUDE.md`), because Gemini's free tier may train on what
  it receives. `resume_text()` is where that boundary lives.
- **Texts are cut to 6,000 characters**, since the model reads about 2,048
  tokens. A posting loses its tail, which is mostly benefits and legal
  boilerplate.

## When things are embedded

- **Jobs: ahead of time, by the import.** Each scheduled run embeds only the
  new or changed postings, never inside a user's request. Embedding on request
  would make the first person after each import wait for hundreds of vectors,
  and two people arriving together would both pay for them. *(Not written yet.)*
- **Resumes: on demand.** `GET /jobs/recommended` embeds the chosen resume when
  its `embedding` is NULL, and stores the result. The resume `PUT` that replaces
  `parsed_json` clears `embedding`, and a new upload starts NULL, so the resume
  routes never call Gemini themselves. Applicants who never open
  recommendations never cost a call. *(Not written yet.)*

## The columns

`job_postings.embedding` and `resumes.embedding` are `vector(768)`, and
`job_postings.fts` is a generated `tsvector`. `../../models/CLAUDE.md` has the
details, including why their migration must reach the database **before** the
code that maps them is deployed.

## Configuration

`GEMINI_API_KEY`, read as `Settings.gemini_api_key`. Unset, nothing is embedded
and matching runs without its semantic part, the same way the app runs without
`.env`. A value copied from `.env.example` is not a key: every call then answers
`API_KEY_INVALID`, which `embed()` logs and treats as `None`.

## Still open

- **The migration that creates the columns.** It waits on `KAN-170`'s migration
  (`b81d4e2f6c09`) reaching `main`, since the shared database already has that
  one, and must revise it.
- **The rest of the pipeline:** the import's embedding step, the resume `PUT`
  clearing `embedding`, scoring, and `GET /jobs/recommended`.
- **Unchecked against the live API:** whether Gemini still accepts `taskType`
  and `outputDimensionality` at the top level of each request. Google's
  reference marks them deprecated in favour of `embedContentConfig`.
- **Scoring weights and the freshness boost** are guesses until there is real
  data to tune them on.
