# Auth Tables — Field Alignment and Setup Methodology

Design notes, not a source of truth — same rule as `job_posting.md` and
`resume.md`. Alembic is the source of truth once the first migration exists;
this file explains how to get there for the login/create-account/onboarding
screens and records the decisions that are still open.

Screens referenced below: `frontend/src/app/login/page.tsx`, `.../signup/page.tsx`,
`.../onboarding/applicant/*`, `.../onboarding/company/page.tsx`. Models referenced:
`backend/app/models/profiles.py`, `backend/app/models/dto.py`.

## 1. Field alignment

What each screen collects today, and what it maps to on `Profile`,
`Applicant_Profile`, `Company_Profile`, `Company_Membership`.

| Screen field                    | Screen(s)             | Maps to                                      | Status |
| -------------------------------- | ---------------------- | --------------------------------------------- | ------ |
| `accountType` (applicant/company) | login, signup         | Routing only — which table a request reads/writes | Aligned. No column needed; it selects `applicant_profiles` vs `company_memberships` at the request layer. |
| `email`                          | login, signup         | `Profile.email`                               | Shape aligned. **Uniqueness scope is undecided** — see §2. |
| `password`                       | login, signup         | *(no column)*                                 | **Gap.** No credential column exists on any table yet. |
| `confirmPassword`                | signup                 | *(nothing — client-only)*                     | Not a gap. Client-side match check; never sent past validation. |
| `name`                           | signup                 | `Profile.full_name`                           | Aligned — rename `name` → `full_name` at the request-schema layer. |
| *(no field collected)*           | signup / onboarding    | `Company_Profile.company_name` (**NOT NULL**) | **Gap.** Required column, nothing on any screen collects it. |
| *(no field collected)*           | signup / onboarding    | `Company_Profile.size_range` (**NOT NULL**, enum) | **Gap.** Required column, no default, nothing on any screen collects it. Missed on the first pass through this table; caught later when a real `INSERT` against `Company_Profile` was attempted and failed on this column too. |
| *(no field collected)*           | signup / onboarding    | `Company_Membership.role` (**NOT NULL**, enum) | **Gap.** Not user-entered anywhere — needs a server-assigned default (`owner`) for the account that creates the company. |
| *(no field collected)*           | signup / onboarding    | `Company_Membership.headline` (**NOT NULL**, `String(50)`) | **Gap.** Required column, nothing on any screen collects it. Note: `Applicant_Profile.headline` is `Optional` — the two `headline` columns disagree on nullability even though neither is collected at signup today. |
| `expertise[]`                    | onboarding/applicant   | *(no column)*                                 | Out of scope right now — `models/CLAUDE.md` defers applicant tag/preference data; no table exists to hold it. |
| `resumeFile`                     | onboarding/applicant   | *(no column)*                                 | Explicitly deferred — see `db/resume.md`. Separate ticket by design. |
| `jobTypes[]`                     | onboarding/applicant   | *(no column)*                                 | Out of scope right now, same as `expertise[]`. |
| *(nothing decides this today)*   | n/a                     | *(no column)*                                 | **Gap.** No signal on either account table for "has this account finished onboarding" — needed to route a first-time profile to `/onboarding/*` and a returning one straight to `/jobs` or `/company`. |

Everything under **Gap** above the onboarding-only rows blocks the
login/signup path specifically; those onboarding-only fields (`expertise`,
`resumeFile`, `jobTypes`)
are separately-scoped work that already has its own ticket or design doc and
does not need a decision here.

## 2. Decisions

Four questions, each already raised in `backend/CLAUDE.md` /
`app/models/CLAUDE.md` or surfaced by the table above. None of them were safe
to default silently — each changes what a migration or a request schema looks
like. Resolved 2026-09-16; recorded here so the answer lives in one place
instead of three.

1. **Where does the password hash live? → `password_hash` column on each
   table.** `applicant_profiles` and `company_memberships` each get their own
   column. Keeps the two account types independent, matching the rest of this
   schema's "no shared identity table" design — no shared `credentials` table.
2. **Is `email` unique per table or globally? → Per table, unchanged.** The
   same address may exist in both `applicant_profiles` and
   `company_memberships`. The login screen already sends `accountType` in its
   POST body, so a request already says which table to check — no cross-table
   uniqueness constraint needed.
3. **How does the app know to route to onboarding vs. the dashboard? → an
   explicit `onboarding_completed_at` column.** Nullable timestamp on both
   `applicant_profiles` and `company_memberships`, set the first time
   onboarding's Continue action fires. `NULL` means "route to
   `/onboarding/*`"; set means "route to `/jobs` or `/company`".
4. **How does a first-time company signup create its company? → deferred, not
   addressed in this pass.** `signup` still collects no company name, and
   `company_memberships.company_id` / `company_profiles.company_name` stay
   `NOT NULL`. This means **the company signup path cannot be completed
   end-to-end yet** — the gap is known and intentionally left open rather than
   guessed at. Revisit before wiring `signup/actions.ts` for the company side.

   A prototype implementation (2026-09-21) closed this out — a
   `SignupRequest.companyName`/`.companySize` pair and a
   `_signup_company()` that created `company_profiles` +
   `company_memberships` atomically, the same transaction shape as the
   applicant path — and it worked, verified against the live DB. It was
   reverted at the product level, not for a technical reason: there's
   nowhere for a new company account to land, since `onboarding/company` is
   still a stub. **Revisit this decision once `onboarding/company` is a
   real screen**, not before — building the signup fields again ahead of
   that route landing just reproduces the same dead end. The reverted work
   also surfaced a second NOT NULL gap this document's table had missed
   (`Company_Profile.size_range`, no default) — that finding is kept in the
   table above even though the fields it motivated were rolled back, since
   it's still true and still blocking.

Decisions 1–3 unblock writing the applicant-side login/signup migration.
Decision 4 blocks the company side specifically and is tracked, not resolved.

## 3. Methodology: model → migration → endpoint

The order that keeps each layer honest about what the one below it actually
contains. Skipping ahead (writing a migration before the model is settled, or
a route before the migration is applied) is how `alembic check` starts
failing in someone else's environment instead of the author's.

### Step 1 — Settle the model (`app/models/profiles.py`, `app/models/dto.py`)

- Resolve the open decisions in §2 first; a column added to guess at an
  unresolved decision is a second migration later, not a shortcut now.
- Follow the conventions already established in `app/models/CLAUDE.md`:
  - Import `Base` from `app.db`, never redeclare it.
  - New shared columns go on the abstract `Profile`/`BaseModel`, not copied
    onto each concrete table.
  - A new enum keeps its member name and value identical unless there's a
    documented reason not to (see the `company_size_range` exception) —
    otherwise `== "string literal"` comparisons silently misbehave.
  - Register the model in `app/models/__init__.py` if it's a new table; an
    existing table just gaining a column needs no registration change.

### Step 2 — Generate the migration

```
uv run alembic revision --autogenerate -m "add auth credentials"
```

- **Read the generated file before applying it.** Autogenerate does not emit
  `CREATE EXTENSION`, new enum values, or anything requiring `op.execute()` —
  none of those apply to this change today, but a `password_hash` column with
  a `CHECK` constraint (e.g. non-empty) would need hand-adding.
- This repo has **no migrations yet** — this will be the first `versions/`
  file. Per `alembic/CLAUDE.md`, a first migration is reviewed by hand rather
  than trusted from the diff, since there's no prior migration to diff
  against for sanity.
- Confirm `alembic heads` still returns exactly one revision before moving on.

### Step 3 — Apply and verify

```
uv run alembic upgrade head
uv run alembic current      # confirm the DB is on the new revision
uv run alembic check        # confirm no model change is left uncaptured
```

Applied against `DIRECT_URL` (session pooler, port 5432) — never the pooled
`DATABASE_URL` the app itself uses; see `backend/CLAUDE.md` for why DDL needs
the session pooler.

### Step 4 — Pydantic schemas (`app/schemas/`, not yet created)

Separate from the SQLAlchemy models per `backend/CLAUDE.md` — "the first time
an internal column must not be exposed, you will regret" collapsing them.
For auth specifically:

- A `LoginRequest` / `SignupRequest` pair per account type, or one pair
  parameterized by `accountType` — mirrors how the frontend already sends one
  shape with a discriminator field rather than two separate forms.
- **No response schema ever includes `password_hash`.** This is the concrete
  case the models/schemas split exists for.
- Field names follow the request body, not the column — `full_name` on the
  model can still read `name` off the request if that's the wire name the
  frontend keeps sending.

### Step 5 — Hashing, session issuance, routes (`app/routers/auth.py`) — done

- Password hashing: argon2id via `argon2-cffi` (`app/security.py`), not
  hand-rolled. See `db/auth_implementation_log.md` Stage 1.
- Session token issuance and the verification dependency other routes use —
  `app/deps.py`'s `get_current_account`, per the "Auth" section of
  `backend/CLAUDE.md`'s three rules (verify every token's signature,
  authorization is Python not RLS, never trust a client-supplied
  `company_id`/`profile_id`/role). See Stages 2 and 7.
- The onboarding-redirect behavior the login screen needs
  (`onboarding_completed_at IS NULL` → `/onboarding/*`, otherwise → `/jobs` or
  `/company`) is read off `AuthenticatedAccount` by `frontend/src/app/login/
  actions.ts` and `signup/actions.ts` — a frontend routing concern, as this
  step originally said, now actually wired rather than just described.

## 4. What this unblocks

Decisions 1–3 and Steps 1–5 are done; decision 4 is deliberately still open
(see above). `frontend/src/app/login/actions.ts` and `signup/actions.ts` are
no longer stubs — both call the API through `frontend/src/lib/auth.ts`, and
`frontend/CLAUDE.md`'s Auth section has the frontend-side details (how the
token travels, `API_URL`). This covers applicant accounts end to end;
`login` will authenticate an existing company account too (login never had
decision 4's gap — see Stage 6 in `auth_implementation_log.md`), but
`signup` still returns `501` for one, and nothing creates that "existing
company account" today. What's left is `onboarding/company` still being a
stub (the actual blocker on decision 4) and the two open questions
`backend/CLAUDE.md`'s Auth section lists that this document never had to
answer (RLS as a backstop; whether the two halves ever move to different
origins, which would change how the token travels).
