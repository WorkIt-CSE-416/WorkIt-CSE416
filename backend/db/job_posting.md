# Job Posting — Schema Design

One `job_postings` table holds both kinds of posting: the ones an employer
typed into our form, and the ones the scraper observed in an ATS feed. They are
distinguished by `origin`, and that column decides which constraints apply.

Keeping them in one table is deliberate. Applications, saved jobs, and search
all point at "a job"; splitting by provenance would fork every one of those
relationships and every query. The cost is that a column required from an
employer cannot be required from a feed, which is what the partial `CHECK`
constraints below are for.

Tables:

- `job_postings` — one row per job, either origin. Title, description,
  classification, salary, location, visibility, and (for scraped rows) the
  lifecycle state that decides whether it is still open.
- `job_roles` — canonical job titles used as tags ("Software Engineer"),
  arranged as a tree. `parent_id` points at the broader role; `path` is the
  same hierarchy as an `ltree` value (`engineering.software.backend`) so a
  search for a parent role matches everything beneath it.
- `job_role_tags` — the posting ↔ role join. One row per pair.
- `role_aliases` — what people type instead of the canonical label: SWE,
  programmer, ui engineer. Each alias belongs to one role.

The four ingestion-only tables (`job_sources`, `job_payloads`, `scrape_runs`,
`scrape_source_runs`) are specified in
[the scraper architecture](../../docs/KAN-55_JOB_SCRAPER.md) §5. Only
`job_sources` is reproduced here, because `job_postings.source_id` references
it and Alembic cannot order a foreign key before its target.

## What changed from the first draft, and why

| Change | Reason |
| --- | --- |
| `company_id` now nullable | A scraped board often has no company row to map to. Discovery must never invent one |
| Added `origin`, `source_id`, `external_id` | Without these there is no way to tell a scraped row from an employer row, and no dedup key |
| `description` split into `_html` / `_text`, both nullable | Providers return HTML, and a detail fetch can fail while the job plainly exists |
| Classification columns nullable | Most feeds do not state job type, experience level, or work style. Unknown must stay unknown |
| Dropped the "salary must exist" check | Most scraped postings publish no salary |
| `salary_currency` nullable, no `USD` default | Defaulting the currency invents data. A wrong salary is worse than no salary |
| Dropped scalar `salary`; min/max are `numeric` | Three columns for one concept was ambiguous, and `integer` overflows on IDR and VND |
| `locations` array added | Postings listed in five cities are ordinary; dropping four of them loses real information |
| Lifecycle columns added | `active`, `is_listed`, streaks and closure have nowhere else to live |
| `public_jobs` view added | One place enforces "only show open, listed jobs", instead of every route remembering |

## Enumerated types

```sql
CREATE TYPE job_origin       AS ENUM ('employer', 'scraped');
CREATE TYPE job_type         AS ENUM ('full_time', 'part_time', 'contract', 'internship', 'temporary');
CREATE TYPE experience_level AS ENUM ('internship', 'new_grad', 'experienced');
CREATE TYPE work_style       AS ENUM ('remote', 'hybrid', 'onsite');
CREATE TYPE salary_period    AS ENUM ('year', 'month', 'week', 'day', 'hour');
CREATE TYPE job_post_status  AS ENUM ('draft', 'published', 'closed');
CREATE TYPE closed_reason    AS ENUM ('gone_from_feed', 'employer_closed', 'expired');
CREATE TYPE date_precision   AS ENUM ('unknown', 'relative_derived', 'date_only', 'exact');
CREATE TYPE ats_provider     AS ENUM ('greenhouse', 'lever', 'ashby', 'smartrecruiters');
```

`salary_period` gained `month`, `week`, and `day` because Lever and Ashby emit
all three. `job_type` gained `internship` and `temporary` for the same reason —
an enum that cannot represent a common feed value forces either a null or a
lie, and a lie is worse.

`date_precision` exists because feeds disagree about what a date means. "Posted
3 days ago" and an exact timestamp cannot be stored in the same column without
recording which one it was.

**Adding an enum value later is awkward under Alembic.** `ALTER TYPE … ADD
VALUE` runs inside a transaction on PostgreSQL 12+, but the new value cannot be
*used* until that transaction commits — so a single migration cannot add
`workday` to `ats_provider` and insert a row using it. Split it across two
revisions, or use a `text` column with a `CHECK` where values will churn. The
enums above are worth the friction; `ats_provider` is the one most likely to
grow.

## Extensions

```sql
CREATE EXTENSION IF NOT EXISTS ltree;    -- role hierarchy
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- fuzzy role/alias search
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()
```

## Ingestion registry

Reproduced from the architecture because `job_postings` references it. The
scraper owns every other column on this table; see §5 there for the full set.

```sql
CREATE TABLE job_sources (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ats           ats_provider NOT NULL,
    api_host      text         NOT NULL,
    board_token   text         NOT NULL,   -- provider-specific case is significant
    display_name  text         NOT NULL,
    company_id    uuid REFERENCES companies (id) ON DELETE SET NULL,  -- nullable on purpose
    enabled       boolean      NOT NULL DEFAULT true,
    sweep_enabled boolean      NOT NULL DEFAULT false,
    state_version bigint       NOT NULL DEFAULT 0,
    -- checkpoint, health, and conditional-request columns: architecture §5
    UNIQUE (ats, api_host, board_token)
);
```

`sweep_enabled` defaults to **false**. Sweeping is the only irreversible
behaviour in ingestion — it hides jobs from users — and the rollout requires it
stay off until a week of observation says otherwise.

## Job postings

```sql
CREATE TABLE job_postings (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    origin         job_origin NOT NULL,

    -- Employer identity. NULL for an unmapped scraped board.
    company_id     uuid REFERENCES companies (id) ON DELETE SET NULL,
    posted_by_user uuid,                    -- auth.users.id

    -- Scraped identity. NULL for employer-authored rows.
    source_id      uuid REFERENCES job_sources (id) ON DELETE RESTRICT,
    external_id    text,
    source_name    text,                    -- board display name at observation time
    apply_url      text,                    -- where the candidate actually applies

    title             text NOT NULL,
    description_html  text,                 -- verbatim from the source; UNTRUSTED
    description_text  text,                 -- derived plain text

    job_type             job_type,
    experience_level     experience_level,
    min_years_experience smallint,
    department           text,
    team                 text,
    requisition_id       text,

    work_style       work_style,
    location_raw     text,                  -- exactly as the source wrote it
    location_city    text,                  -- primary location, for filtering
    location_country char(2),               -- ISO 3166-1 alpha-2
    locations        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- every location supplied

    salary_min       numeric(14,2),
    salary_max       numeric(14,2),
    salary_currency  char(3),               -- no default; unknown stays unknown
    salary_period    salary_period,
    salary_raw       text,                  -- original text, when the source gave prose
    compensation_ranges jsonb NOT NULL DEFAULT '[]'::jsonb,  -- all tiers and components

    -- Visibility and lifecycle
    status        job_post_status,          -- employer workflow; NULL for scraped
    is_listed     boolean NOT NULL DEFAULT true,
    active        boolean NOT NULL DEFAULT true,
    closed_at     timestamptz,
    closed_reason closed_reason,
    missing_streak smallint NOT NULL DEFAULT 0,

    -- Provenance and timing
    posted_at           timestamptz,
    posted_at_precision date_precision NOT NULL DEFAULT 'unknown',
    source_published_at timestamptz,
    source_updated_at   timestamptz,
    first_seen_at       timestamptz NOT NULL DEFAULT now(),  -- immutable after insert
    last_seen_at        timestamptz,
    content_hash        text,
    content_updated_at  timestamptz,
    normalizer_v        smallint,
    closes_at           timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    -- Each origin supplies its own identity, and never the other's.
    CONSTRAINT origin_identity CHECK (
        (origin = 'scraped'  AND source_id IS NOT NULL AND external_id IS NOT NULL)
     OR (origin = 'employer' AND source_id IS NULL     AND external_id IS NULL
                             AND company_id IS NOT NULL)
    ),
    -- Strict where we control the input; permissive where we only observe it.
    CONSTRAINT employer_required_fields CHECK (
        origin <> 'employer' OR (
            job_type IS NOT NULL AND experience_level IS NOT NULL
            AND work_style IS NOT NULL AND description_html IS NOT NULL
            AND status IS NOT NULL
        )
    ),
    CONSTRAINT scraped_has_no_status CHECK (origin <> 'scraped' OR status IS NULL),
    CONSTRAINT salary_range_ordered CHECK (
        salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max
    ),
    CONSTRAINT salary_non_negative CHECK (
        (salary_min IS NULL OR salary_min >= 0) AND (salary_max IS NULL OR salary_max >= 0)
    ),
    -- A figure without its unit is unusable, and guessing the unit is forbidden.
    CONSTRAINT salary_has_units CHECK (
        (salary_min IS NULL AND salary_max IS NULL)
        OR (salary_currency IS NOT NULL AND salary_period IS NOT NULL)
    ),
    CONSTRAINT closure_consistent CHECK (
        (active AND closed_at IS NULL AND closed_reason IS NULL)
        OR (NOT active AND closed_at IS NOT NULL AND closed_reason IS NOT NULL)
    ),
    CONSTRAINT missing_streak_bounded CHECK (missing_streak BETWEEN 0 AND 2),
    CONSTRAINT locations_is_array CHECK (jsonb_typeof(locations) = 'array'),
    CONSTRAINT apply_url_scheme CHECK (apply_url IS NULL OR apply_url ~* '^https?://')
);

-- The scraper's natural key. This is what makes upserts idempotent.
CREATE UNIQUE INDEX job_postings_source_external_idx
    ON job_postings (source_id, external_id)
    WHERE origin = 'scraped';

-- The board query: newest open, listed jobs first.
CREATE INDEX job_postings_board_idx
    ON job_postings (posted_at DESC NULLS LAST)
    WHERE active AND is_listed;

CREATE INDEX job_postings_company_idx ON job_postings (company_id);

-- Sweep and detail-backlog scans walk one board at a time.
CREATE INDEX job_postings_source_active_idx ON job_postings (source_id, active);

CREATE INDEX job_postings_title_trgm ON job_postings USING gin (title gin_trgm_ops);
CREATE INDEX job_postings_locations_idx ON job_postings USING gin (locations);
```

### Why `company_id` is `ON DELETE SET NULL`, not `CASCADE`

The first draft used `CASCADE`, which is right for employer postings and wrong
for scraped ones: the architecture requires that jobs survive when a company
mapping is removed, and a cascade would delete them instead. One foreign key
cannot behave two ways, so it preserves rows.

The consequence is deliberate and worth knowing: because `origin_identity`
still requires `company_id` on employer rows, **deleting a company that has
employer-authored postings fails** — the cascade sets the column null and the
check rejects it. Reassign or delete those postings first. That is a louder
failure than silently destroying job history, which is the trade we want.

### Why `location_city` survives alongside `locations`

`locations` is the truth — every location the source supplied, in order.
`location_city` / `location_country` are the *primary* one, duplicated out so
that filtering and indexing stay cheap; a `gin` lookup into JSONB for every
faceted search is not worth it. The scraper writes both from the same parse, so
they cannot disagree, and the scalar is always `locations[0]`.

This is a deliberate denormalization. If it ever drifts, `locations` wins.

### `first_seen_at` is immutable

Set on insert, never updated — not even when a closed posting reopens. Analytics
and "how long has this been open" both depend on it, and a reopened job is the
same job. Enforce it in the store layer's upsert, and verify it
([verification](../../docs/KAN-55_SCRAPER_VERIFICATION.md) C24).

## Public reads

Every public job query goes through this view. Not a convention — the
[verification suite](../../docs/KAN-55_SCRAPER_VERIFICATION.md) J7 requires
that the filter live in exactly one place, because the third route somebody
adds next semester will not remember it.

```sql
CREATE VIEW public_jobs AS
SELECT *
FROM job_postings
WHERE active
  AND is_listed
  AND (status IS NULL OR status = 'published');
```

`SELECT *` here expands **once, at view-creation time**. A column added to
`job_postings` later will not appear in `public_jobs` until the view is
recreated, so every migration that adds a public column must
`CREATE OR REPLACE VIEW` alongside it. List the columns explicitly instead if
that feels too easy to forget.

The three conditions are independent and all necessary:

- `active` — the job still exists. A scraped posting that vanished from its
  feed twice is `false`; an employer who closed the role is `false`.
- `is_listed` — the posting may be shown publicly. Ashby "direct link only"
  postings are live and applicable but deliberately absent from the board, so
  they are `active AND NOT is_listed`.
- `status` — employer workflow. A draft is not public. Scraped rows have no
  status, which is why the clause allows `NULL`.

`job_sources`, `job_payloads`, `scrape_runs`, and `scrape_source_runs` are
service-only: no API route exposes them, ever (verification J6).

## Roles

Unchanged from the first draft, and still good. One caveat below.

```sql
CREATE TABLE job_roles (
    id        uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id uuid  REFERENCES job_roles (id) ON DELETE CASCADE,
    role_name text  NOT NULL,
    path      ltree NOT NULL UNIQUE     -- engineering.software.backend
);
CREATE INDEX job_roles_path_idx      ON job_roles USING gist (path);
CREATE INDEX job_roles_parent_idx    ON job_roles (parent_id);
CREATE INDEX job_roles_name_trgm     ON job_roles USING gin (role_name gin_trgm_ops);

CREATE TABLE job_role_tags (
    job_posting_id uuid NOT NULL REFERENCES job_postings (id) ON DELETE CASCADE,
    role_id        uuid NOT NULL REFERENCES job_roles (id)    ON DELETE CASCADE,
    PRIMARY KEY (job_posting_id, role_id)
);
CREATE INDEX job_role_tags_role_idx ON job_role_tags (role_id, job_posting_id);

CREATE TABLE role_aliases (
    role_id uuid NOT NULL REFERENCES job_roles (id) ON DELETE CASCADE,
    alias   text NOT NULL,
    PRIMARY KEY (role_id, alias)
);
CREATE INDEX role_aliases_trgm ON role_aliases USING gin (alias gin_trgm_ops);
```

**Scraped postings arrive with no role tags.** The scraper reads a title string;
it has no way to decide that "Sr. Backend Engineer II" belongs under
`engineering.software.backend`. Mapping titles to canonical roles is a
classification step that nobody has scoped yet, and until it exists, any search
that filters on `job_role_tags` returns employer-authored jobs only.

That is worth deciding before search is built on tags. The cheap interim is to
fall back to trigram search on `title` when no role filter matches.

**`role_aliases` permits the same alias under two roles.** The primary key is
`(role_id, alias)`, so "architect" can sit under both software and building
trades. That may be intended; if an alias should resolve to exactly one role,
the key should be `(alias)` with `role_id` as a plain column.

## Deletion

Scraped postings are **never deleted** as a retention policy. A closed job keeps
its row so that application links, saved jobs, and history survive, and so the
same posting reopens into the same row if it returns to the feed. Closure is
`active = false` plus `closed_at` and `closed_reason`.

Disabling a source does not delete its jobs. Removing a company mapping does not
delete its jobs. `job_postings.source_id` is `ON DELETE RESTRICT` for that
reason: a source row with postings cannot be dropped by accident.
