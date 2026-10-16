#!/bin/sh
set -u
usage() {
  cat >&2 <<'EOF'
Uso: office-chat.sh <canal> [--de <nombre>] <orden> ...
  di "<texto>"                          mensaje al canal
  toca <ruta> [<ruta>...] [-- "<nota>"]  anuncia ficheros antes de editarlos
  listo <ruta> [<ruta>...] [-- "<nota>"] avisa de que terminaste con ellos
  pregunta "<texto>"                    pregunta al canal
  leer [--desde <id>] [--esperar <seg>] lee el canal (espera hasta 90 s)
<canal> es el slug de tu planta o global. --de <nombre> vale en cualquier posición.
EOF
  exit 64
}
[ $# -ge 2 ] || usage
channel="$1"
shift
case "$channel" in
  ''|*[!a-z0-9-]*|[!a-z0-9]*) echo "Canal no válido: usa el slug de la planta (minúsculas, números y guiones) o global." >&2; exit 64 ;;
esac

# --de <nombre> may come anywhere, also after --: take it out and keep the rest in order.
from=""
n=$#
i=0
while [ "$i" -lt "$n" ]; do
  arg="$1"
  shift
  i=$((i + 1))
  if [ "$arg" = "--de" ]; then
    [ "$i" -lt "$n" ] || usage
    from="$1"
    shift
    i=$((i + 1))
    continue
  fi
  set -- "$@" "$arg"
done
[ $# -ge 1 ] || usage
order="$1"
shift

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
  if printf 'X-Office-Token: %s\n' "$CLAUDE_CODE_MESSAGING_TOKEN" 2>/dev/null > "$dir/chat.$$"; then
    session="$dir/chat.$$"
    trap 'rm -f "$session"' EXIT
    trap 'exit 130' HUP INT TERM
  fi
  set +C
fi

# Runs curl with the given arguments and prints the hub answer; any answer other than 2xx exits with 1.
call() {
  max="$1"
  shift
  out=$(curl -sS -m "$max" -w "$nl%{http_code}" \
    -H @"$dir/headers" \
    -H @"$session" \
    -H "X-Office-Role: ${AGENT_OFFICE_ROLE:-}" \
    -H "X-Office-Name: ${AGENT_OFFICE_NAME:-}" \
    "$@")
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
}

case "$order" in
  leer)
    desde=""
    esperar=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --desde)
          [ $# -ge 2 ] || usage
          desde="$2"
          shift 2
          ;;
        --esperar)
          [ $# -ge 2 ] || usage
          esperar="$2"
          shift 2
          ;;
        *) usage ;;
      esac
    done
    case "$desde" in
      *[!0-9]*) echo "--desde espera el número de un mensaje: $desde" >&2; exit 64 ;;
    esac
    case "$esperar" in
      ''|*[!0-9]*) echo "--esperar espera segundos: $esperar" >&2; exit 64 ;;
    esac
    [ "$esperar" -le 90 ] || esperar=90
    query="format=text"
    [ -n "$desde" ] && query="$query&desde=$desde"
    [ "$esperar" -gt 0 ] && query="$query&esperar=$esperar"
    call $((esperar + 15)) "http://127.0.0.1:$port/chat/$channel?$query"
    ;;
  di|pregunta)
    [ $# -ge 1 ] || usage
    kind=texto
    [ "$order" = "pregunta" ] && kind=pregunta
    text="$*"
    call 10 -X POST "http://127.0.0.1:$port/chat?format=text" \
      --data-urlencode "channel=$channel" \
      --data-urlencode "kind=$kind" \
      --data-urlencode "text=$text" \
      --data-urlencode "from=$from" \
      --data-urlencode "cwd=$PWD"
    ;;
  toca|listo)
    # Paths become one files= field each; the note is only the argument after --.
    note=""
    n=$#
    i=0
    while [ "$i" -lt "$n" ]; do
      arg="$1"
      shift
      i=$((i + 1))
      if [ "$arg" = "--" ]; then
        if [ "$i" -lt "$n" ]; then
          note="$1"
          shift
          i=$((i + 1))
        fi
        continue
      fi
      set -- "$@" --data-urlencode "files=$arg"
    done
    [ $# -ge 2 ] || usage
    call 10 -X POST "http://127.0.0.1:$port/chat?format=text" \
      --data-urlencode "channel=$channel" \
      --data-urlencode "kind=$order" \
      --data-urlencode "text=$note" \
      --data-urlencode "from=$from" \
      --data-urlencode "cwd=$PWD" \
      "$@"
    ;;
  *) usage ;;
esac
