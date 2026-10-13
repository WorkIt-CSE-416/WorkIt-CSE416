#!/usr/bin/env bash
# Superset workspace setup: env files, then both halves' dependencies.
# Starts no processes, so teardown only has to stop what run.sh starts.
set -euo pipefail

# Env files come from $SUPERSET_ROOT_PATH. That checkout can lack them, so
# any file it misses comes from the git primary checkout instead.
missing=0
for f in .env frontend/.env.local; do
  src="${SUPERSET_ROOT_PATH:-}/$f"
  if [ -f "$src" ]; then
    [ "$src" -ef "$f" ] || { cp "$src" "$f" && echo "copied $f from $SUPERSET_ROOT_PATH"; }
  else
    missing=1
  fi
done
if [ "$missing" = 1 ]; then npm run worktree -- --env-only; fi

npm ci --prefix frontend
(cd backend && uv sync)
