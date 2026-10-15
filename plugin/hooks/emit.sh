#!/bin/sh
dir="${AGENT_OFFICE_HOME:-$HOME/.config/agent-office}"
if [ ! -r "$dir/key" ]; then
  cat >/dev/null
  exit 0
fi
port=$(cat "$dir/port" 2>/dev/null)
[ -n "$port" ] || port=4747
endpoint="${1:-events}"
max=2
[ "$endpoint" = ask ] && max=890
out=$(curl -sf -m "$max" -X POST "http://127.0.0.1:$port/$endpoint" \
  -H "Content-Type: application/json" \
  -H "X-Office-Key: $(cat "$dir/key")" \
  -H "X-Office-Socket: ${CLAUDE_CODE_MESSAGING_SOCKET:-}" \
  -H "X-Office-Token: ${CLAUDE_CODE_MESSAGING_TOKEN:-}" \
  -H "X-Office-Role: ${AGENT_OFFICE_ROLE:-}" \
  -H "X-Office-Name: ${AGENT_OFFICE_NAME:-}" \
  --data-binary @- 2>/dev/null)
if [ -n "$out" ]; then
  printf '%s\n' "$out"
fi
exit 0
