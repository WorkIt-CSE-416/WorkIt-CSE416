#!/usr/bin/env bash
# Superset workspace setup: env files, then both halves' dependencies.
set -euo pipefail

# Copies .env, frontend/.env.local and the sample resumes in
# frontend/public/resumes/ from the primary checkout.
npm run worktree -- --env-only

npm ci --prefix frontend
(cd backend && uv sync)
