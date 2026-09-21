# Auth Backend — Implementation Log

Rolling progress log for the login/create-account backend. Companion to
`auth_methodology.md` (the process and the decisions already made) and
`app/models/CLAUDE.md` (schema invariants) — this file tracks what has
actually been *built*, stage by stage, and gets rewritten after every stage so
it stays a snapshot of "where things stand," not an append-only diary.

## Status

| # | Stage                              | State   |
| - | ----------------------------------- | ------- |
| 1 | Password hashing utility            | Done    |
| 2 | Session/token strategy              | Done    |
| 3 | First Alembic migration             | Done    |
| 4 | Pydantic request/response schemas   | Done    |
| 5 | Signup endpoint                     | Done    |
| 6 | Login endpoint                      | Done    |
| 7 | Token-verification dependency       | Done    |
| 8 | Smoke test + wiring `main.py`       | Done (folded into 5-7 — see Stage 7's note) |
| 9 | Company signup (decision 4)          | Reverted — see note |
| — | Frontend wiring (applicant only)      | Done — see the note below the table |

## Stage 1 — Password hashing utility (done)

**What:** `app/security.py` — `hash_password()`, `verify_password()`,
`needs_rehash()`, wrapping `argon2-cffi`'s `PasswordHasher`.

**Why argon2 over bcrypt/passlib:** argon2id is the current OWASP-recommended
default, and `argon2-cffi` exposes salt generation, hashing, verification and
rehash-detection through three functions — no reason to add `passlib` as a
second layer over it. `needs_rehash()` exists so that if the hasher's cost
parameters are ever tuned up, an existing hash can be transparently upgraded
on the user's next successful login instead of forcing a mass reset.

**Command run:** `uv add argon2-cffi`

**Verify:** `uv run python app/security.py` — a self-check ( round-trips a
hash, confirms the right password verifies and a wrong one is rejected).

**Notes for next stage:** Nothing here decides token format or storage —
Stage 2 is a separate decision.

## Stage 2 — Session/token strategy (done)

**Decision:** opaque token, stored in a new `sessions` table, carried in an
httpOnly cookie. Not a JWT — revocation (logout, "log out everywhere") is a
`DELETE` on this table instead of needing a blocklist, and there's no
signing-key rotation to manage.

**What:**
- `app/models/sessions.py` — `Session`: `id`, `token_hash` (unique,
  `String(64)` — a SHA-256 hex digest, not the token itself), nullable
  `applicant_id` / `company_membership_id` (exactly one set, mirroring
  `Profile`'s own split — there's still no shared identity table), and
  `expires_at`. Registered in `app/models/__init__.py`.
- `app/security.py` gained `SESSION_TTL` (30 days, fixed — no "remember me"
  control exists to read a shorter/longer value from),
  `generate_session_token()` (256-bit random value, via `secrets`), and
  `hash_session_token()` (SHA-256, not argon2 — argon2's slowness defends a
  *guessable* password; a 256-bit random token has nothing to guess, so a
  slow KDF here would only add latency to every authenticated request).

**Why the split (token vs. hash) at all:** the raw token is the only thing
that authenticates a request, so it must never be persisted anywhere it could
leak from a read-only DB compromise — same reasoning as password hashing, cheaper
primitive because the input is already high-entropy.

**Verify:** `uv run python app/security.py` (token generation/hash checks
added to the same self-check) and a model-wiring check — both passed.
`uv run alembic check` correctly reports `sessions` as new, expected pending
schema (nothing applied to the DB yet).

**Important gap found for Stage 3:** Alembic's autogenerate does not detect
or emit `CHECK` constraints at all — the "exactly one of applicant_id /
company_membership_id" rule exists in the SQLAlchemy model but will not
appear in the generated migration diff. It has to be hand-added with
`op.create_check_constraint()`, or it silently will not exist in the
database despite being in the model — the same category of gap as the
`use_alter` FK bug from the rolled-back migration.

## Stage 3 — First Alembic migration (done)

**Revision:** `0fa8dcca3a06`, message "add auth tables", `down_revision: None`
(the first migration). File: `alembic/versions/0fa8dcca3a06_add_auth_tables.py`.

**What it creates:** `applicant_profiles`, `company_profiles`,
`company_memberships`, `resumes`, `sessions` — the full schema as it stands
today, all in one migration since the database started empty.

**Three hand-fixes over the raw autogenerate output, in order found:**

1. **The `use_alter` FK.** `applicant_profiles.default_resume_id -> resumes.id`
   is `use_alter=True` on the model to break the applicant_profiles<->resumes
   circular dependency. Autogenerate rendered it inline inside
   `op.create_table('applicant_profiles', ...)`, which — confirmed against a
   live DB — silently compiles away to nothing. Fixed by removing it from the
   inline table definition and adding a separate `op.create_foreign_key(...)`
   call after `resumes` exists, with a matching `op.drop_constraint(...)`
   ordered before `resumes` is dropped in `downgrade()`.
2. **The `sessions` CHECK constraint — turned out fine, correcting an earlier
   note.** Stage 2's log said autogenerate never emits `CHECK` constraints;
   that's wrong in general. It's only true for *diffing an existing table*.
   For a brand-new table, the whole `CheckConstraint` is captured as part of
   `add_table` — it rendered correctly the first time, no fix needed.
3. **Orphaned ENUM types, found when the first `alembic upgrade head` attempt
   failed** with `type "company_size_range" already exists`. Root cause:
   `op.drop_table('name')` only knows the table name, not its columns, so
   the earlier rollback (see the note above Stage 1) dropped the four tables
   but left their Postgres ENUM types (`company_size_range`, `company_role`,
   `profile_status`, `resumestatus`) behind. Fixed with `IF EXISTS` guards at
   the top of `upgrade()`, and the matching `DROP TYPE` calls added to the
   *end* of `downgrade()` too — otherwise downgrading this migration would
   reproduce the same trap for the next person who upgrades again.

**Verification performed (against the live DB, not just exit codes):**
- `pg_constraint` query confirmed both FKs on `applicant_profiles` and both
  on `sessions`, plus the `sessions_exactly_one_account` CHECK, all present.
- **Actually inserted rows** to prove the CHECK constraint is enforced, not
  just declared: both-NULL rejected, both-set rejected, exactly-one-set
  succeeded — each in a nested transaction, with the whole test transaction
  rolled back afterward so no data was left in any table.
- `uv run alembic check` → `No new upgrade operations detected.`
- `uv run alembic current` → `0fa8dcca3a06 (head)`.

**Not yet done:** the migration file is untracked in git, same as everything
else from this implementation pass — committing is still your call.

## Stage 4 — Pydantic request/response schemas (done)

**What:** `app/schemas/auth.py` (new package `app/schemas/`) —
- `AccountType` (`applicant`/`company`) — a wire-layer enum, deliberately
  not in `app/models/dto.py`, since it's never stored in a column, only read
  off a request. Values match `account-type-switcher.tsx`'s `TYPES` exactly.
- `SignupRequest` — `accountType`, `name` (aliased to `full_name`), `email`
  (`EmailStr`), `password` (`min_length=8`, a floor not a policy — no
  complexity rule exists to encode yet). No `confirmPassword` field: that's
  client-only per `signup/page.tsx`'s own docblock, never sent to the API.
- `LoginRequest` — `accountType`, `email`, `password`.
- `AuthenticatedAccount` — the response shape: `id`, `email`, `full_name`,
  `account_type`, `onboarding_completed` (bool, not the raw timestamp —
  whichever side of the NULL check it's on is all a caller needs),
  `company_id` (set only for a company account). `from_attributes=True` so
  it builds directly off an ORM row. **No `password_hash` field, anywhere.**

**Why the alias pattern (`Field(alias="accountType")`, `Field(alias="name")`):**
per `auth_methodology.md` Step 4 — field names follow the request body, not
the column. `populate_by_name=True` means both the wire name (`accountType`)
and the Python name (`account_type`) work for constructing one, verified
both ways.

**Dependency added:** `uv add email-validator` — required for Pydantic's
`EmailStr`; wasn't already pulled in transitively.

**Verify:** `uv run python app/schemas/auth.py` — validates real
frontend-shaped payloads, confirms a sub-8-char password is rejected, and
proves (not just asserts by field name) that `password_hash` cannot survive
`AuthenticatedAccount.model_validate(...)` even when built from an object
that has one, the way a real ORM row would. A separate check confirmed
`populate_by_name` works in both directions.

## Stage 5 — Signup endpoint (done)

**What:** `app/routers/auth.py` — `POST /auth/signup`, registered in
`app/main.py` via `app.include_router(auth_router)`. Applicant-only today:

- Builds an `Applicant_Profile` from the request, hashing the password with
  `hash_password()`, then `db.flush()`s (not commits) to assign its id and
  surface an email-uniqueness violation as an `IntegrityError` without ending
  the transaction.
- On that `IntegrityError`, rolls back and returns `409` — a clean response
  instead of a raw asyncpg error leaking through.
- On success, adds a `sessions` row via a new `_issue_session()` helper
  (returns the raw token, doesn't commit — the route's own commit covers
  profile + session atomically) and one `db.commit()` covers both rows
  together: no account is ever created without its first session, and no
  session is ever created for an account that didn't actually get made.
- Sets the session cookie (`SESSION_COOKIE_NAME`, new in `app/security.py`,
  `httponly`/`secure`/`samesite=lax`, `max_age` from `SESSION_TTL`) and
  returns `AuthenticatedAccount`, built explicitly field-by-field rather than
  via `model_validate(profile)` — matches the response schema's own docstring
  about how it expects to be built.

**Company signup returns `501`, on purpose.** `auth_methodology.md` §2
decision 4 is still open: `company_profiles.company_name` and
`company_memberships.company_id` are `NOT NULL` and no screen collects a
company name yet, so there is no valid row this endpoint could construct.
Rather than guess a placeholder or half-create an account, `accountType:
"company"` short-circuits to `501` with a message naming the gap. Revisit
this route, not just the schema, once decision 4 is resolved.

**Verify:** ran the dev server against the live DB (`uv run uvicorn
app.main:app`) and exercised all four paths with `curl`:
- Applicant signup → `201`, cookie set, response has no `password_hash`.
- Same email again → `409`, and confirmed via a direct query that only one
  `applicant_profiles` row exists for it.
- `accountType: "company"` → `501`.
- Sub-8-char password → `422` (Pydantic validation, unchanged from Stage 4).

Queried the DB directly to confirm the `applicant_profiles` row and its
linked `sessions` row (`sessions.applicant_id` pointing at the new profile,
`expires_at` ~30 days out) both exist, then deleted both test rows — nothing
from this verification pass was left in the database.

**Notes for next stage:** Stage 6 (login) can reuse `_issue_session()` as-is —
it takes either `applicant_id` or `company_membership_id` and doesn't care
how the caller got there. It currently has no caller for the
`company_membership_id` branch; that arrives with login, once a company
account can log in even though it can't sign up yet.

## Stage 6 — Login endpoint (done)

**What:** `POST /auth/login`, added to `app/routers/auth.py` alongside
signup. Unlike signup, login has no company-side gap — a
`company_memberships` row only needs to already *exist*, not be created by
this request — so both account types share one code path: pick
`Applicant_Profile` or `Company_Membership` by `body.account_type`, look the
row up by `email` (unique per table, per `auth_methodology.md` §2 decision
2), `verify_password()` against it, issue a session with `_issue_session()`
(the Stage 5 helper, unchanged — this is its first caller for the
`company_membership_id` branch), commit, set the cookie, return
`AuthenticatedAccount`.

**Same `401` message for "no such email" and "wrong password".** Telling
them apart lets an attacker enumerate registered addresses. Taken one step
further: when no row matches the email, the route still calls
`verify_password()` — against a new `DUMMY_PASSWORD_HASH` in
`app/security.py` (a real argon2 hash of a random value, computed once at
import time) — before raising, so a nonexistent email doesn't skip the
argon2 verify and respond measurably faster than a wrong password would.
Without that, timing alone would leak which emails are registered even
though the response bodies are identical.

**Rehash-on-login wired up.** `needs_rehash()` (Stage 1, never called until
now) runs after a successful `verify_password()` — the only point a
plaintext password is on hand — and updates `account.password_hash` in the
same transaction as the session insert if the current hasher's cost
parameters have moved past what the stored hash used.

**Verify:** ran the dev server against the live DB and exercised, all via
`curl`:
- Signup an applicant, then log in with the right password → `200`, cookie
  set, body matches signup's shape.
- Same account, wrong password → `401`, generic message.
- An email that was never registered → `401`, byte-identical message.
- Right applicant email/password but `accountType: "company"` → `401` (looks
  up the wrong table, finds nothing, same generic response).
- Hand-seeded a `company_profiles` + `company_memberships` row directly (no
  signup path exists for company yet — expected, see Stage 5) and logged in
  against it → `200`, `account_type: "company"`, `company_id` populated from
  the membership's `company_id`.

Deleted every row created or seeded during this pass (both applicant and
company sides, plus their session rows) after confirming each check — nothing
left in the database.

**Notes for next stage:** Stage 7 (token-verification dependency) reads
`SESSION_COOKIE_NAME` off the request, hashes it with `hash_session_token()`,
and looks up `sessions` by `token_hash` — the cookie-setting half already
exists on both routes above, so Stage 7 only has to write the reverse
direction and check `expires_at`.

## Stage 7 — Token-verification dependency (done)

**What:** `app/deps.py` (new file) — `get_current_account(request, db)`,
a FastAPI dependency. Reads `SESSION_COOKIE_NAME` off `request.cookies`,
hashes it with `hash_session_token()`, looks the hash up in `sessions`, and
returns an `AuthenticatedAccount` built from whichever account the session
points at. Every branch that fails — no cookie, no matching row, an expired
row, or (unreachable in practice, given the CASCADE) a session with no
account behind it — raises the same `401 Not authenticated.`, since none of
those distinctions are the caller's business.

**A separate module from `app/routers/auth.py` on purpose:** every future
router (jobs, applications, ...) will depend on this, and importing it
shouldn't also import auth's route registrations. `backend/CLAUDE.md`'s "one
place, used by every protected route" is the reason this isn't a helper
inlined into one router file.

**Expired sessions are deleted on the lookup that finds them**, not just
rejected — so an expired row doesn't sit in the table waiting to make the
next request re-derive the same "expired" conclusion. Confirmed by querying
for the row after a rejected request and finding it gone.

**`GET /auth/me` added to `app/routers/auth.py`** as this dependency's first
real consumer — `Depends(get_current_account)`, returns the account as-is.
Doubles as what a frontend will call on page load to ask "is there a valid
session, and whose is it," which the frontend-wiring notes below assume
exists.

**Verify:** ran the dev server against the live DB and exercised, via
`curl`:
- `/auth/me` with no cookie → `401`.
- `/auth/me` with a garbage cookie value → `401` (hash lookup finds nothing,
  same branch as "no cookie" from the caller's perspective).
- Signup, then `/auth/me` with the cookie jar curl saved from that response
  → `200`, body matches what signup returned.
- Hand-inserted a `sessions` row with `expires_at` one day in the past,
  requested `/auth/me` with its token → `401`, then queried `sessions`
  directly by that token's hash and confirmed the row no longer exists.

Deleted the test applicant profile and its sessions afterward — nothing left
in the database.

**This closes out the backend half of auth.** Stage 8 (smoke test + wiring
`main.py`) was folded into Stages 5-7 as they landed — each route was
verified against the live DB over real HTTP as it was written, and
`main.py` has had `app.include_router(auth_router)` since Stage 5 — so there
is no separate Stage 8 left to do.

What's left is connecting `/auth/signup`, `/auth/login` and `/auth/me` to
the actual `/signup` and `/login` screens in `frontend/`. That's frontend
work, not a ninth backend stage, and it isn't just plumbing — `backend/
CLAUDE.md`'s "still open" list includes *how the token travels*, and this is
where that decision actually has to be made. See `auth_methodology.md`
Step 5 for the constraints, and whoever picks this up should record the
decision there once it's made.

## Stage 9 — Company signup, closing `auth_methodology.md` §2 decision 4 (reverted)

**Reverted 2026-09-21, same day it shipped.** Not a technical failure — it
worked, and was verified against the live DB exactly as described below.
Reverted at the product level: there is nowhere for a new company account to
land, since `frontend/src/app/onboarding/company/page.tsx` is still a stub,
so shipping the signup half alone would let someone create a company account
and then hit a placeholder screen. `signup/actions.ts`, `signup-form.tsx`,
`app/routers/auth.py` and `app/schemas/auth.py` are all back to their
pre-Stage-9 shape (`accountType: "company"` returns `501` again, same
message as Stage 5). This section is kept as a record of what the real
blocker turned out to be and how it was solved, for whoever revisits
`auth_methodology.md` §2 decision 4 once `onboarding/company` exists —
**the code below no longer exists in the tree.**

**What changed:** Stage 5 shipped signup with `accountType: "company"`
returning `501`, because `signup` collected no company name and
`company_profiles.company_name` / `company_memberships.company_id` are both
`NOT NULL`. Wiring the frontend surfaced that this was one field short of
the real blocker: `company_profiles.size_range` is *also* `NOT NULL` with no
default, and nothing had ever added it to the gap list in
`auth_methodology.md` §1's table. Both are now required, alongside the
existing fields, for `accountType: "company"`.

- `app/schemas/auth.py`'s `SignupRequest` gained `company_name` (alias
  `companyName`) and `company_size` (alias `companySize`, typed as
  `app/models/dto.py`'s `company_size_range` — the stored enum, not a
  wire-only duplicate, since this value ends up in a column). Both
  `Optional`, `None` for an applicant.
- `app/routers/auth.py`'s single `if account_type is COMPANY: raise 501`
  became two helpers, `_signup_applicant()` and `_signup_company()`, called
  from a thinner `signup()`. `_signup_company()`:
  - 422s if `company_name` or `company_size` is missing (belt-and-suspenders
    over the frontend's own `required` attributes).
  - Creates `Company_Profile` (`contact_email` reuses the signing user's own
    email — no separate field collects one) then `Company_Membership`
    (`role=company_role.owner` always, `status=profile_status.active`,
    `headline=""` — `Company_Membership.headline` is `NOT NULL` with no
    `Optional`, unlike the applicant side's nullable one, and nothing
    collects it; empty string is the same "unset" reading NULL gets there,
    not a guessed value).
  - Both inserts, plus the session, are one transaction via `db.flush()`
    twice then a single `db.commit()` in `signup()` — a company and a
    membership with no company behind it are never possible, matching the
    applicant path's own atomicity.
- `app/models/CLAUDE.md`'s "Enums store .name, not .value" applies here
  directly: the wire value is `"1_50"` (matches the enum's *value*), and
  what lands in Postgres is `ONE_TO_FIFTY` (the enum's *name*) — verified
  directly against the live DB, not just asserted.

**Verify:** ran the dev server against the live DB and exercised, via
`curl`:
- `accountType: "company"` with no `companyName`/`companySize` → `422`.
- Full company payload → `201`, cookie set, `company_id` populated.
- `/auth/me` with that cookie → `200`, matches the signup response.
- Same email again → `409` ("A company is already registered with this
  email" — the `company_profiles.contact_email` conflict, distinct from the
  `company_memberships.email` conflict message, since either could fire
  first depending on which row's flush hits the constraint).
- Login with the same company credentials → `200`, same account id.
- Queried `company_profiles`/`company_memberships` directly: `role='owner'`,
  `status='active'`, `headline=''`, and `size_range::text` read back as
  `ONE_TO_FIFTY` in raw SQL (not just through the ORM's own enum coercion).

Deleted the membership, its company, and its sessions afterward — nothing
left in the database.

**One reason to remember, even reverted:** while this was in place,
`app/schemas/auth.py` imported `app.models.dto` and could no longer run as a
bare script (`uv run python app/schemas/auth.py` failed with
`ModuleNotFoundError: No module named 'app'` — `sys.path[0]` is the script's
own directory, not `backend/`; `uv run python -m app.schemas.auth` was the
fix). The import is gone now along with the rest of this stage, so the
bare-script form works again — but the next thing that adds an `app.*`
import to a script meant to be run directly will hit the same failure, and
`-m` is the fix again.

## Frontend wiring — applicant accounts (done)

Not a backend stage, but the reason Stage 9 was attempted: connecting
`/auth/signup`, `/auth/login` and `/auth/me` to the real `/signup` and
`/login` screens, resolving `backend/CLAUDE.md`'s "how the token travels"
question along the way. Applicant-only, deliberately — see Stage 9's note
for why the company half was built, verified, and then reverted the same
day rather than kept. Full detail lives in `frontend/CLAUDE.md`'s Auth
section (the design) and this note (what shipped and stayed):

- **Token transport:** Server Actions call the API server-side
  (`frontend/src/lib/auth.ts`'s `apiFetch`) — no CORS needed on the API,
  since the browser never talks to it directly. The API's `Set-Cookie`
  doesn't reach the browser on its own from a server-to-server `fetch`, so
  `relaySessionCookie()` reads the token off the response and re-sets it as
  Next's own cookie.
- **`signup/actions.ts` and `login/actions.ts`** call the real endpoints,
  relay the cookie, and redirect off the actual response
  (`account_type`/`onboarding_completed`) instead of the raw submitted form
  field. Both split their interactive fields into a small Client Component
  (`signup-form.tsx`, `login-form.tsx`) so `useActionState` can show a
  rejected request's message inline (`text-danger`, matching
  `company/jobs/new/composer.tsx`'s existing pattern) instead of failing
  silently, which is what the original stubs did. A company submission
  still reaches `/auth/signup` and still gets a message shown this same
  way — it's just the API's `501` again, not a special case in this file.
- `AccountTypeSwitcher` is back to `page.tsx` rendering it as a
  server-rendered sibling of `SignupForm`, same as `login` — the
  `onValueChange` callback and the company-only fields it enabled
  (`signup-form.tsx` owning the switcher to conditionally show
  `companyName`/`companySize`) were part of Stage 9 and reverted with it.
- Verified end to end for the applicant path (no browser tool was available
  this session — Claude in Chrome was declined): backend contract checks in
  Stages 5-7's own curl runs, a Node script exercising the exact
  request/response shapes `lib/auth.ts` and both actions send — cookie
  extraction, error-message extraction for `409`/`422` — against the live
  backend, and `npm run typecheck`/`lint`/`format:check` all clean. The
  actual click-through (submitting, watching the redirect and cookie in a
  real browser) was done by the user, not this session, and confirmed
  working before Stage 9 was attempted.
