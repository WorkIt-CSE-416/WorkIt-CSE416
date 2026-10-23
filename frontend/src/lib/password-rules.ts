// A UX check only — it saves a round trip, it doesn't enforce anything. The
// same floor of 8 is enforced by backend/app/schemas/auth.py's
// SignupRequest.password (a direct API call) and by the Supabase project's
// minimum password length (anything reaching Supabase Auth with the public
// anon key, e.g. updateUser). Change all three together. Signup and
// Settings' Change Password both read it.
export const PASSWORD_MIN_LENGTH = 8;
