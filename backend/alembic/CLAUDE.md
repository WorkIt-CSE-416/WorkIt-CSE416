# CLAUDE.md — alembic

Decisions made in this folder and the failures each one prevents. Loaded on top
of `../CLAUDE.md` (the Python API) and the repo root's. Read this before editing
`env.py`, `alembic.ini`, or any migration.

Alembic is the **single source of truth for the schema**. `../db/*.md` are
design rationale; the database is whatever the migrations here say it is.

## Never run `alembic init` again

It overwrites `env.py` with the stock template. That discards every filter
below and restores a version whose first autogenerate proposes dropping
`auth.users`. The scaffold was a one-time command and is already done.

## The connection URL is not in alembic.ini

`alembic.ini` is committed; the database password is not. `env.py` reads
`DIRECT_URL` through `app.config` instead.

Adding a `sqlalchemy.url` line back would leak the credential *and* silently
override the environment, so a teammate's migrations would run somewhere they
did not expect.

`DIRECT_URL` is the **session pooler, port 5432** — not the 6543 transaction
pooler the app uses. DDL takes locks and needs one serial conversation;
migrations through a transaction pooler are unreliable in ways that do not
announce themselves.

## Why env.py filters schemas

The load-bearing decision in this folder.

Alembic compares the live database against `Base.metadata` and treats anything
present in the database but absent from the metadata as something to **DROP**.
On Supabase that describes the entire platform: `auth`, `storage`, `realtime`,
`vault`, and the rest. This application did not create them and must never
generate DDL against them.

`include_name` and `include_object` restrict Alembic to `public`. Verified
against a database holding `auth.users` and `storage.objects`:

```
with the filters:     pass                                    (empty migration)
without the filters:  op.drop_table('objects', schema='storage')
                      op.drop_table('users', schema='auth')
```

Two filters rather than one, doing different jobs:

- `include_name` stops reflection descending into a foreign schema at all.
- `include_object` catches anything that gets through, and keeps working if
  someone sets `include_schemas=True` without reading this file.

They allow `public` rather than denying a list, so a schema Supabase adds later
is excluded automatically. `SUPABASE_SCHEMAS` in `env.py` is documentation of
what exists, not the mechanism.

## Other context.configure settings

- `include_schemas=False` — Alembic's default, set explicitly because on
  Supabase it is the difference between a clean diff and a catastrophe.
- `compare_type=True` — detect a column whose type changed. Cheap, and off by
  default in older Alembic.
- `compare_server_default=False` — deliberately off. Defaults like
  `gen_random_uuid()` and `now()` round-trip as differently-spelled but
  equivalent expressions, so enabling it reports phantom changes on every run.
- `configure_context()` is shared by offline and online modes so the two cannot
  drift apart. Add new settings there, not to one path.

The async template (`alembic init -t async`) was used because the app is async
over asyncpg. One driver, one URL format, no second sync dependency.

## Import every new model in env.py

A model that no import reaches is absent from `Base.metadata`, and autogenerate
will write a migration **dropping the table it cannot see**. When `app/models/`
exists, the import goes at the marked spot in `env.py`:

```python
from app import models  # noqa: F401
```

The `noqa` is load-bearing — linters remove "unused" imports, and removing this
one is how the table gets dropped.

## Autogenerate covers about two thirds of this schema

Read every generated migration before applying it. Autogenerate does **not**
emit:

- `CREATE EXTENSION` — this schema needs `ltree` and `pg_trgm`
- new enum values — `ALTER TYPE ... ADD VALUE`, and there are five enums
- index operator classes — `gin_trgm_ops`, used on two tables
- anything `ltree` — no native type, so it needs a `TypeDecorator`

Hand-write those with `op.execute()`. The first migration in particular must
create the extensions before any table that depends on them, so write it by
hand rather than trusting a diff.

Check first whether the extensions are already enabled: Supabase's dashboard
installs them into an `extensions` schema, so a project where someone clicked
them on behaves differently from a clean one.

## versions/

One file per migration, `<revision>_<slug>.py`. Committed — they are the
schema's history, and the `.gitignore` covers only `__pycache__` and `*.pyc`.

The directory is empty until the first model exists, and `--autogenerate`
correctly produces `pass`. That is the expected output, not a broken setup.
Alembic recreates the directory if it is missing, so git not tracking it while
empty is harmless.

`revision` and `down_revision` form a linked list. That chain is what defines
order and what "head" means.

**Never delete an applied migration.** If the database's `alembic_version`
table points at a revision whose file is gone, `alembic upgrade head` fails
with `Can't locate revision identified by ...` for everyone, and the fix means
hand-editing a table. To undo one: `alembic downgrade`, *then* delete the file,
and only if nobody else has applied it.

Squashing is safe only before the first real deployment — drop the migrations,
drop `alembic_version`, regenerate one initial migration. After that it is not.

## script.py.mako

The Mako template rendered to produce each new migration. It is the skeleton,
not documentation, and `alembic revision` fails without it.

Edit it to add imports every migration needs rather than hand-adding them
thirty times. This schema will want `from sqlalchemy.dialects import
postgresql`, and the ltree type once it exists.

## Multi-team

Two CI gates are worth adding before the first migration lands. Neither exists
yet — there is no CI in this repo.

- **`alembic heads` must return exactly one.** Two branches off one revision
  each adding a migration produces two heads, and `upgrade head` then fails for
  everyone. The `down_revision` git conflict this causes is a feature: resolve
  it by re-parenting one revision, never by picking a side.
- **`alembic check`** fails when models contain changes no migration captures —
  the defect that otherwise detonates in a teammate's environment rather than
  the author's.

Enum values deserve a design note: `ALTER TYPE ... ADD VALUE` does not roll
back cleanly, so every new value is a coordinated deploy. Correct for fixed
domains like `job_type`. For anything expected to grow with the product, a
lookup table costs a join and saves the coordination.
