# Human TLDR 
- each job is mapped to a specific job role that's hard-coded in a list. This supports future filtering, onboarding form and recommendation 
- to match a job title to role: 
  - first clean up the title, strip away puncutations and other info 
  - 

# Search and Role Resolution — Design

Status: agreed 2026-10-10 (KAN-155). Built so far: the `job_roles` and
`job_role_tags` tables (`backend/app/models/job_roles.py`, migration
`362182aaa4fd`) and the first 32 roles (`ab07572bba38`). This is the rationale;
once it is built, the migrations are the source of truth for the schema and
the CLAUDE.md files nearest the code hold the rules.

Covers job search on the seeker board, and the short list of job roles that
every scraped job is resolved to. The applicant onboarding form and
recommendations will use the same list later (see "Later"), but neither is
part of this work.

## What a search is

Big job boards (LinkedIn, Indeed, Google Jobs) don't search one thing. They
combine three signals, and so do we, all in Postgres:

| Signal | Answers | How |
|---|---|---|
| **Role** | "swe intern", "data scientist" | Jobs tagged with a role from our short list (`job_role_tags`) |
| **Keyword** | "react", "robotics", "kubernetes" | `job_postings.fts`, the full-text column from KAN-139 |
| **Company** | "stripe", "jane street" | The trigram index on `company_name` (`55f3c813be50`) |

The role list is how the board is **navigated and filtered**, not the whole
search. A query like "Stripe" or "React" names no role and must still find
jobs, which is why keyword and company search are there too.

Embeddings are **not** part of search. They would cost a Gemini call per query
(latency, and the free tier's quota) to answer a question keywords already
answer. Meaning-based ranking belongs to recommendations
(`backend/app/services/matching/CLAUDE.md`).

## Roles: a short, hand-curated list

A flat list of about 30 roles, each a job title rather than a field:
"Software Engineer", "Data Scientist", "Mechanical Engineer", "Nurse",
"Teacher", and so on, grouped for the picker (engineering, data and research,
product, business, healthcare, education, retail and real estate). It is
weighted toward what the scraper finds today (mostly software, data and ML
jobs), with a few roles from other fields so onboarding works for students
outside CS, and grows as those fields' jobs arrive.

**Why not O\*NET.** O\*NET (about 1,000 occupations and tens of thousands of
alternate titles) is what the big boards build on, but it is far more than a
board of about 1,000 jobs needs, and it is too long to show in an onboarding
picker. Reconsider it when the list passes about 50 roles, or when the
import's unresolved report fills with fields we don't cover.

**Why not a tree.** The plan in `job_posting.md` (`job_roles` with
`parent_id`, an `ltree` path and a `role_aliases` table) is superseded. A short,
flat list needs no hierarchy, and storing both `parent_id` and `path` held the
same tree twice. If grouping is ever needed for the UI ("Engineering",
"Design"), add a plain `family` column.

**How this squares with matching's "no hand-written vocabulary" rule.**
Matching dropped a hand-written *skill* list because it built computer science
into the scorer. Roles are different:
- A role is a label a person picks, not an input to the score.
- A job with no role loses nothing: it stays fully findable by keyword and
  company.
- Covering a new field is one new row, not a rewrite.

## Where the list lives

**In the database, seeded by an Alembic migration**, the way countries and
states are (`cca905583de8`, `6b5bd2831d18`): the migration holds a frozen
copy of the list and inserts it. Three things will point at the same rows:
the job tags written by the import, the onboarding picks (later), and the
filter options on the board. A copy in the frontend and another in the
backend would drift, and only a table gives the tags foreign keys.

```
job_roles      (slug text PRIMARY KEY, name text NOT NULL UNIQUE, sort_order smallint NOT NULL)
               -- ('software_engineer', 'Software Engineer', 10)
               -- CHECK slug ~ '^[a-z][a-z0-9_]*$'

job_role_tags  (job_id    uuid → job_postings ON DELETE CASCADE,
                role_slug text → job_roles    ON DELETE RESTRICT,
                PRIMARY KEY (job_id, role_slug))
               + index on (role_slug, job_id) for the role filter
```

- **The key is a readable slug, not a UUID**, like the countries' `'US'`. It
  is the value the API and frontend pass around (`?role=software_engineer`)
  and is the same in every database. **A slug never changes once shipped.**
  Renaming what people see changes `name`.
- **RLS is enabled on both tables with no policies**, as every new table's
  migration must (root `CLAUDE.md`).
- **`GET /jobs/roles`** lists them in `sort_order`, for the board's role
  filter now and the onboarding form later, in the same style as
  `GET /jobs/locations`.
- **Changing the list is a migration.** A new role takes a migration
  inserting it and aliases in the resolver; the next scheduled import then
  tags jobs with it.

**Aliases live in Python**, in `backend/app/services/role_resolver.py`, not in
a table. Only the resolver reads them, and keeping them in code means fixing
an alias needs no migration: the next import applies it. This follows
`location_resolver.py`, whose word lists are constants in the module.

```python
ALIASES = {
    "software_engineer": ("software engineer", "software developer", "swe", "sde",
                          "software engineering", "full stack", "backend engineer", ...),
    "ml_engineer":       ("machine learning engineer", "ml engineer", "machine learning", ...),
    ...
}
```

The resolver checks at import that every alias key is a slug in `job_roles`,
the same way `LocationResolver` is built from the codes the database holds, so
a typo fails the run instead of writing a tag the foreign key rejects.

## Resolving a title to roles

`role_resolver.py` is pure, like `location_resolver.py`: no database, no
network. It takes a title and returns the set of slugs it found. **It reads
the title only, never the description**, since descriptions name other roles
("you'll work closely with product managers").

It matches **whole words in a row, never substrings**. `"sales" in
"salesforce developer"` is true as a substring, but the words `salesforce
developer` never contain the word `sales`. The same goes for "intern" in
"internal" and "data" in "Data Centre Deployment".

### The steps

1. **Split into words.** Fold accents, lowercase, and keep runs of letters and
   digits: `re.findall(r"[a-z0-9]+", text)`. That is the only regex.
   "Full-Stack Engineer (AI/ML) Intern - Summer 2027" becomes `full stack
   engineer ai ml intern summer 2027`. Punctuation and brackets disappear, so
   the order of the words is all that is left.
2. **Normalize word forms** with one small table applied to every word:
   `engineering`/`engineers` → `engineer`, `sw` → `software`, `dev` →
   `developer`, `eng` → `engineer`, and so on. Aliases go through the same
   table when the dictionary is built, so "Software Engineering Intern" meets
   the alias `software engineer`. One entry here fixes every role at once
   instead of each role listing every form.
3. **Look up phrases, longest first.** Walk the words left to right; at each
   word, try the longest alias that could start there, then shorter ones. Each
   try is one dict lookup on a tuple of words. A match records its slug and
   uses up its words; no match moves on one word.
4. **Outright roles win.** If a role that is never engineering (recruiter,
   sales representative, accountant) matched, the engineering tags are
   dropped: "Technical Recruiter, Software Engineering" is a recruiter job.
5. **Tag every role left; no match means no tag.** `Software Engineer
   (Machine Learning) Intern` is `software_engineer` and `ml_engineer`. A bare
   generic word ("Engineer", "Analyst", "Intern") resolves to nothing, and
   nothing is forced into a nearest role.

**Noise is not stripped.** Words like "intern", "summer" and "2027" start no
alias, so the walk passes over them without a list of them. Stripping would
only matter if noise fell *between* an alias's words, and titles don't do
that. (Search still uses the words no alias consumed; see The query.)

### The dictionary

Built once when the resolver is constructed, from `ALIASES`:

```python
PHRASES = {
    ("software", "engineer"): "software_engineer",
    ("engineer", "software"): "software_engineer",   # "New Graduate Engineer, Software"
    ("software",): "software_engineer",              # "Flight Software Intern"
    ("developer",): "software_engineer",             # "Junior Java Developer"
    ("business", "developer"): "sales_representative",
    ("machine", "learning"): "ml_engineer",
    ...
}
```

- **Every alias belongs to exactly one role.** Building the dict fails if two
  roles claim the same phrase (after normalizing), so a duplicate can't
  silently pick a winner.
- **One-word aliases are safe because longer ones are tried first.**
  "Business Developer" meets the two-word sales alias before `developer` is
  ever looked up.
- **Reordered titles get their own alias** (`engineer software`) rather than
  matching words anywhere in the title. See "Measured" below for why.
- **Every slug must exist in `job_roles`.** The import checks this when it
  builds the resolver, so a typo fails the run instead of writing a tag the
  foreign key rejects.

**Cost.** At most (words in the title) × (longest alias, about 4) lookups:
around 30 for a typical title, **whatever the number of aliases**. 1,000
titles take milliseconds. Speed isn't why it's a dict, though: looping over
every alias with `in` would also be fast at this size, but it matches
substrings, which is wrong.

### Measured on the feed (2026-10-11)

A rough first alias list for the tech roles (about 80 phrases), run on the
1,096-job `backend/data/feed.json` three ways, in a throwaway prototype:

| Strategy | Tagged |
|---|---|
| Exact phrase as written | 813 (74%) |
| + normalizing word forms (step 2) | 955 (87%) |
| + the words anywhere in the title, any order | 983 (90%) |

- **Normalizing word forms is the step that matters.** About 140 titles say
  "Software **Engineering** Intern" where the alias said "engineer"; eight
  table entries covered most of the 13-point gain.
- **Any-order matching was rejected.** It gained 3 points and made wrong tags
  by pairing words from different parts of the title: "AI & Management
  Consulting Intern (Value **Engineering**)" became ML Engineer, and
  "Deployment Engineer - **Data** & AI" became Data Engineer. The reordered
  titles it did catch ("Engineer, Software") are covered by reversed aliases.
- **What stayed untagged (106 titles) was mostly missing aliases:**
  `developer` and `software` alone, `programmer`, database, network and cloud
  administrator titles, `business developer` (sales) and `talent partner`
  (recruiter). Some correctly match nothing ("AI Data Rater").

**Precision over recall.** A wrong tag puts a job in a filter where it doesn't
belong, which the user sees. A missing tag only means the job is found by
keyword instead. When in doubt, leave the tag off.

### In the import

`backend/app/scripts/import_jobs.py` gains a step after the upsert, shaped like
`_sync_locations`: resolve each distinct title once, then bring each job's
`job_role_tags` in line with the result (insert the missing tags, delete the
stale ones).

- **Every listed job is re-resolved on every run.** That's about 1,000 titles
  of pure Python, so an alias added today is applied on the next scheduled run
  (every three hours) with no backfill script.
- **Titles that resolve to nothing go into the import report**, as unresolved
  locations do. Reading that list is how the alias list grows, and every
  alias added there also improves search.
- **Company-posted jobs are untouched**, as the import never touches them.
  How they get roles is open (below).

## The query

`GET /jobs` gains two parameters, combined with the existing location,
workplace, experience and posted filters the same way: each one narrows.

- **`?role=`**, repeated for several (`?role=software_engineer&role=ml_engineer`),
  keeps jobs tagged with any of them: an `EXISTS` on `job_role_tags`, like
  `?location=`. Validated against the slug shape only; an unknown slug matches
  nothing.
- **`?q=`**, free text, read in two parts:
  1. **The roles it names.** The same resolver reads the query, so "swe"
     finds `software_engineer`. Each role found narrows to jobs tagged with it.
  2. **Whatever is left** ("google", "react", "intern") must match either the
     keyword column (`fts @@ websearch_to_tsquery('english', rest)`) or the
     company name (trigram). Noise words like "intern" are **kept** in this
     leftover, not stripped, so they still narrow by keyword.

  So "google swe" is software engineer jobs that mention Google or are at
  Google, and "stripe" alone is every job at Stripe plus any whose text names
  it.

**Ranking.** Without `q`, the newest jobs come first, as today. With `q`:
company-name matches first, then by `ts_rank` (where the title outweighs the
description), then newest. The weights are a first guess until there is real
traffic to tune them on.

## Changes to `fts`

- **The title outweighs the description.** Today title and description are
  one undifferentiated string, so a mechanical engineering job that says
  "you'll work with our software engineers" ranks for "software engineer".
  The generated expression becomes
  `setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'D')`.
  A generated column's expression can't be altered in place on every Postgres
  version, so the migration drops and re-adds the column. Matching's skill
  overlap uses `@@`, which ignores weights, so its results don't change; only
  `ts_rank` does.
- **A GIN index on `fts`.** There is none today
  (`4485d7a7a712` added the column only), so every keyword search scans.

Both changes go in one migration, alongside the role tables or right after
them. As always, Claude writes it and checks it with `--sql`; a person applies
it (`backend/alembic/CLAUDE.md`).

## Why not something else

- **Elasticsearch, Typesense, Algolia.** At 1,000 to 100,000 jobs, Postgres
  with GIN indexes answers in milliseconds. Another engine is another service
  to deploy and another copy of the jobs to keep in sync with every import.
- **The role list as a frontend constant or a shared JSON file.** It would be
  two copies on two deploys, with no foreign key behind either one.
  `EXPERTISE_SUGGESTIONS` in the onboarding form is one of these today, and is
  replaced by `GET /jobs/roles` later.
- **Resolving with embeddings (nearest role vector).** It may become a
  fallback for titles no alias catches, but it is not needed to start. It
  would put a Gemini call in the import's role step, and its mistakes are
  harder to see than a missing alias.

## Later (not this work)

- **Onboarding:** the applicant picks roles from `GET /jobs/roles`, stored in
  `profile_job_roles (profile_id → profiles ON DELETE CASCADE, role_slug →
  job_roles)`. The onboarding form is not touched until then.
- **Recommendations:** jobs tagged with one of the applicant's picked roles
  rank first, ahead of matching's score. How that combines with the scorer is
  for `matching/CLAUDE.md` to decide.

## Still open

- **The aliases:** the first draft for `role_resolver.py`, written from the
  current feed's titles. The roles themselves are seeded (`ab07572bba38`).
- **Typeahead:** one endpoint suggesting roles and companies as the user
  types, or two.
- **Roles for company-posted jobs:** the company form picks them, or the
  resolver runs on the title at create.
- **Query noise as filters:** whether "intern" or "new grad" in `q` should set
  the experience filter rather than search by keyword.
- **Symbols:** the `english` parser reads "C++" and "C#" as "c". Searching for
  them needs a title `ILIKE` fallback, or a different parser for those terms.
- **Removing a role:** `job_role_tags` refuses it (RESTRICT) while any job is
  tagged, so a removal deletes the tags first. Once `profile_job_roles`
  exists, decide what happens to applicants who picked it, or hide the role
  with an `active` flag instead of deleting it.
