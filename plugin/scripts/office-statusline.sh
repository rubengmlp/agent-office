#!/bin/sh
dir="${AGENT_OFFICE_HOME:-$HOME/.config/agent-office}"
if [ ! -r "$dir/headers" ]; then
  cat >/dev/null
  exit 0
fi
port=
read -r port 2>/dev/null < "$dir/port"
[ -n "$port" ] || port=4747
out=$(curl -sf --max-time 1 -X POST "http://127.0.0.1:$port/usage" \
  -H "Content-Type: application/json" \
  -H @"$dir/headers" \
  --data-binary @- 2>/dev/null)
if [ -n "$out" ]; then
  printf '%s\n' "$out"
fi
exit 0
