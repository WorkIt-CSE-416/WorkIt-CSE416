# Auth — design

How sign-up, sign-in and token verification work, and why. The rules every
change must keep are in `../backend/CLAUDE.md`'s Auth section; this note is the
flow and the reasoning behind it. Code is the source of truth:
`backend/app/routers/auth.py`, `backend/app/security.py`, `backend/app/deps.py`.

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
                                              │ (Turnstile verified server-side
                                              │ before creating the user)
         redirect to /signup/check-email  (user clicks email confirm link)
         /auth/confirm ──verifyOtp(signup)──▶ Supabase Auth
         redirect to /login

login    Turnstile verified in Next server action
         Next action ──signInWithPassword──▶ Supabase Auth  (sets sb-* cookies)
         Next action ──GET /auth/me, Bearer──▶ FastAPI  (role check, redirect)

reset    /login/reset-password ──resetPasswordForEmail──▶ Supabase Auth (email)
         /auth/confirm ──verifyOtp(recovery)──▶ Supabase Auth (session set)
         /login/new-password ──updateUser({password})──▶ Supabase Auth

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
- **Signup requires email verification** (KAN-293). The API creates the user
  without `email_confirm`, then asks Supabase to send the confirmation email
  (`auth.resend`), since the admin `create_user` sends none. The frontend
  redirects to `/signup/check-email`. The confirm link lands on
  `/auth/confirm`, which signs the user in and redirects to `/login` (and
  from there home).
- **A taken email returns 201 silently** (KAN-293). Signup for an address
  that already has an account returns the same 201 response with a dummy id
  and no profile row. The frontend always redirects to check-email, so an
  attacker cannot tell whether the address is registered.
- **Company signup is gated** (KAN-293). Both `signup()` and
  `complete_oauth_account_type()` reject `AccountType.COMPANY` with 403
  until the business side ships.

## Supabase dashboard settings (live nowhere in code)

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
- **Email (KAN-293)**: Providers → Email → "Confirm email" ON; a custom SMTP
  provider (the built-in one sends a handful an hour); Attack Protection's
  CAPTCHA OFF (the app checks Turnstile itself); each origin's
  `/auth/confirm` in URL Configuration's redirect list.
- **Email templates (KAN-293)**, as Supabase's SSR guide gives them, so a
  link works in any browser: "Confirm signup" links to
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` and
  "Reset Password" to
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
  With the default templates the links still work, through `?code=`
  (`/auth/confirm` takes both), but a reset link then opens only in the
  browser that asked for it, and a signup link lands on the Site URL.

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

## Claude's sign-in to WorkIt (the connector, KAN-377)

Here WorkIt is the OAuth **server**: a student's Claude signs in to WorkIt
to reach the connector at `<api>/mcp`. The API serves the OAuth endpoints
(`backend/app/connector/oauth.py`; `auto-apply/architecture.md` 14.6), and
the student approves on the webapp's `/connect/claude` with their normal
Supabase session. Signed out, the page sends them to `/login?next=...`,
and a password sign-in comes back to it; `next` is honoured for that page
only, so the link can't send anyone elsewhere. A Google or LinkedIn
sign-in started there lands on the account's home instead (not carried
through `/auth/callback` yet); the student opens Claude's link again.

The student disconnects from WorkIt, not only from Claude: My Profile's
Disconnect calls `DELETE /applicants/{id}/connector`, which deletes every
access and refresh token given for them (every client) and any sign-in
they allowed whose code wasn't traded, so the next `/mcp` call is a 401
and a refresh fails. Removing the connector in Claude alone leaves
WorkIt's tokens alive until they expire.

## Identity

- **One email, one account.** A person cannot have both an applicant and a
  company account on one email. Signup for a taken address is a 409 whichever
  type is asked for; login for the wrong type is rejected by the frontend
  after `/me`.
- **The profile id is the `auth.users` id**, with `ON DELETE CASCADE` and no
  default: deleting a user in the dashboard deletes their profile, and a
  profile cannot exist without an auth user.
- **`email` on the profile tables is a copy** for display and queries.
  Supabase's is the real one. Settings' Change Email changes Supabase's,
  and the API copies it onto the row on the account's next request
  (`get_current_account` in `backend/app/deps.py`).

## Settings: sign-in, password and account deletion (KAN-326)

Every action is in `frontend/src/lib/account-actions.ts`.

- **Change Password checks the current password first**, by signing in with
  it, then calls `updateUser()`. A session left open on a shared computer
  then cannot change the password and lock its owner out. The fresh sign-in
  also meets Supabase's "recent sign-in" rule for a password change if that
  setting is turned on. The server decides whether to ask, from the
  account's identities (`getSignInProviders`, Supabase's identity list),
  never from what the form sends.
- **Set Password** is the same action for an account with no `email`
  identity (Google or LinkedIn only): there is no current password to
  check. Setting one does not add an `email` identity, so the row keeps
  reading "Not set" and the form keeps not asking for a current password.
  That is the gap: an open Google-only session can set a password. **Still
  open:** tell a set password apart (Supabase exposes no flag for it).
- **Change Email** calls `updateUser({ email })` with a redirect back to
  Settings. Supabase emails a confirm link (`mailer_autoconfirm` is off on
  the project), and with "Secure email change" on a second link goes to the
  old address; the change applies once the links are opened. The callback
  turns the first of the two (it carries a `message` and no `code`) into a
  notice that the other is still to open.
- **Connect and Disconnect Google or LinkedIn** are `linkIdentity()` and
  `unlinkIdentity()`. **Linking needs "Manual linking" on in the Supabase
  dashboard** (Authentication, Sign In / Up); off, Supabase refuses with
  `manual_linking_disabled` and the row says linking is turned off.
  Disconnect is refused for the account's last identity, so nobody unlinks
  their only way back in.
- **The callback's `?next=`** (`frontend/src/app/auth/callback/route.ts`)
  brings a link or a confirm email back to Settings instead of the
  account's home. Only a path under `/settings/` is followed, so the
  parameter cannot send anyone off the site.
- **Delete Account is `DELETE /auth/me`**: Storage files first, then the auth
  user through the admin API, whose cascade removes every row. Both steps
  can run again, so a retry finishes a failed delete. The route depends on
  `get_verified_identity`, so a retry whose first try did delete the
  account gets a 204, not a 401. Supabase ends the user's sessions with the
  user; the Next action then clears the cookies with a local sign-out (a
  global one would fail on the revoked session).

## Turnstile bot protection (KAN-293)

Cloudflare Turnstile (Managed mode) on password signup and password sign-in.
Not on OAuth, which has its own challenge.

- **Signup**: the frontend sends `captchaToken` in the request body. The API
  verifies it server-side against `TURNSTILE_SECRET_KEY` before creating the
  user. When the secret is unset (local dev), verification is skipped.
- **Sign-in**: the Next server action verifies the token server-side (POST to
  Turnstile `/siteverify`) before calling `signInWithPassword`. The secret
  is `TURNSTILE_SECRET_KEY` in the frontend's env.
- **The widget** (`frontend/src/components/turnstile.tsx`) loads the Turnstile
  script via `next/script` with `render=explicit`, renders a `<div>`, and
  Turnstile fills its hidden `cf-turnstile-response` input. When
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset, the component renders nothing.

## Password reset (KAN-293)

- `/login/reset-password`: email input, calls `resetPasswordForEmail` with a
  redirect to `/auth/confirm`. Always shows "Check your email" — never
  reveals whether the address is registered.
- `/auth/confirm?type=recovery`: verifies the OTP, sets a session, redirects
  to `/login/new-password`.
- `/login/new-password`: new password form, calls `updateUser({ password })`,
  redirects to Home (`/home`).

## Secure cookie flag (KAN-293)

`sessionCookieOptions` in `frontend/src/lib/supabase/cookies.ts` sets
`secure: process.env.NODE_ENV === "production"`, so sb-* cookies are
Secure in production and plain HTTP in local dev.

## Accepted risks (KAN-293)

- **Per-IP rate limiting**: not implemented. Turnstile is the bot protection
  for now. Per-IP limiting is a follow-up after the Cloudflare cutover, where
  Cloudflare's own rate limiting can be used.
- **OAuth account linking with email identity**: Supabase's "Automatic linking"
  is on. A password signup for an email that later uses Google sign-in links
  both. With email verification on, an attacker cannot register someone
  else's email first, because the real owner's address is never confirmed
  for the attacker.
