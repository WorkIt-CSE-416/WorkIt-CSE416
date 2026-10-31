/**
 * When GET /api/session/refresh rotates the session. The extension asks for
 * a refresh two minutes before its access token expires
 * (autofiller_extension/src/background/auth.js); a minute more covers the
 * clock difference between the student's machine and the server. Earlier
 * than that the route leaves the session alone, so a stray call never
 * spends a refresh token.
 */
export const ROTATE_WITHIN_S = 3 * 60;

/** Whether a session expiring at `expiresAt` (Unix seconds) is due for rotation at `nowMs`. */
export function needsRotation(expiresAt: number | undefined, nowMs: number): boolean {
  return expiresAt === undefined || expiresAt - nowMs / 1000 <= ROTATE_WITHIN_S;
}
