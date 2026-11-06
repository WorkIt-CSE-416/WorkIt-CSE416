#!/usr/bin/env bash
# A Claude Code PreToolUse hook: refuses a Bash command that reads Apply's data folder raw, since what it
# prints lands in the session's log. `apply data` shows the same folder masked. Install: apply-agent/CLAUDE.md,
# "The data folder". Exit 2 refuses the command and shows stderr to Claude. It can't see a path built at run
# time ($(echo ...), a variable set earlier): it stops the mistake, not someone set on it.
set -u
input=$(cat)
if command -v jq >/dev/null 2>&1; then
  command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty') || command=
elif command -v python3 >/dev/null 2>&1; then
  command=$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command") or "")') || command=
else
  echo "block-apply-home-reads: neither jq nor python3 here, so the command can't be checked." >&2
  exit 2
fi
line=$(printf '%s' "$command" | tr '\n' ' ')

# The data folder by any name: ~/.config/apply, $HOME/.config/apply, an absolute path, $APPLY_HOME, or Python's
# Path.home() / ".config" / "apply".
home='(\.config/apply([/"'"'"' ;|&)]|$)|\$\{?APPLY_HOME\b|\.config["'"'"'], *["'"'"']apply["'"'"']|\.config["'"'"'] */ *["'"'"']apply["'"'"'])'
# What prints a file. Word starts: "category" or "scatter" never match.
readers='(^|[[:space:]|;&(`])(([^[:space:]]*/)?(cat|bat|less|more|head|tail|nl|grep|egrep|fgrep|rg|ag|ack|sed|awk|gawk|cut|sort|uniq|strings|xxd|od|hexdump|base64|jq|yq|diff|python[0-9.]*|node|ruby|perl|php)|uv run python[0-9.]*)([[:space:]]|$)'

if printf '%s' "$line" | grep -Eq "$home" && printf '%s' "$line" | grep -Eq "$readers"; then
  echo "Refused: that reads Apply's data folder raw, and its values would land in this session's log. Use \`uv run apply data keys [FILE]\` and \`uv run apply data show-key KEY [--file FILE]\` from apply-agent/: they show keys and shapes, masked." >&2
  exit 2
fi
exit 0
