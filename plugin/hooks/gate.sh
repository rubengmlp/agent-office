#!/bin/sh
dir="${AGENT_OFFICE_HOME:-$HOME/.config/agent-office}"
if [ ! -r "$dir/key" ]; then
  cat >/dev/null
  exit 0
fi
port=$(cat "$dir/port" 2>/dev/null)
[ -n "$port" ] || port=4747
endpoint="${1:-gate}"
out=$(curl -sf -m 2 -X POST "http://127.0.0.1:$port/$endpoint" \
  -H "Content-Type: application/json" \
  -H "X-Office-Key: $(cat "$dir/key")" \
  -H "X-Office-Socket: ${CLAUDE_CODE_MESSAGING_SOCKET:-}" \
  -H "X-Office-Token: ${CLAUDE_CODE_MESSAGING_TOKEN:-}" \
  -H "X-Office-Role: ${AGENT_OFFICE_ROLE:-}" \
  -H "X-Office-Name: ${AGENT_OFFICE_NAME:-}" \
  --data-binary @- 2>/dev/null) || exit 0
case "$out" in
  block:*)
    printf '%s\n' "${out#block:}" >&2
    exit 2
    ;;
esac
exit 0
