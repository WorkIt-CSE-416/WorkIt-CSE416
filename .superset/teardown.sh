#!/usr/bin/env bash
# Superset workspace teardown: stops the dev servers run.sh started.
# setup.sh starts nothing, so this is the only thing left running.
set -uo pipefail

pid=$(cat .superset/run.pid 2>/dev/null) || exit 0
kill_tree() {
  local child
  for child in $(pgrep -P "$1"); do kill_tree "$child"; done
  kill -TERM "$1" 2>/dev/null
}
kill_tree "$pid"
rm -f .superset/run.pid
