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
npm install
npm run dev
```

Open http://localhost:3000. Editing `src/app/page.tsx` hot-reloads the page.

Database work additionally needs `.env.local` — copy `.env.example` and fill it
in from the Supabase dashboard. The app runs without it; every screen still
renders fixture data.

## Scripts

Every script is cross-platform and runs identically in macOS Terminal, Windows
PowerShell, and cmd.exe.

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

## Project layout

```
src/app/          App Router routes, layouts, and pages
  layout.tsx      Root layout (fonts, metadata, <html>/<body>)
  page.tsx        Route "/"
  globals.css     Tailwind entry point and theme tokens
public/           Static assets served from /
scripts/          Repo maintenance scripts (plain Node, no shell)
src/db/           Drizzle schema, connections, and the RLS query wrapper
docs/drizzle.md   How the database is wired — read before adding a table
```

Import from `src/` with the `@/` alias, e.g. `import { Foo } from "@/app/foo"`.

## Cross-platform notes

The repo is set up so macOS and Windows contributors produce identical diffs:

- `.gitattributes` normalizes all text files to **LF**, so Windows checkouts
  never introduce CRLF noise. `.bat`/`.cmd`/`.ps1` keep CRLF on purpose.
- `.editorconfig` and `.vscode/settings.json` pin editors to LF, 2-space
  indentation, and format-on-save.
- npm scripts avoid shell-specific syntax; `clean` is a Node script rather than
  `rm -rf`.

**Windows only:** if `npm install` fails on long paths inside `node_modules`,
enable long path support once:

```powershell
git config --global core.longpaths true
```
