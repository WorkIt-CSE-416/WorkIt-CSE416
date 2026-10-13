#!/usr/bin/env bash
# Superset Run button: the API on :8000 and the app on :3000 together.
set -euo pipefail

(cd backend && exec uv run uvicorn app.main:app --reload) &
trap 'kill $! 2>/dev/null' EXIT
npm run dev
