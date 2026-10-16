#!/bin/sh
dir="${AGENT_OFFICE_HOME:-$HOME/.config/agent-office}"
if [ ! -r "$dir/headers" ]; then
  cat >/dev/null
  exit 0
fi
port=
read -r port 2>/dev/null < "$dir/port"
[ -n "$port" ] || port=4747
endpoint="${1:-hook}"
max=2
case "$endpoint" in
  ask|permission) max=3590 ;;
esac
umask 077
session="$dir/hook.$$"
resp="$dir/hook.$$.out"
: 2>/dev/null > "$resp"
set -C
if printf 'X-Office-Socket: %s\nX-Office-Token: %s\nX-Office-Role: %s\nX-Office-Name: %s\n' \
  "${CLAUDE_CODE_MESSAGING_SOCKET:-}" "${CLAUDE_CODE_MESSAGING_TOKEN:-}" "${AGENT_OFFICE_ROLE:-}" "${AGENT_OFFICE_NAME:-}" 2>/dev/null > "$session"
then
  trap 'rm -f "$session" "$resp"' EXIT
else
  session=/dev/null
  trap 'rm -f "$resp"' EXIT
fi
exec 3<&0
curl -sf --connect-timeout 0.3 -m "$max" -X POST "http://127.0.0.1:$port/$endpoint" \
  -H "Content-Type: application/json" \
  -H @"$dir/headers" \
  -H @"$session" \
  --data-binary @- -o "$resp" <&3 2>/dev/null &
curl_pid=$!
trap 'kill "$curl_pid" 2>/dev/null; exit 0' HUP INT TERM
wait "$curl_pid" || exit 0
nl='
'
out=
while IFS= read -r line || [ -n "$line" ]; do
  out="$out${out:+$nl}$line"
done 2>/dev/null < "$resp"
case "$out" in
  block:*)
    printf '%s\n' "${out#block:}" >&2
    exit 2
    ;;
  pass*)
    out=${out#pass}
    out=${out#?}
    ;;
esac
[ -n "$out" ] && printf '%s\n' "$out"
exit 0
