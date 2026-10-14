# WorkIt Autofiller (prototype)

A Chrome extension that fills job applications from your WorkIt profile and
resume. Prototype stage — see `CLAUDE.md` for how it's built and what's
still open.

## Load it

1. Have the backend running (`uv run uvicorn app.main:app --reload`, from
   `backend/` — see the root `CLAUDE.md`). The extension tries
   `http://localhost:8000` first and falls back to the deployed API if
   that's unreachable.
2. Chrome → `chrome://extensions` → enable **Developer mode** (top right).
3. **Load unpacked** → select this `autofiller_extension/` folder.
4. Sign in to WorkIt itself (`localhost:3000` or the deployed site) in a
   regular browser tab — any method (password, Google, LinkedIn). The
   extension has no sign-in of its own; it reads that session's cookie
   (`CLAUDE.md`'s Auth section has the details).
5. Click the extension's icon in the toolbar — it should show your name
   and email. If it instead says to sign in, click **I Signed In — Check
   Again** after step 4, or confirm you're actually signed in on
   `localhost:3000` (not just the deployed site, or vice versa).
6. Open a job application page, click the icon again, then
   **Autofill This Page**.

It never submits anything — review the filled form and click the site's
own Submit button yourself.

## Reload after an edit

Chrome doesn't pick up changes to an unpacked extension automatically:
`chrome://extensions` → the extension's reload icon. A content-script file
edit also needs the page itself reloaded, since the files were already
injected into it.
