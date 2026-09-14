# WorkIt-CSE416

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

CSE 416 Final Project Group

By Xiang, Brian, Andrew, Lisul, Vedant

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack)
- TypeScript (strict)
- Tailwind CSS v4
- ESLint 9 + Prettier
- [Supabase](https://supabase.com) — hosted Postgres
- FastAPI + SQLAlchemy + Alembic (in `backend/`) — everything that touches the
  database

The frontend never queries Postgres itself; it calls the API for data. How
auth works — Supabase Auth or the API itself — is still being decided, so
nothing in `frontend/` assumes an answer yet. See
`frontend/docs/backend-integration.md`.

## Requirements

- **Node.js 20.9 or newer** (22 LTS recommended — see `.nvmrc`)
- npm 10+

Check with `node -v`. If you need to install or switch versions:

- **macOS / Linux:** [nvm](https://github.com/nvm-sh/nvm), then `nvm use` in this folder
- **Windows:** [nvm-windows](https://github.com/coreybutler/nvm-windows) or the [official installer](https://nodejs.org)

## Getting started

```bash
git clone https://github.com/WorkIt-CSE-416/WorkIt-CSE416.git
cd WorkIt-CSE416
npm run install:frontend
npm run dev
```

Open http://localhost:3000. Editing `frontend/src/app/page.tsx` hot-reloads the
page.

The app itself lives in `frontend/`, so you can also work from in there:

```bash
cd frontend
npm install
npm run dev
```

Install app dependencies in `frontend/` and Python dependencies in `backend/`.
The root `package.json` has no dependencies — it only forwards scripts.

You do not need `frontend/.env.local` to run the app — every screen renders
fixture data, so a fresh clone boots with no configuration at all. Copy
`frontend/.env.example` once you need a real Supabase session. Database
credentials do **not** go in that file; they belong to the Python service.

## Scripts

The frontend scripts below are cross-platform and run in macOS Terminal,
Windows PowerShell, and cmd.exe. They are defined in `frontend/package.json` and
mirrored at the repo root, so each one works from either folder.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload on port 3000 |
| `npm run build` | Production build |
| `npm start` | Serve the production build (run `build` first) |
| `npm run lint` | ESLint |
| `npm run lint:fix` | ESLint with autofix |
| `npm run typecheck` | Generate route types, then `tsc --noEmit` |
| `npm run format` | Format with Prettier |
| `npm run format:check` | Verify formatting without writing |
| `npm run clean` | Delete `.next`, `out`, `coverage`, build info |
| `npm run favicon` | Rebuild the favicon from `public/workit-icon.png` |
| `npm run install:frontend` | Install frontend dependencies (root only) |

Scraper scripts forward through `uv` and need it on PATH (`brew install uv`).
`scrape` and `scrape:dry` target the future CLI and are not runnable yet.

| Command | What it does |
| --- | --- |
| `npm run scrape` | Run the ingestion CLI (planned) |
| `npm run scrape:dry` | Fetch and normalize to local files, no database (planned) |
| `npm run scraper:lint` | Ruff |
| `npm run scraper:typecheck` | mypy |
| `npm run scraper:test` | pytest |
| `npm run install:scraper` | Install scraper dependencies (root only) |

## Project layout

The repo is split by tier: the Next.js app in `frontend/`, the Python API in
`backend/`, and job ingestion in `scraper/`. Each is self-contained, with its
own dependencies.

`scraper/` is a scaffold — its CLI, adapters, persistence, and tests are still
planned. Read the [architecture](docs/KAN-55_JOB_SCRAPER.md), its
[research appendix](docs/KAN-55_SCRAPER_RESEARCH.md), and the
[verification suite](docs/KAN-55_SCRAPER_VERIFICATION.md) for the plan. It
needs Python 3.12+ and uv; install its development tools with
`uv --directory scraper sync --extra dev` from the repository root.

```
frontend/         The Next.js app — its own package.json and node_modules
  src/app/        App Router routes, layouts, and pages
    layout.tsx    Root layout (fonts, metadata, <html>/<body>)
    page.tsx      Route "/"
    globals.css   Tailwind entry point and theme tokens
  src/components/ Shared components
  src/lib/        Framework-free helpers
    supabase/     Per-request session client; unused, and provisional
  public/         Static assets served from /
  scripts/        Maintenance scripts (plain Node, no shell)
  docs/           Prose docs for the team
    backend-integration.md  The frontend/API boundary and its open questions
backend/          The Python API — owns the database
  db/             Schema design notes
scraper/          Job ingestion — see scraper/CLAUDE.md
  workit_scraper/ The package: provider adapters, normalization, store
docs/             Scraper architecture, research appendix, verification suite
package.json      Scripts that forward into frontend/ and scraper/; no dependencies
LICENSE           MIT license for the whole repo
```

Import from `frontend/src/` with the `@/` alias, e.g.
`import { Foo } from "@/app/foo"`. The alias does not reach outside
`frontend/`.

## Cross-platform notes

The repo is set up so macOS and Windows contributors produce identical diffs:

- `.gitattributes` normalizes all text files to **LF**, so Windows checkouts
  never introduce CRLF noise. `.bat`/`.cmd`/`.ps1` keep CRLF on purpose.
- `.editorconfig` and `.vscode/settings.json` pin editors to LF, 2-space
  indentation, and format-on-save.
- npm scripts avoid shell-specific syntax; `clean` is a Node script rather than
  `rm -rf`.

**Windows only:** if `npm install` fails on long paths inside
`frontend/node_modules`,
enable long path support once:

```powershell
git config --global core.longpaths true
```

## License

[MIT](LICENSE) — © 2026 Xiang Liu, Brian Cao, Andrew Shi, Lisul Elvitigala,
Vedant Vyas.

You are free to use, modify, and redistribute this code, including
commercially, as long as the copyright notice and license text travel with it.
The software comes with no warranty.
