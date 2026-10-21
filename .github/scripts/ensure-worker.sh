#!/usr/bin/env bash
# ensure-worker.sh NAME: create Worker NAME as a placeholder if it is missing.
#
# On a Worker that does not exist yet, Cloudflare answers wrangler's secrets
# lookup with "No access to the specified resource" (not "not found") when
# the token is an account token, so the first `wrangler deploy` of a new
# Worker fails. A one-line placeholder makes the Worker exist; the real deploy
# replaces it straight after. Does nothing once the Worker exists.
set -euo pipefail
name="$1"
api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers"
auth="Authorization: Bearer $CLOUDFLARE_API_TOKEN"

if curl -fsS -H "$auth" "$api/services/$name" >/dev/null 2>&1; then
  echo "$name exists"
  exit 0
fi

tmp=$(mktemp -d)
printf 'export default { fetch() { return new Response("deploying", { status: 503 }); } };\n' > "$tmp/placeholder.js"
printf '{"main_module":"placeholder.js","compatibility_date":"2026-09-01"}' > "$tmp/metadata.json"
status=$(curl -sS -o "$tmp/out.json" -w '%{http_code}' -X PUT -H "$auth" "$api/scripts/$name" \
  -F "metadata=@$tmp/metadata.json;type=application/json" \
  -F "placeholder.js=@$tmp/placeholder.js;type=application/javascript+module")
if [[ "$status" != 2* ]]; then
  echo "creating $name failed with HTTP $status:"
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("errors"))' "$tmp/out.json"
  exit 1
fi
echo "$name created as a placeholder"
