#!/usr/bin/env bash
# Superset workspace setup: env files, then both halves' dependencies.
# Starts no processes, so teardown only has to stop what run.sh starts.
set -euo pipefail

# Copies .env, frontend/.env.local and the sample resumes in
# frontend/public/resumes/ from the git primary checkout.
npm run worktree -- --env-only

# $SUPERSET_ROOT_PATH's env files win when it has them; it can have none.
for f in .env frontend/.env.local; do
  src="${SUPERSET_ROOT_PATH:-}/$f"
  if [ -f "$src" ] && ! [ "$src" -ef "$f" ]; then
    cp "$src" "$f" && echo "copied $f from $SUPERSET_ROOT_PATH"
  fi
done

npm ci --prefix frontend
(cd backend && uv sync)

# Resume PDFs need Tectonic and its warm cache in backend/vendor/, once per
# checkout. Without it every resume shows "This Resume Isn't Loading Right
# Now". Only branches with resume rendering have the script; on a Mac it
# needs `brew install tectonic`, so a failure warns instead of stopping setup.
if [ -f backend/scripts/fetch_tectonic.py ]; then
  (cd backend && python3 scripts/fetch_tectonic.py) ||
    echo "warning: resume PDFs will not render; run brew install tectonic, then python3 scripts/fetch_tectonic.py in backend/" >&2
fi
