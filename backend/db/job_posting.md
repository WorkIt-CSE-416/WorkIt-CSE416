# Job Posting — Schema Design

Tables:
- job_postings: each job individual information  
    - each job posting will point to a specific tag 
- job_role: all kinds of roles that serve as tags 
    - this table stores all the common job titles such as "Software Engineer", "Mechanical Engineer", etc. 
    - each job role may have a parent ID if it's a subclass of the role (such as front end dev -> software eng) 
- job_alias: all unconventional/abbreviated job role names 
    - each will point to a job role  
- job_post_to_role: table highlighting which job posting points to which role 
- alias_to_role: table indicating which alias points to which job_role 
- location: stores all locations from country to cities. Each entry has a country_id indicating which country it refers to 
- job_post_to_location: indicating which job posting points to which location 



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
    status       job_status  NOT NULL DEFAULT 'draft',
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
        (salary NOT NULL) OR (salary_min NOT NULL and salary_max NOT NULL)
    ), 
);
-- sort by status and publish date newest first 
CREATE INDEX job_postings_board_idx    ON job_postings (status, published_at DESC);

-- index the company_id, so every delete company efficiently deletes every job posting under that company without sequentially scanning 
CREATE INDEX job_postings_company_idx  ON job_postings (company_id);
```

```sql
-- The roles themselves, as a tree. company_id NULL is a curated role
CREATE TABLE job_roles (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id  uuid REFERENCES job_roles (id) ON DELETE CASCADE,
    role_name      text  NOT NULL,
    path       ltree NOT NULL UNIQUE,   -- engineering.software.backend
);
CREATE INDEX job_roles_path_idx   ON job_roles USING gist (path);
CREATE INDEX job_roles_parent_idx ON job_roles (parent_id);
CREATE INDEX job_roles_label_trgm ON job_roles USING gin (label gin_trgm_ops);

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


