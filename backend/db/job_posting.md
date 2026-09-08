# Job Posting — Schema Design

Tables:
- `job_postings`: one row per job, holding the posting's own information —
  title, description, type/experience/work style, salary, status and dates.
  A posting can carry any number of role tags (see `job_role_tags`).
- `job_roles`: the canonical job titles used as tags — "Software Engineer",
  "Mechanical Engineer", etc.
    - the roles form a tree: `parent_id` points at the broader role
      (front end dev -> software eng), and `path` is the same hierarchy as an
      `ltree` value (`engineering.software.backend`) so a search for a parent
      role can match everything beneath it.
- `job_role_tags`: the job posting <-> job role join table. One row per pair,
  so a posting tagged with three roles has three rows here.
- `role_aliases`: the unconventional or abbreviated names people type instead
  of the canonical one — SWE, programmer, ui engineer. Each alias belongs to
  exactly one role, stored on the row itself (`role_id`), so no separate join
  table is needed.

Location is **not** its own table: a posting stores `location_city` and
`location_country` (ISO 3166-1 alpha-2) directly on `job_postings`, and both
are NULL when the job is fully remote.

## Enumerated types
```sql
CREATE TYPE job_type         AS ENUM ('full_time', 'part_time', 'contract');
CREATE TYPE experience_level AS ENUM ('internship', 'new_grad', 'experienced');
CREATE TYPE work_style       AS ENUM ('remote', 'hybrid', 'onsite');
CREATE TYPE salary_period    AS ENUM ('year', 'hour');
CREATE TYPE job_post_status       AS ENUM ('draft', 'published', 'closed');
```

## Extensions

```sql
CREATE EXTENSION IF NOT EXISTS ltree;    -- role hierarchy
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- gin_trgm_ops, fuzzy role/alias search
```

## Tables

```sql
CREATE TABLE job_postings (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    posted_by_user uuid,                    -- auth.users.id; see note below

    title       text NOT NULL,
    description text NOT NULL,              -- markdown

    job_type            job_type         NOT NULL,
    experience_level    experience_level NOT NULL,
    min_years_experience smallint,          -- the "custom year number"

    work_style      work_style NOT NULL,
    location_city   text,                   -- NULL when fully remote
    location_country char(2),               

    salary          integer, 
    salary_min      integer,                
    salary_max      integer,
    salary_currency char(3) NOT NULL DEFAULT 'USD',
    salary_period   salary_period NOT NULL DEFAULT 'year',
    status       job_post_status  NOT NULL DEFAULT 'draft',
    uploaded_at timestamptz NOT NULL,              
    closes_at    timestamptz,
    updated_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT salary_range_ordered CHECK (
        salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max
    ),
    CONSTRAINT salary_non_negative CHECK (
        (salary_min IS NULL OR salary_min >= 0) AND (salary_max IS NULL OR salary_max >= 0)
    ),
    CONSTRAINT salary_exist CHECK (
        salary IS NOT NULL OR (salary_min IS NOT NULL AND salary_max IS NOT NULL)
    )
);
-- sort by status and publish date newest first 
CREATE INDEX job_postings_board_idx    ON job_postings (status, uploaded_at DESC);

-- index the company_id, so every delete company efficiently deletes every job posting under that company without sequentially scanning 
CREATE INDEX job_postings_company_idx  ON job_postings (company_id);
```

```sql
-- The roles themselves, as a tree
CREATE TABLE job_roles (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id  uuid REFERENCES job_roles (id) ON DELETE CASCADE,
    role_name      text  NOT NULL,
    path       ltree NOT NULL UNIQUE    -- engineering.software.backend
);
CREATE INDEX job_roles_path_idx   ON job_roles USING gist (path);
CREATE INDEX job_roles_parent_idx ON job_roles (parent_id);
CREATE INDEX job_roles_role_name_trgm ON job_roles USING gin (role_name gin_trgm_ops);

-- One row per job-role PAIR. A posting has as many rows here as it has roles.
CREATE TABLE job_role_tags (
    job_posting_id uuid NOT NULL REFERENCES job_postings (id) ON DELETE CASCADE,
    role_id        uuid NOT NULL REFERENCES job_roles (id)     ON DELETE CASCADE,
    PRIMARY KEY (job_posting_id, role_id)
);
CREATE INDEX job_role_tags_role_idx ON job_role_tags (role_id, job_posting_id);

-- What people type instead of the canonical label: SWE, programmer, ui engineer.
CREATE TABLE role_aliases (
    role_id uuid NOT NULL REFERENCES job_roles (id) ON DELETE CASCADE,
    alias   text NOT NULL,
    PRIMARY KEY (role_id, alias)
);
CREATE INDEX role_aliases_trgm ON role_aliases USING gin (alias gin_trgm_ops);


