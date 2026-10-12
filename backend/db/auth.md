# Auth — design

How sign-up, sign-in and token verification work, and why. The rules every
change must keep are in `../CLAUDE.md`'s Auth section; this note is the flow
and the reasoning behind it. Code is the source of truth: `app/routers/auth.py`,
`app/security.py`, `app/deps.py`.

## Why Supabase Auth (decided 2026-09-24)

Supabase Auth stores the password hash in `auth.users`, issues the
access/refresh token pair, and refreshes it. This API never hashes a password
and never signs a token. It replaced a working FastAPI implementation (Argon2id
hashes on the account tables, HS256 JWTs in a `session_token` cookie); that
code is in git history if it is ever needed again.

Email verification, password reset, magic links and OAuth providers come with
Supabase Auth; each would otherwise be ours to build. The cost is a second
service in the sign-in path (a Supabase Auth outage is a sign-in outage) and
one account per email.

## The flow

```
signup   Next action ──POST /auth/signup──▶ FastAPI ──admin API──▶ Supabase Auth
                                              │ creates auth.users row with
                                              │ app_metadata.account_type,
                                              │ then the profile row, same id
                                              │ (company: the company row and
                                              │ its owner's membership)
         Next action ──signInWithPassword──▶ Supabase Auth  (sets sb-* cookies)

login    Next action ──signInWithPassword──▶ Supabase Auth  (sets sb-* cookies)
         Next action ──GET /auth/me, Bearer──▶ FastAPI  (role check, redirect)

request  Browser ──sb-* cookie──▶ Next (src/proxy.ts refreshes the session)
         Server code ──Authorization: Bearer <access token>──▶ FastAPI
```

- **Signup goes through this API, not `supabase.auth.signUp()`.** The account
  type must land in `app_metadata`, which only the service-role key can write.
  `signUp()` can only set `user_metadata`, which the user can edit; trusting
  it would let anyone make themselves a company account. Going through here
  also creates the profile row in the same request.
- **The auth user comes first, the rows second.** The profile id *is* the
  `auth.users` id and a foreign key to it. Everything from the first
  `db.add()` to the commit sits in one `try` whose `except` deletes that auth
  user. A flush left outside it would fail on a constraint and leave an auth
  user with no profile, whose email then 409s on every retry and signs in to
  nothing.
- **Create Company writes two rows in one transaction**: the
  `company_profiles` row, and a `company_memberships` row for the person
  signing up (role `owner`, status `active`). `SignupRequest`'s model
  validator requires the nested `company` object for a company and rejects it
  for an applicant, so the route never checks.
- **Login** is checked by Supabase Auth; the Next action then calls `/auth/me`
  for the account type and onboarding state.
- **Signup creates the user already confirmed** (`email_confirm=True`).
  Turning on email verification means dropping that flag and adding a
  confirmation route on the frontend.

## Dashboard settings (live nowhere in code)

The anon key and project URL ship to the browser, so anyone can call Supabase
Auth directly. Set these on any new Supabase project:

- **Minimum password length 8**, matching `SignupRequest.password` and the
  form's `PASSWORD_MIN_LENGTH`, so a signed-in user can't `updateUser()` to a
  shorter one.
- **Authentication → "Allow new users to sign up" ON.** Turning it off was the
  original plan, to force account creation through this API. But GoTrue
  applies that switch to every path that creates an `auth.users` row, OAuth
  included: off, a first-time Google/LinkedIn sign-in fails with
  `access_denied` / `signup_disabled` before reaching this API. It guards
  nothing anyway: `/auth/oauth/account-type` lets any type-less identity
  self-report its type, at the same trust as the signup form, and a type-less
  account can do nothing protected (`get_current_account` 401s it).
- **OAuth providers** (Authentication → Providers): Client ID/Secret from
  Google Cloud Console for `google`, and from a LinkedIn Developer app with
  "Sign In with LinkedIn using OpenID Connect" for `linkedin_oidc` (the older
  `linkedin` provider is deprecated).

## How a token is verified

`get_current_account` (`app/deps.py`) reads `Authorization: Bearer`, never a
cookie: Supabase's cookies belong to the Next origin, and are chunked and
base64-encoded besides. Then:

1. Verifies the signature against the public JWKS at
   `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, cached by `PyJWKClient`
   (no network call per request). Only ES256/RS256. The legacy shared-secret
   HS256 scheme is deliberately unsupported: that secret can mint tokens, so
   holding it here would let a leak forge any user. If the project is ever
   switched back to it, sign-in 401s; switch it back to signing keys (Project
   Settings → JWT Keys) rather than adding the secret. `JWT_SECRET` and
   `SUPABASE_JWT_SECRET` are gone for this reason.
2. Checks `aud == "authenticated"`, the issuer, and expiry.
3. Reads `sub` (the `auth.users` id, which is the profile's primary key) and
   `app_metadata.account_type`, then loads the profile row. `company_id` and
   onboarding state come from that row, never from the token.

## OAuth (Google, LinkedIn)

Supabase's native `google` and `linkedin_oidc` providers, plus a "Choose
Account Type" step. `signInWithOAuth()` lets Supabase create the `auth.users`
row itself, never through this API, so `app_metadata.account_type` and the
profile row are both missing afterward.

`GET /auth/oauth/status` and `POST /auth/oauth/account-type` close that gap.
Both sit behind `get_verified_identity` (`app/deps.py`), which verifies the
token without requiring a profile row. `/oauth/account-type` sets
`app_metadata.account_type` through the same admin API signup uses, then
creates the profile row; on failure it resets `account_type` to `None` rather
than deleting the auth user, since that user's Google/LinkedIn session is real
and did not originate here.

## Identity

- **One email, one account.** A person cannot have both an applicant and a
  company account on one email. Signup for a taken address is a 409 whichever
  type is asked for; login for the wrong type is rejected by the frontend
  after `/me`.
- **The profile id is the `auth.users` id**, with `ON DELETE CASCADE` and no
  default: deleting a user in the dashboard deletes their profile, and a
  profile cannot exist without an auth user.
- **`email` on the profile tables is a copy** for display and queries.
  Nothing changes an email yet; whatever does must update both.
