# WorkIt-CSE416
CSE 416 Final Project Group

By Xiang, Brian, Andrew, Lisul, Vedant

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack)
- TypeScript (strict)
- Tailwind CSS v4
- ESLint 9 + Prettier

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

**Install dependencies in `frontend/`, not at the repo root.** The root
`package.json` has no dependencies — it only forwards the scripts below.

Database work additionally needs `frontend/.env.local` — copy
`frontend/.env.example` and fill it in from the Supabase dashboard. The app runs
without it; every screen still renders fixture data.

## Scripts

Every script is cross-platform and runs identically in macOS Terminal, Windows
PowerShell, and cmd.exe. They are defined in `frontend/package.json` and
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
| `npm run db:generate` | Generate a SQL migration from the Drizzle schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Browse the database in Drizzle Studio |
| `npm run db:check` | Verify the database connection works |
| `npm run favicon` | Rebuild the favicon from `public/workit-icon.png` |
| `npm run install:frontend` | Install frontend dependencies (root only) |

## Project layout

The repo is split by tier. A `backend/` folder will sit beside `frontend/` once
there is a backend; it does not exist yet.

```
frontend/         The Next.js app — its own package.json and node_modules
  src/app/        App Router routes, layouts, and pages
    layout.tsx    Root layout (fonts, metadata, <html>/<body>)
    page.tsx      Route "/"
    globals.css   Tailwind entry point and theme tokens
  src/db/         Drizzle schema, connections, and the RLS query wrapper
  src/components/ Shared components
  src/lib/        Framework-free helpers
  public/         Static assets served from /
  scripts/        Maintenance scripts (plain Node, no shell)
  docs/           Prose docs for the team
    drizzle.md    How the database is wired — read before adding a table
package.json      Scripts that forward into frontend/; no dependencies
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
