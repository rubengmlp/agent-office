#!/bin/sh
set -u
usage() {
  cat >&2 <<'EOF2'
Uso: office-encargo.sh <orden> ...
  carpeta [<slug>]               la carpeta y la rama de un encargo
  comprobar [<slug>]             lanza las comprobaciones de la planta sobre la carpeta del encargo
  estado                         los encargos abiertos de la planta con sus comprobaciones
  descartar <slug> "<motivo>"    descarta un encargo que ya no tiene sentido
Sin <slug> vale el encargo cuya carpeta es la actual o el único abierto de la planta.
EOF2
  exit 64
}
[ $# -ge 1 ] || usage
order="$1"
shift
case "$order" in
  carpeta|comprobar|estado|descartar) ;;
  *) usage ;;
esac
slug=""
reason=""
case "$order" in
  descartar)
    [ $# -ge 2 ] || usage
    slug="$1"
    shift
    reason="$*"
    ;;
  estado)
    [ $# -eq 0 ] || usage
    ;;
  *)
    [ $# -le 1 ] || usage
    slug="${1:-}"
    ;;
esac
case "$slug" in
  *[!A-Za-z0-9/-]*) echo "Encargo no válido: usa el slug o encargo/<slug>." >&2; exit 64 ;;
esac

dir="${AGENT_OFFICE_HOME:-$HOME/.config/agent-office}"
if [ ! -r "$dir/headers" ]; then
  echo "No hay key de Agent Office en $dir: el hub no está configurado." >&2
  exit 69
fi
port=
read -r port 2>/dev/null < "$dir/port"
[ -n "$port" ] || port=4747
nl='
'
session=/dev/null
if [ -n "${CLAUDE_CODE_MESSAGING_TOKEN:-}" ]; then
  umask 077
  set -C
  if printf 'X-Office-Token: %s\n' "$CLAUDE_CODE_MESSAGING_TOKEN" 2>/dev/null > "$dir/encargo.$$"; then
    session="$dir/encargo.$$"
    trap 'rm -f "$session"' EXIT
    trap 'exit 130' HUP INT TERM
  fi
  set +C
fi

out=$(curl -sS -m 30 -w "$nl%{http_code}" \
  -H @"$dir/headers" \
  -H @"$session" \
  -H "X-Office-Role: ${AGENT_OFFICE_ROLE:-}" \
  -H "X-Office-Name: ${AGENT_OFFICE_NAME:-}" \
  -X POST "http://127.0.0.1:$port/encargo" \
  --data-urlencode "order=$order" \
  --data-urlencode "slug=$slug" \
  --data-urlencode "reason=$reason" \
  --data-urlencode "cwd=$PWD")
status=$?
if [ $status -ne 0 ]; then
  echo "No se pudo hablar con el hub de Agent Office en el puerto $port (curl $status)." >&2
  exit 69
fi
code="${out##*"$nl"}"
body="${out%"$nl"*}"
case "$code" in
  2??) printf '%s' "$body" ;;
  *)
    printf '%s' "$body" >&2
    exit 1
    ;;
esac
