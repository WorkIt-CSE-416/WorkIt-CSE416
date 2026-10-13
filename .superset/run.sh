#!/usr/bin/env bash
# Superset Run button: the API and the app together, each on the first free
# port from 8000 and 3000, so parallel workspaces never collide. The app's
# API_URL follows the API's port.
set -euo pipefail

free_port() {
  local p=$1
  while (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; do p=$((p + 1)); done
  echo "$p"
}
API_PORT=$(free_port 8000)
WEB_PORT=$(free_port 3000)
echo "API: http://localhost:$API_PORT   App: http://localhost:$WEB_PORT"

# teardown.sh stops this process tree when the workspace is deleted.
echo $$ > .superset/run.pid
trap 'pkill -TERM -P $$ 2>/dev/null; rm -f .superset/run.pid' EXIT

(cd backend && exec uv run uvicorn app.main:app --reload --port "$API_PORT") &
API_URL="http://localhost:$API_PORT" PORT="$WEB_PORT" npm run dev
