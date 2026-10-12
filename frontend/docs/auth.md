# Sign-in on the Next side

How password sign-in, signup and Google/LinkedIn OAuth run through this app.
The rules (token handling, cookies, what never goes here) stay in
`frontend/CLAUDE.md`; the flow and its rules on the API side are in
`backend/CLAUDE.md`'s Auth section. Read both before changing a sign-in,
signup or OAuth path.

- `login/actions.ts` calls `supabase.auth.signInWithPassword()`, then
  `GET /auth/me` with the new access token to learn the account type and
  onboarding state, and redirects off that: an applicant to
  `/onboarding/applicant` until onboarded and `/dashboard` after, a company
  account always to `/company`. **Skipped for now (KAN-141):** the applicant
  onboarding check is commented out in both `login/actions.ts` and
  `signup/actions.ts`. A new applicant (signup, or a first Google/LinkedIn
  sign-in through `/signup/choose-account-type`) goes straight to `/profile`
  in onboarding's place; a returning one (login, or a returning OAuth sign-in
  in `auth/callback/route.ts`) lands on `/dashboard`, the seeker's home. The
  API still reports `onboarding_completed` and the onboarding screen still
  works by URL; uncomment those blocks to turn it back on. Companies skip the onboarding check because
  nothing sets their `onboarding_completed_at` yet, so it would send every
  company login to the `/onboarding/company` stub — restore it when company
  onboarding is built. If the account type doesn't match the tab the user
  signed in on, it signs out again and shows the wrong-password message.
- `signup/actions.ts` calls `POST /auth/signup` — **not**
  `supabase.auth.signUp()`, which can only write `user_metadata`, a field the
  user can edit, so it cannot be trusted with the account type — and then
  signs in. The Company tab opens on Create Company; Join a Company is shown
  disabled with a Soon badge until it has a form (`signup/signup-form.tsx`).
  Create Company sends the owner's fields plus a
  nested `company` object (name, websiteUrl, contactEmail, contactPhone,
  sizeRange — a `company_size_range` value from `backend/app/models/dto.py`),
  sent only when `accountType` is `company`. The API creates the company and
  the owner's membership, and the action then redirects an applicant to
  onboarding and a company to `/company`. Join a Company has no form yet.
- **A key the API's Pydantic schema doesn't declare is dropped silently**
  (the default `extra="ignore"`), not rejected. A field added to a request
  body here does nothing until `backend/app/schemas/` declares it too.
- `src/proxy.ts` refreshes the session on every request. @supabase/ssr
  requires it: Server Components cannot write cookies, so without it sessions
  die when the hour-long access token does. It does nothing when the Supabase
  variables are unset, which keeps a clone with no env file booting.
- **Google and LinkedIn sign-in** go through Supabase's native OAuth
  providers (`google`, `linkedin_oidc` — backend/CLAUDE.md's Auth section has
  the dashboard setup). `src/lib/oauth-actions.ts`'s `signInWithOAuth` server
  action, bound to each provider, backs the Google/LinkedIn buttons on both
  `/login` and `/signup` (one shared row, `components/auth-alternatives.tsx`,
  so the two cards cannot drift apart); it calls Supabase's own `signInWithOAuth()` with
  `skipBrowserRedirect: true` and redirects to the URL it returns, since a
  Server Action can't navigate the browser itself. The provider sends the
  browser back to `src/app/auth/callback/route.ts`, which exchanges the code
  for a session, then calls `GET /auth/oauth/status`: Supabase creates
  `auth.users` itself for an OAuth sign-in, bypassing `POST /auth/signup`
  entirely, so a first-time sign-in has no `account_type` and no profile row
  yet. That sends it to `/signup/choose-account-type` — the same
  `AccountTypeSwitcher` as `/login` and `/signup`, plus `CompanyFields`
  (promoted out of `signup-form.tsx`, its second consumer) when the choice is
  Company — whose `actions.ts` calls `POST /auth/oauth/account-type` and then
  `supabase.auth.refreshSession()`, because the access token already in hand
  was issued before that endpoint set `account_type` and won't carry it until
  refreshed. An already-completed identity gets `needs_account_type: false`
  and goes straight to the same destination a password sign-in would.
  **The Google button sends `queryParams: { prompt: "select_account" }`.**
  Without it, a Google account Google itself rejects (unverified app,
  not a test user — decided entirely on Google's side, before any redirect
  back here) looks stuck on retry: Google silently reuses the browser's
  last-picked account and shows the same "Access blocked" page again. The
  prompt forces the account chooser open every attempt, so a blocked try can
  retry with a different account instead of repeating the same dead end.
  LinkedIn's OIDC prompt support isn't the same, so this stays Google-only.

**Cookie lifetime.** The `sb-*` cookies are httpOnly and live 7 days
(`lib/supabase/cookies.ts`, since 2026-10-08; the @supabase/ssr default is
readable by page scripts and 400 days). The 7 days count from the last token
refresh, so they are an idle limit, not a cap on how long a session lasts; a
hard cap is Supabase's session time-box (dashboard → Authentication →
Sessions). `lib/supabase/server.ts` is the per-request Supabase client, for
auth only, never data.
