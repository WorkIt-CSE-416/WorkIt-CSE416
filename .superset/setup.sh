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
