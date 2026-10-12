# Human TLDR 
- each job is mapped to a specific job role that's hard-coded in a list. This supports future filtering, onboarding form and recommendation 
- to match a job title to role: 
  - first clean up the title, strip away punctuations and other info 
  - construct a look up dict that contains key words for each of the job role from hard coded list 
  - resolve similar meaning titles such as "developer" vs. "engineer" and match all slugs 

- During search: 
  - run the same resolver to get the roles 
  - change common words such as Intern, Internship into job categories, Remote to work_style, start_term etc. 
  - on top of these, search for titles that contain these. (go through description would help but adds too much noise and time)

- Company Resolution: 
  - each query, builds and stores a cached all company-names list. For the query, first scan through the company using the same kind of resolution as job_role, and search for posts under the company. Then returns everything with the remaining text for job search

# Search and Role Resolution — Design

Status: agreed 2026-10-10 (KAN-155). Built so far: the `job_roles` and
`job_role_tags` tables (`backend/app/models/job_roles.py`, migration
`362182aaa4fd`), the first 49 roles (`ab07572bba38`), the title resolver
(`backend/app/services/role_resolver.py`), which the import runs to tag every
scraped job, and the switch: `GET /jobs?role=` and `?q=`, `GET /jobs/roles`,
the facets' role options, the weighted `fts` and its index (`a70c641b2f99`),
the Jobs page's Role filter and search, and dropping KAN-172's `roles` and
`role_category` columns (`824f0b2e3d84`, applied after the deploy) (2026-10-11).
This
is the rationale;
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
2. **Normalize word forms** with one small table (`WORD_FORMS`) applied to
   every word: `engineering`/`engineers` → `engineer`, `sw` → `software`,
   `dev` → `developer`, `fullstack` → `full stack`, and so on. Aliases go
   through the same table when the dictionary is built, so "Software
   Engineering Intern" meets the alias `software engineer`. One entry here
   fixes every role at once instead of each role listing every form. **Only a
   person's forms, never a process:** mapping `development` → `developer`
   tagged "AI Engineer - Graduate Development Program" as software, so
   "software development" and "business development" are aliases instead.
3. **Look up phrases, longest first.** Walk the words left to right; at each
   word, try the longest alias that could start there, then shorter ones. Each
   try is one dict lookup on a tuple of words. A match records its slug and
   uses up its words; no match moves on one word.
4. **Outright roles win.** Some roles are the job itself, with any field
   words only saying which area it serves: product manager, product designer,
   marketing, sales, recruiter, teacher, store manager, real estate agent
   (`OUTRIGHT`). If one matched, the other roles are dropped: "Technical
   Recruiter, Software Engineering" is a recruiter job, "Product Manager,
   Machine Learning Platform" a product one. **Their aliases name the job,
   never only its field**, or "Software Engineer, Sales Platform" would lose
   its software tag to a lone "sales".
5. **Tag every role left; no match means no tag.** `Software Engineer
   (Machine Learning) Intern` is `software_engineer` and `ai_ml_engineer`. A bare
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
    ("software",): "software_engineer",              # "Flight Software Intern"
    ("developer",): "software_engineer",             # "Junior Java Developer"
    ("engineer", "data"): "data_engineer",           # "Engineer, Data"
    ("business", "developer"): "sales_representative",
    ("machine", "learning"): "ai_ml_engineer",
    ("research", "park"): "",                        # NOT_ROLES: passed over
    ...
}
```

Each role's own `name` from `job_roles` is always one of its aliases, so a
title that is exactly a role's name always resolves to it, and a long name
("Embedded Software Engineer") beats the shorter aliases inside it.

- **Every alias belongs to exactly one role.** Building the dict fails if two
  roles claim the same phrase (after normalizing), so a duplicate can't
  silently pick a winner.
- **One-word aliases are safe because longer ones are tried first.**
  "Business Developer" meets the two-word sales alias before `developer` is
  ever looked up.
- **Reordered titles get their own alias** (`engineer data`) rather than
  matching words anywhere in the title. See "Measured" below for why. A
  one-word alias covers its reversed form already ("Engineer, Software" meets
  `software`).
- **Some phrases look like a role and aren't** ("UIUC Research Park",
  "Hardware-In-The-Loop", "Embedded Science Team"). `NOT_ROLES` lists them:
  they use up their words and tag nothing.
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

**The built resolver** (first alias draft, about 300 phrases across the 32
roles) tags **1,050 of 1,096 (95.8%)**. Reading every multi-tagged title for
wrong tags is what found the word-form and `NOT_ROLES` rules above. The 46
untagged are mostly generic AI internships that rightly match nothing ("AI
Labs Intern", "AI Data Rater"). `tests/test_role_resolver.py` holds the cases
and a 90% floor on this snapshot.

**Precision over recall.** A wrong tag puts a job in a filter where it doesn't
belong, which the user sees. A missing tag only means the job is found by
keyword instead. When in doubt, leave the tag off.

### In the import

`backend/app/scripts/import_jobs.py` resolves each distinct title once in
`prepare()`, beside its location, then after the upsert `_sync_roles` brings
each job's `job_role_tags` in line with the result (insert the missing tags,
delete the stale ones, leave a job already right alone), shaped like
`_sync_locations`.

- **The resolver is built from `job_roles` as the database holds it.** An
  alias for a slug that isn't there (the seed not applied, or a typo) makes
  the import refuse before writing anything, instead of failing a foreign
  key halfway.
- **Measured on a local Postgres with the 1,096-job feed (2026-10-11):** 1,050
  jobs tagged with 1,201 tags; a second run on the same feed changed nothing;
  a missing tag, a stale tag and a retitled job were each put right.

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
- **`?q=`**, free text, read in parts (`read_search` in
  `backend/app/routers/jobs.py`):
  0. **The companies it names** (`backend/app/services/company_resolver.py`),
     first, so a name keeps its words: "Bedrock Robotics" is that company,
     not the robotics role, while "robotics" alone is the role. Whole names,
     longest first, as the role resolver reads a title; never a substring, so
     "data engineer" is not Datadog. A job must be at one of them
     (`company_name IN (...)`): "stripe" is Stripe's 20 jobs, not the 27 whose
     text also says Stripe. After the roles and facts have taken their words,
     a typo in what is left is corrected to the one name close to it
     (`difflib` against whole names, ratio ≥ 0.8, five letters or more, and
     only when exactly one name is close): "strpe" is Stripe, "spacx" SpaceX,
     "jump tradng" Jump Trading, while "data", "cloud" and "react" are close
     to no whole name and stay words.

     **The list is the data, not a table.** The names are `SELECT DISTINCT
     company_name` over the listed jobs, held in memory and read again every
     five minutes (`COMPANY_TTL`), since each import adds and drops
     companies; a job already has its company, so nothing is tagged or
     stored. A one-word name that is a search's own word (a role's alias,
     "intern", "remote") is skipped, so it keeps its meaning; on the
     2026-10-11 feed that is one company, named "Internship". All the other
     389 names resolve to themselves.

     **No short forms.** Trigram similarity (`pg_trgm`) was measured and
     dropped: "spacx" came out as six "… Space" companies and "strpe" tied
     Strada with Stripe, and fuzzing every word against names floods a
     search ("ai" is in 27 names, "capital" 10, "space" 9). Short forms made by
     stripping generic words ("Squarepoint" for Squarepoint Capital) were
     dropped too: "Chicago Trading Company" would become the key "chicago",
     and a search naming the city a filter to that one company. A partial
     name is still found in part 3, as the company's name containing the
     word: "squarepoint" finds Squarepoint Capital's 15 jobs that way.
  1. **The roles it names.** The same resolver reads the query
     (`RoleResolver.read_query`), so "swe" finds `software_engineer`. Each
     role found narrows to jobs tagged with it. It also returns the words no
     role used, as typed, which part 3 takes.

     Unlike a title, a query is **typo-corrected** first: a word of five or
     more letters that is in no alias becomes the nearest alias word
     (`difflib`, ratio ≥ 0.8), so "sofware enginer" and "machne lerning" find
     their roles. Shorter words are left alone, since at that length nearly
     everything is close to something ("ml"/"qa"), and the short words that
     matter are abbreviations the aliases spell exactly. A corrected word
     only counts as used if it completed an alias; otherwise it stays in the
     leftover as typed, so "scale" (close to "sales", which alone is no alias)
     still searches for Scale. Titles are never corrected: a guess there
     would be a stored tag. Checked on 2026-10-11 against 40 company,
     keyword and city names: none changed.
  2. **The facts it names that have columns** (`query_facts`): "intern",
     "internship", "co-op" are the internship experience level; "new grad",
     "early career", "entry level" are `new_grad`; "remote", "hybrid",
     "onsite"/"on-site"/"in person" the work style; "summer 2027" (either
     order, or a month: "january 2027" is Winter) a start season, and a bare
     "2027" any start that year. They are read from **the whole query**, not
     only what the roles left, so "marketing intern" is the marketing role
     (whose alias used "intern") *and* internships. Each narrows its own
     column beside the filter row's, so a search's "remote" with a ticked
     Hybrid finds nothing. Like those filters, each hides a job that doesn't
     state the fact: a start term hides the 311 of 780 internships (and most
     new-grad jobs) that name none, on the 2026-10-11 snapshot. As keywords
     they did worse: "intern" missed every "Internship" (the stemmer keeps them
     apart), "2027" matched any description mentioning the year, and "remote"
     matched 132 software jobs where the column holds 31.

     **A start term and "remote" also match the title** (`in_title`): a job
     counts when its column holds the value *or* its title says the words as
     typed ("Fall 2027", "Remote"). The title only, never the description,
     whose "graduating in 2027" and "not remote" are noise: with
     descriptions, "2027" gained 106 jobs, mostly such mentions, and ran 10x
     slower at 110k jobs (116 ms, against 19 ms for the title). Measured
     2026-10-11: the title adds 9 jobs to "2027" and none to "remote", since
     the scraper already fills both columns from the title; it is a net for
     what it misses. Hybrid and onsite are the column alone.
  3. **Every other word, one at a time**, must be in the job's text
     (`fts @@ plainto_tsquery('english', word)`, stemmed) **or** its
     company's name (`ILIKE`, as typed). Word by word, so "stripe intern"
     finds Stripe by its name: matching the leftover as one phrase found no
     company for any query with a second word. A stop word ("at", "the")
     makes an empty query and is passed over (`numnode` = 0).

  So "swe intern stripe" is software engineer internships at Stripe, and
  "jump tradng quant intern 2027" is Jump Trading's quant internships
  starting in 2027.

**No ranking.** A search filters; results are newest first, as the feed is.
Ordering by relevance is the recommendations' job (`backend/app/services/
matching`), not search's. The weighted `fts` (below) is there for that, and
costs search nothing.

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

- **Typeahead:** one endpoint suggesting roles and companies as the user
  types, or two.
- **Roles for company-posted jobs:** the company form picks them, or the
  resolver runs on the title at create.
- **Company suggestions:** the company resolver's names could feed a search
  box's suggestions (a companies endpoint), the "searching for companies"
  half of KAN-155 beyond the search itself.
- **Symbols:** the `english` parser reads "C++" and "C#" as "c". Searching for
  them needs a title `ILIKE` fallback, or a different parser for those terms.
- **Removing a role:** `job_role_tags` refuses it (RESTRICT) while any job is
  tagged, so a removal deletes the tags first. Once `profile_job_roles`
  exists, decide what happens to applicants who picked it, or hide the role
  with an `active` flag instead of deleting it.
