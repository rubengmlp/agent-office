# Key y token fuera de la línea de comandos, y un solo hook por evento (M4 + M5)

## Contexto

Los tres hooks del plugin (`plugin/hooks/emit.sh`, `gate.sh`, `guard.sh`) y los dos scripts de sesión (`plugin/scripts/office-sync.sh`, `office-statusline.sh`) pasan la key del hub a `curl` como argumento: `-H "X-Office-Key: $(cat "$dir/key")"` (`emit.sh:16`, `gate.sh:12`, `guard.sh:12`, `office-sync.sh:50`, `office-statusline.sh:11`). Los tres hooks pasan igual el token y el socket de mensajería de la sesión (`emit.sh:17-18`, `gate.sh:13-14`, `guard.sh:13-14`). Mientras dura cada `curl`, decenas de veces por minuto en todas las sesiones de Claude Code del usuario, esos secretos están en la lista de procesos (`ps -ax` en macOS muestra los argumentos de todos los usuarios), lo que vacía el sentido del fichero `key` con permisos 600. Es el hallazgo S3 de la auditoría (`redaccion/planes/auditoria-agent-office.md`).

Además, `plugin/hooks/hooks.json` registra para una misma llamada a herramienta varios hooks que corren en paralelo: `emit.sh events` en `PreToolUse *` (`hooks.json:25-35`) y `PostToolUse *` (`:67-78`), más `guard.sh` en `Edit|Write|MultiEdit|NotebookEdit|Bash` (`:56-65`) y `gate.sh gate-message` en `SendMessage` (`:46-55`). Cada script son cuatro procesos (`sh`, `cat port`, `cat key`, `curl`): un Read cuesta unos ocho procesos y un Edit o un Bash unos doce, también con el hub apagado. Es el hallazgo P1.

Este plan ejecuta las mejoras M4 y M5 de la auditoría. No vuelve a auditar.

Base sobre la que se escribe:

- agent-office-dev build/v1 @ 7c89614 (2026-10-16). Sin cambios desde el último plan sobre esta planta.

Las rutas son relativas a la raíz de la planta (`plugin/hooks/emit.sh` es `redaccion/.fuentes/key-token-hook-unico/agent-office-dev/plugin/hooks/emit.sh` en la foto).

Según el `CLAUDE.md` del repositorio (`CLAUDE.md:9`), `plugin/hooks/` y `hooks.json` se leen en vivo en todas las sesiones del usuario desde la copia `~/Projects/agent-office`. Todo se desarrolla y prueba en el clon `/Users/victorsanblasgomez/Projects/agent-office-dev` con `AGENT_OFFICE_HOME` y `AGENT_OFFICE_CLAUDE_HOME` temporales; nunca `bun run setup`, `bun run floor`, `bun run hub` ni `bun run office`.

## Objetivo

Que ni la key ni el token de mensajería aparezcan nunca en la línea de comandos de ningún proceso del plugin, y que cada evento de Claude Code lance un solo hook y una sola petición HTTP al hub, salvo las tres entradas que necesitan un tope de tiempo propio.

Criterios de aceptación del brief, literales:

- `grep -rn 'X-Office-Key: \$(cat\|X-Office-Token: \$' plugin/` no devuelve nada.
- `hub/test/hooks.test.ts` pasa con los ficheros de cabeceras y adaptado al hook único.
- `hooks.json` registra un comando por evento salvo las dos entradas de espera larga y la de `SendMessage`.
- Un `PreToolUse` de Edit lanza un único `curl` (contar procesos o peticiones HTTP, como describe la Verificación de la auditoría para M5).
- Prueba manual documentada en el plan: `ps` durante un hook no muestra ni la key ni el token (procedimiento de M4 de la Verificación).
- `bun run test` y `bun run typecheck` en verde, validados por el tester de la planta.

Y los dos de la auditoría que el brief recoge:

- M4: `setup`/`rotate-key` escriben `~/.config/agent-office/headers` (600) con `X-Office-Key: …`; `emit.sh`, `gate.sh`, `guard.sh`, `office-sync.sh` y `office-statusline.sh` usan `-H @"$dir/headers"`. El token y el socket de mensajería cambian por sesión: los hooks los escriben en un fichero temporal 600 (`umask 077` y `printf`, sin proceso extra), lo pasan con `-H @` y lo borran al salir con `trap`.
- M5: sustituir `emit.sh`/`gate.sh`/`guard.sh` por `office-hook.sh`, que lee el evento una vez, decide los endpoints (`events`, más `guard` o `gate-message` según `tool_name`) y hace una sola petición a `/hook` que devuelve `{emit, decision}`; `--connect-timeout 0.3`. Quedan aparte, con su propio timeout: `AskUserQuestion` y la segunda entrada de `PermissionRequest` (espera larga, 3600) y la entrada de `SendMessage` (`gate-message`, que un encargo posterior subirá a 30 s).

## Alcance

Entra:

- Fichero de cabeceras `headers` en `AGENT_OFFICE_HOME`, escrito por `setup`, `rotate-key` y por el hub al arrancar.
- Script único `plugin/hooks/office-hook.sh` que sustituye a `emit.sh`, `gate.sh` y `guard.sh`; `hooks.json` reescrito para usarlo.
- Ruta `POST /hook` en el hub, que ingiere el evento y aplica la guardia o la puerta de tareas en la misma petición, en un módulo nuevo `hub/src/hook.ts`.
- `office-sync.sh` y `office-statusline.sh` con `-H @"$dir/headers"` y sin `cat`.
- Si al empezar existe `plugin/scripts/office-chat.sh` (lo crea el plan `chat-interno-agentes`, ver «Convivencia»), el mismo cambio en él.
- Tests: `hub/test/hooks.test.ts` reescrito para el hook único y los ficheros de cabeceras; `hub/test/units.test.ts`, `hub/test/usage.test.ts` y `hub/test/server-v2.test.ts` ampliados.
- `README.md`: las tres frases que describen los hooks y la lectura de la key.

Fuera:

- M11 (guardia estricta con hub caído), M14 (commit dentro de `gate-message`) y M32 (supervisor): vienen después y dependen de este. Este plan deja la entrada de `SendMessage` aparte y con su propio `timeout` justamente para que M14 pueda subirlo sin tocar el resto.
- Quitar las rutas `/events`, `/guard` y `/gate` del hub: siguen existiendo (las usan los tests del hub y una copia del plugin anterior durante la transición). Solo las dejan de llamar los scripts.
- Cambiar la clasificación de eventos (`hub/src/state-machine.ts`), la lógica de la guardia (`hub/src/guard.ts`), `hub/src/office.ts` ni la interfaz.
- `docs/plan.md`, `docs/plan-v2.md`, `docs/spikes.md`: históricos, no se corrigen.

## Convivencia con el plan `chat-interno-agentes`

El plan `redaccion/planes/chat-interno-agentes.md` está aprobado y en ejecución sobre esta misma planta. La foto de este plan no incluye sus cambios, así que lo que sigue sale de leer ese plan (sección «Carpetas y ficheros que toca este plan» y secciones 3 y 4 de su Diseño):

- El chat **no** toca `plugin/hooks/**` ni añade ningún hook nuevo a `hooks.json` (lo dice en su lista de «No se toca»). No hay hook del chat que absorber: los agentes hablan con el hub por un script de Bash, `plugin/scripts/office-chat.sh`, y las rutas `/chat`.
- Ese script nuevo lleva «cabeceras como `emit.sh:15-20`: `X-Office-Key` (leída de `$AGENT_OFFICE_HOME/key` …)». Es decir, reintroduce `X-Office-Key: $(cat …)` en `plugin/scripts/`, y el primer criterio de aceptación de este plan (`grep -rn … plugin/` vacío) fallaría si el chat entra después de M4.
- El chat cuenta con que el hook de `PreToolUse` y `UserPromptSubmit` **imprima** lo que devuelve `/events` (su sección 3: «La ruta `/events` ya devuelve cualquier salida no nula y `emit.sh` la imprime», y su recordatorio «no has anunciado» viaja como `additionalContext` de un `PreToolUse` de Edit). El hook único conserva esa salida: cuando la decisión es `pass`, imprime el `emit` del hub tal cual.
- El chat toca `hub/src/office.ts` (`ingest`, `injection`, métodos nuevos) y `hub/src/server.ts` (rutas tras `/usage` y tras `/api/redaccion/sync`). Este plan no toca `office.ts` (la composición de ingesta + guardia va en `hub/src/hook.ts`) y en `server.ts` añade una sola ruta justo después de `/events` (`server.ts:52-56`), lejos de las del chat.

Decisión: **este plan se ejecuta después de que el chat esté en `build/v1`**, y entonces convierte también `office-chat.sh` (paso 5). Si el usuario lo adelanta, el paso 5 se salta y queda en Preguntas abiertas que el chat adopte `-H @"$dir/headers"`; mientras, el criterio del `grep` solo se cumple hasta que el chat entre.

## Carpetas y ficheros que toca este plan

Obligatorio por el brief. Todo lo que se toca está aquí; nada más.

Nuevos:

- `plugin/hooks/office-hook.sh`
- `hub/src/hook.ts`

Eliminados:

- `plugin/hooks/emit.sh`, `plugin/hooks/gate.sh`, `plugin/hooks/guard.sh`

Editados:

- `plugin/hooks/hooks.json`: todas las entradas apuntan a `office-hook.sh`; desaparece la entrada de `guard.sh`.
- `plugin/scripts/office-sync.sh` (`:41-51`), `plugin/scripts/office-statusline.sh` (`:2-12`); `plugin/scripts/office-chat.sh` si existe, y en ese caso también los tests del chat que preparan un `AGENT_OFFICE_HOME` con `key` para lanzar ese script (según su plan, `hub/test/chat-server.test.ts` o `hub/test/chat.test.ts`): escriben además `headers`, como `usage.test.ts:130`.
- `hub/src/config.ts`: `Paths.headers` (`:28-57`), función nueva `writeHeaders`, llamadas desde `createKeyIfMissing` (`:309-316`) y `rotateKey` (`:318-323`).
- `hub/src/main.ts`: una llamada a `writeHeaders` tras `readKey` (`:35-39`).
- `hub/src/setup.ts`: el mensaje de `--rotate-key` (`:32-33`).
- `hub/src/server.ts`: ruta `POST /hook` tras `/events` (`:52-56`) e `import` de `hook.ts`.
- `hub/test/hooks.test.ts`: reescrito (mismo fichero, mismo servidor falso).
- `hub/test/units.test.ts`: el test de la key (`:106-117`) comprueba también `headers`; test nuevo de `hookResponse`.
- `hub/test/usage.test.ts`: `:130` escribe `headers` además de `key`.
- `hub/test/server-v2.test.ts`: tests de `/hook`.
- `README.md`: `:132`, `:137`, `:146`, `:181`.

No se toca: `hub/src/office.ts`, `hub/src/state-machine.ts`, `hub/src/guard.ts`, `hub/src/gate.ts`, `hub/src/office-sh.ts`, `plugin/settings/**`, `plugin/templates/**`, `plugin/skills/**`, `ui/**`, `docs/**`.

## Diseño

### 1. Fichero de cabeceras `headers` (M4)

`curl -H` admite `@fichero` «which then adds a header for each line in the input file» (página de manual de curl, opción `-H, --header`; la forma `@filename` existe desde curl 7.55.0 y macOS trae 8.x). El fichero no pasa por la línea de comandos: `ps` solo ve `-H @/Users/x/.config/agent-office/headers`.

- `hub/src/config.ts`: `Paths` gana `headers: join(home, 'headers')` (`config.ts:28-57`). Función nueva:

  ```ts
  export function writeHeaders(p: Paths, key: string): void {
    writeAtomic(p.headers, `X-Office-Key: ${key}\n`);
  }
  ```

  Escribe siempre, sin comparar antes: `writeAtomic` escribe con `0o600` y renombra (`config.ts:182-187`), así que el fichero nunca existe a medias y cada escritura corrige también los permisos de un `headers` creado a mano con 644. Es una escritura de 80 bytes al arrancar el hub y en `setup`; no merece la comparación. `createKeyIfMissing` (`:309-316`) llama a `writeHeaders(p, key)` en los dos caminos (key nueva y key existente: así una instalación anterior sin `headers` lo gana al pasar por `setup`); `rotateKey` (`:318-323`) lo llama con la key nueva.
- `hub/src/main.ts:35-39`: tras `readKey`, `writeHeaders(p, key)`. Por qué también en el hub: el usuario trae el cambio a la copia en vivo con `git pull` y reinicia el hub; sin este paso tendría que acordarse de `bun run setup` y hasta entonces los hooks saldrían en silencio (ver Riesgos).
- `hub/src/setup.ts:33`: el mensaje de `--rotate-key` pasa a «Reinicia el hub y recarga la pestaña de la oficina. Los hooks leen la key del fichero de cabeceras en cada evento, así que las sesiones abiertas siguen funcionando.»
- Los scripts dejan de comprobar `$dir/key` y comprueban `[ -r "$dir/headers" ]`: es lo que van a usar, y una instalación sin `headers` (plugin nuevo con hub viejo) se comporta como «hub no configurado», exit 0 en silencio, como hoy sin key (`emit.sh:3-6`).
- El puerto deja de leerse con `cat` (un proceso): `port=; read -r port 2>/dev/null < "$dir/port"; [ -n "$port" ] || port=4747`. `read` es builtin en todo `sh`. El `2>/dev/null` va antes de `<` porque las redirecciones se aplican de izquierda a derecha: al revés, si `port` no existe, el error de la redirección saldría por el stderr del script (en `office-sync.sh` lo leería el agente). No se usa `|| port=` tras el `read`: `read` devuelve distinto de 0 al llegar a EOF aunque haya leído el valor, y un `port` sin salto de línea final (como escribe `hub/test/usage.test.ts:131,138,143` con `String(port)`) se perdería y la petición iría al 4747. Si el fichero no existe la redirección falla, `port` sigue vacío y se usa 4747, igual que hoy (`emit.sh:7-8`). `hooks.test.ts` prueba un `port` sin salto final.

### 2. Token y socket por sesión en un fichero temporal (M4)

`CLAUDE_CODE_MESSAGING_SOCKET` y `CLAUDE_CODE_MESSAGING_TOKEN` cambian por sesión y los conoce solo el proceso del hook, así que no pueden ir en `headers`. El hook los escribe en un fichero propio **dentro de la carpeta de la oficina** (`$dir`, que `ensureHome` crea con `0700`, `hub/src/config.ts:178-180`) y lo pasa también con `-H @`:

```sh
umask 077
set -C
session="$dir/hook.$$"
resp="$dir/hook.$$.out"
if printf 'X-Office-Socket: %s\nX-Office-Token: %s\nX-Office-Role: %s\nX-Office-Name: %s\n' \
  "${CLAUDE_CODE_MESSAGING_SOCKET:-}" "${CLAUDE_CODE_MESSAGING_TOKEN:-}" "${AGENT_OFFICE_ROLE:-}" "${AGENT_OFFICE_NAME:-}" 2>/dev/null > "$session"
then
  trap 'rm -f "$session" "$resp"' EXIT
else
  session=/dev/null
  trap 'rm -f "$resp"' EXIT
fi
```

- **Por qué en `$dir` y no en `TMPDIR`/`/tmp`.** `set -C` (`noclobber`) solo rechaza ficheros *regulares* ya existentes: bash y dash abren sin quejarse una FIFO o un enlace a una FIFO que otro usuario haya plantado en `/tmp/office-hook.<pid>` (nombre predecible), y leería el token y el socket, o le devolvería a `curl -H @` cabeceras falsas. En `/tmp` compartido eso es posible, y también en macOS si el entorno del hook no trae `TMPDIR`. En `$dir` (0700) nadie más puede crear nada, así que el único caso que queda es el del propio usuario: un fichero huérfano de un hook anterior con el mismo PID, que `set -C` detecta.
- `umask 077` hace que los ficheros nazcan 600; `printf` y la redirección son builtins, sin proceso extra. `2>/dev/null` va **antes** de `> "$session"` porque las redirecciones se aplican de izquierda a derecha y, si no, el error de `noclobber` («cannot overwrite existing file») saldría por el stderr del hook.
- Si la escritura falla (fichero huérfano de un hook matado con `SIGKILL`, disco lleno), el hook **no** pierde el evento: manda la petición solo con `headers` (`-H @/dev/null` no añade nada) y el hub recibe el evento sin socket, token, rol ni nombre. `touchSession` solo sobrescribe esos campos cuando llega un valor (`hub/src/office.ts:1258-1264`), así que la sesión conserva los de eventos anteriores y el hub sigue pudiendo entregarle órdenes; solo si el fallo cae en el primer evento de la sesión (`SessionStart`) faltan el rol y el nombre hasta el siguiente evento, y con ellos la inyección de lecciones de ese arranque. El evento vale más que las cabeceras.
- **Señales.** Hoy, sin `trap`, el `sh` muere en cuanto Claude Code le manda `SIGTERM`. Con un `trap` puesto, el shell no ejecuta el trap hasta que termina el comando en primer plano, sea cual sea el contenido del trap: con `out=$(curl …)` en `ask`/`permission` seguiría vivo hasta 3590 s. Por eso `curl` corre en segundo plano y el shell espera con `wait`, que sí se interrumpe con una señal atrapada (POSIX: «the reception of a signal for which a trap has been set shall cause the wait utility to return immediately»), y el trap mata al `curl`:

  ```sh
  exec 3<&0
  curl -sf --connect-timeout 0.3 -m "$max" -X POST "http://127.0.0.1:$port/$endpoint" \
    -H "Content-Type: application/json" -H @"$dir/headers" -H @"$session" \
    --data-binary @- -o "$resp" <&3 2>/dev/null &
  curl_pid=$!
  trap 'kill "$curl_pid" 2>/dev/null; exit 0' HUP INT TERM
  wait "$curl_pid" || exit 0
  ```

  **El stdin de un comando en segundo plano es `/dev/null`.** Sin control de trabajos (un hook es siempre un `sh` no interactivo), POSIX y bash («If job control is not active, the standard input for asynchronous commands, in the absence of any explicit redirections, is redirected from /dev/null») y dash redirigen la entrada de una lista asíncrona desde `/dev/null`: un `curl … @- &` a secas mandaría el cuerpo vacío, `/hook` respondería `pass` sin ingerir nada y el fallo sería silencioso. Por eso el script guarda antes el stdin del hook en el descriptor 3 (`exec 3<&0`) y lo pasa a `curl` con `<&3`. No vale `<&0`: dash abre `/dev/null` en el hijo antes de aplicar las redirecciones explícitas y `<&0` duplicaría ese `/dev/null`. El `exit 0` del trap dispara el de `EXIT`, que borra los dos ficheros. La respuesta de `curl` va a `$resp` (también en `$dir`, 600) y el script la lee con un bucle `while IFS= read -r line || [ -n "$line" ]` (builtin; la segunda condición conserva una última línea sin salto), sin `cat`. `wait` devuelve el código de `curl`, así que `|| exit 0` conserva el fallo abierto.
- Con `SIGKILL` no corre ningún `trap`: quedan `hook.<pid>` y `hook.<pid>.out` en `$dir` con 600. Es la carpeta privada del usuario: no expone nada. El `set -C` del siguiente hook con ese PID reciclado cae en la rama de `session=/dev/null`.
- `rm` es el único proceso extra del hook: cada evento cuesta `sh` + `curl` + `rm`, tres procesos (hoy cuatro por script). Por llamada a herramienta, que son dos eventos (`PreToolUse` y `PostToolUse`): un Read pasa de 8 procesos (dos `emit.sh`) a 6; un Edit o un Bash de 12 (dos `emit.sh` más `guard.sh`) a 6.
- Cabeceras con valor vacío: curl quita del todo una cabecera dada como `X-Office-Token:` sin valor («Remove an internal header by giving a replacement without content on the right side of the colon», man curl), así que si la sesión no exporta token el hub no recibe la cabecera, y `metaOf` (`hub/src/server.ts:329-337`) la deja en `null` exactamente igual que hoy con `X-Office-Token: ` vacío.
- `AGENT_OFFICE_ROLE` y `AGENT_OFFICE_NAME` no son secretos, pero van en el mismo fichero: así la línea de `curl` es idéntica en todas las sesiones y no hay nada que inspeccionar en `ps`.

### 3. `office-hook.sh`: un script, una petición (M5)

```sh
#!/bin/sh
# Hook único de Agent Office. Sin argumento: POST /hook (evento y, si toca, guardia o puerta).
# Con argumento (ask | permission | gate-message): ese endpoint con su propio tope de tiempo.
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
# …bloque de ficheros de sesión de la sección 2 (umask, set -C, printf, trap EXIT)…
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
```

Decisiones:

- **Quién decide los endpoints: el hub, no el script.** El script no analiza el JSON del evento (hacerlo en `sh` sin `jq` costaría `sed`/`grep`, procesos que P1 quiere quitar). Manda el evento a `/hook` y el hub, que ya tiene `hook_event_name` y `tool_name` parseados, decide: ingesta siempre, guardia si es `PreToolUse` de una herramienta vigilada, puerta de tareas si es `TaskCompleted`. Es lo que el brief describe como «decide los endpoints `events`, más `guard`»; `gate-message` se queda en su propia entrada (siguiente punto).
- **Respuesta de `/hook` en texto, no JSON.** El brief habla de «una petición que devuelve `{emit, decision}`»: así se llama el tipo del hub (`HookResult`, sección 4), pero por el cable va como texto porque `sh` no puede leer JSON sin un proceso más. Primera línea `pass` o `block:<motivo>`; si es `pass` y hay algo que inyectar, el resto del cuerpo es el JSON que hoy devuelve `/events` (`hookSpecificOutput`). El script lo separa con expansiones de parámetro (`${out#pass}` y `${out#?}` quitan «pass» y el salto de línea), que son builtins. `block:` se imprime en stderr con exit 2, el mismo contrato que hoy tienen `gate.sh:18-23` y `guard.sh:18-23` y que Claude Code documenta para `PreToolUse` («Exit with code 2 to block the action… The message that comes with the block is your hook's stderr», https://code.claude.com/docs/en/hooks). Cuando bloquea no se imprime el `emit`: un Edit bloqueado no necesita contexto.
- **Los endpoints de espera larga y `gate-message` siguen siendo entradas propias.** `AskUserQuestion` (`hooks.json:36-45`) y la segunda entrada de `PermissionRequest` (`:102-111`) necesitan `-m 3590` y `"timeout": 3600`, y `/ask` y `/permission` retienen la petición hasta que el panel contesta (`hub/src/office.ts:462-507`): no se pueden mezclar con la ingesta, que tiene que volver en milisegundos. `SendMessage` queda aparte porque M14 subirá su tope a 30 s y no debe arrastrar al `PreToolUse *`. El mismo script las sirve con el argumento `ask`, `permission` o `gate-message`, que es como el script sabe en qué entrada está (el evento de stdin es el mismo en `PreToolUse *` y en la entrada de `AskUserQuestion`). Resultado: un `AskUserQuestion`, un `SendMessage` o un `PermissionRequest` lanzan dos hooks, como hoy; todo lo demás, uno.
- **`--connect-timeout 0.3`** (curl admite decimales en esta opción, man curl) limita a 300 ms la espera de conexión a un hub colgado; `-m 2` sigue como tope total, como hoy (`emit.sh:10`). Con el hub apagado la conexión se rechaza al instante y `curl -f` falla: `wait` devuelve su código y el script sale 0 sin salida, como hoy (`emit.sh:14-25`).
- **`curl` en segundo plano y `wait`**, en vez de `out=$(curl …)`: es lo que permite que el `SIGTERM` de Claude Code mate al hook al momento también en `ask`/`permission` (sección 2, «Señales»). Como el stdin de un comando asíncrono es `/dev/null` en un shell sin control de trabajos, el evento se pasa por el descriptor 3 (`exec 3<&0` y `<&3`, sección 2). El cuerpo de la respuesta pasa por `$resp` y se lee con `read`, builtin. `curl -o` no crea `$resp` si la respuesta va vacía (el caso normal de `/ask` y `/permission` sin panel, y de `/hook` con `pass` a secas), de ahí el `2>/dev/null` del `done`, **delante** de la redirección de entrada: las redirecciones se aplican de izquierda a derecha, y escrito al revés el error «No such file» saldría por el stderr del hook. Por el mismo motivo el `read` del puerto es `read -r port 2>/dev/null < "$dir/port"`.
- **Fallo abierto.** Si el hub no responde o devuelve 4xx/5xx (`-f`), el script sale 0 sin bloquear, como hoy. M11 lo cambiará para las sesiones de departamento; aquí no.
- **`gate` de `TaskCompleted`** deja de ser `gate.sh gate` y pasa por `/hook` sin argumento: el hub ve `hook_event_name === 'TaskCompleted'` y aplica `office.gate` (sección 4). Así `TaskCompleted` también cumple «un comando por evento».

### 4. Hub: `hub/src/hook.ts` y `POST /hook`

Módulo nuevo para no engordar `office.ts` (A1 de la auditoría) y para no chocar con el plan del chat, que edita `ingest`:

```ts
import type { GateDecision } from './gate';
import { GUARDED_TOOLS } from './guard';
import type { Office } from './office';
import type { HookEvent, HookMeta } from './types';

export type HookResult = { emit: string | null; decision: GateDecision };

const NO_GATE: GateDecision = { pass: true, reason: 'sin puerta' };

export function runHook(office: Pick<Office, 'ingest' | 'guard' | 'gate'>, e: HookEvent, meta: HookMeta, onError: (error: unknown) => void): HookResult {
  if (e.hook_event_name === 'TaskCompleted') return { emit: null, decision: office.gate(e) };
  let emit: string | null = null;
  try {
    emit = office.ingest(e, meta);
  } catch (error) {
    onError(error);
  }
  const guarded = e.hook_event_name === 'PreToolUse' && GUARDED_TOOLS.has(e.tool_name ?? '');
  return { emit, decision: guarded ? office.guard(e, meta) : NO_GATE };
}

export function hookResponse(r: HookResult): string {
  if (!r.decision.pass) return `block:${r.decision.reason.replace(/\s*\n\s*/g, ' ')}`;
  return r.emit ? `pass\n${r.emit}` : 'pass';
}
```

- Reproduce lo que hoy hacen tres hooks en paralelo: `emit.sh events` → `office.ingest` (`hub/src/office.ts:366`), `guard.sh` → `office.guard` (`:594`, que ya devuelve `pass` para herramientas fuera de `GUARDED_TOOLS`, exportado en `hub/src/guard.ts` e importado en `office.ts:24`), `gate.sh gate` → `office.gate` (`:529`). `TaskCompleted` hoy no pasa por `/events` (`hooks.json:190-199` solo registra `gate.sh gate`), y se mantiene así.
- **La guardia no depende de la ingesta.** Hoy `guard.sh` es una petición independiente: si `/events` falla, `/guard` sigue decidiendo. Con una sola petición, una excepción de `office.ingest` haría que Hono respondiera 500, `curl -f` fallara y el script saliera 0: el Edit o el Bash del departamento pasaría sin guardia. Por eso `runHook` envuelve `ingest` en `try/catch`, deja `emit = null`, avisa por `onError` (la ruta pasa `(error) => console.error(…)`, que es lo que hoy hace Hono con una excepción no capturada) y aplica `guard` igual. Si es `guard` la que lanza, el 500 y el fallo abierto son los de hoy.
- Orden: primero `ingest`, después `guard`. Hoy corren a la vez y el orden es casual; ingerir primero hace que `touchAgent` conozca al agente antes de que `guard` escriba su entrada de actividad con `this.agents.get(key)?.name` (`office.ts:613`). El evento se registra aunque la guardia bloquee, igual que hoy.
- El motivo del bloqueo se deja en una línea (los de `guard.ts:218-220` y `gate.ts:17-21` ya lo son; la sustitución es una red por si cambian), porque el script decide por la primera línea.
- `hub/src/server.ts`, tras `/events` (`:52-56`):

  ```ts
  app.post('/hook', requireKey, async (c) => {
    const event = await readJson(c);
    if (!isHookEvent(event)) return c.text('pass');
    return c.text(hookResponse(runHook(office, event, metaOf(c), (error) => console.error(`Agent Office: /hook ingest: ${(error as Error).message}`))));
  });
  ```

  `/events`, `/guard`, `/gate`, `/gate-message`, `/ask`, `/permission` y `/usage` no cambian.

### 5. `hooks.json`

Mismas catorce claves de evento que hoy. Cada entrada `emit.sh events` pasa a `"${CLAUDE_PLUGIN_ROOT}/hooks/office-hook.sh"` con `"timeout": 5`; la de `AskUserQuestion` a `office-hook.sh ask` (3600); la de `SendMessage` a `office-hook.sh gate-message` (5); la segunda de `PermissionRequest` a `office-hook.sh permission` (3600); la de `TaskCompleted` a `office-hook.sh` (sin argumento). La entrada `Edit|Write|MultiEdit|NotebookEdit|Bash` → `guard.sh` (`hooks.json:56-65`) desaparece. Quedan 17 comandos (hoy 18): un comando por evento más las tres entradas que se mantienen aparte. Claude Code ejecuta en paralelo todos los hooks que casan («All matching hooks run in parallel», documentación de hooks), así que en `AskUserQuestion`, `SendMessage` y `PermissionRequest` siguen corriendo dos, como hoy.

### 6. `office-sync.sh`, `office-statusline.sh` y `office-chat.sh`

- `office-sync.sh:41-51`: `[ -r "$dir/headers" ]` con el mismo mensaje y exit 69 (`:42-45`); `port=; read -r port 2>/dev/null < "$dir/port"; [ -n "$port" ] || port=4747` (sección 1); `-H @"$dir/headers"` en vez de `:50`. Nada más cambia (no lleva token).
- `office-statusline.sh:2-12`: lo mismo; conserva `--max-time 1` y la salida.
- `office-chat.sh` (si existe, ver Convivencia): sustituir su lectura de `$AGENT_OFFICE_HOME/key` por `headers` manteniendo su exit 69 «sin key», y su `-H "X-Office-Key: …"` por `-H @"$dir/headers"`. `X-Office-Role`/`X-Office-Name` no son secretos y ese script no lleva token, así que pueden seguir en la línea de comandos.

### 7. README

- `README.md:132`: `hooks (emit.sh, gate.sh, guard.sh)` → `hook único (office-hook.sh)`.
- `README.md:137`: el párrafo pasa a describir `office-hook.sh`: una petición a `/hook` por evento, la key en `~/.config/agent-office/headers` y el token de la sesión en un fichero temporal 600 que se borra al salir; `AskUserQuestion`, `PermissionRequest` y `SendMessage` con su entrada aparte.
- `README.md:146`: «los hooks la leen en cada evento» → «los hooks la leen del fichero de cabeceras `headers` (600) en cada evento; ni la key ni el token de mensajería pasan por la línea de comandos. El hub escribe `headers` al arrancar y `setup`/`rotate-key` también: tras actualizar la copia en vivo, reinicia el hub antes de abrir sesiones; hasta entonces los hooks salen en silencio».
- `README.md:181` («`emit.sh` lee la key de un fichero 600 sin tocar el `env` de los settings…»): pasa a «`office-hook.sh` lee la key del fichero de cabeceras `headers` (600) sin tocar el `env` de los settings, falla en silencio con el hub apagado y siempre recibe el socket y el token de mensajería».

## Pasos

Los tests se escriben antes del cambio (regla M24 de la auditoría: el test del hallazgo va en la misma rama, antes de la corrección), así que fallan hasta el paso que los corrige. `hub/tsconfig.json:13` incluye `test`, y `units.test.ts` importa `writeHeaders` de `../src/config` desde el paso 1: `cd hub && bun run typecheck` está en rojo tras el paso 1 y en verde desde el paso 2. El test de `hookResponse`, que importa `../src/hook`, se escribe en el paso 3 junto con el módulo para no romper el typecheck del paso 2.

1. **Tests primero.** Reescribir `hub/test/hooks.test.ts` para `office-hook.sh` (sección Verificación, lista «hooks.test.ts»); en `hub/test/units.test.ts:106-117` añadir las comprobaciones de `headers` (`writeHeaders`, `createKeyIfMissing`, `rotateKey`); en `hub/test/usage.test.ts:130` escribir `headers` junto a `key`; en `hub/test/server-v2.test.ts` los tests de `/hook`. Verificable: `cd hub && bun test test/hooks.test.ts test/units.test.ts test/server-v2.test.ts` falla en el commit base (no existe `office-hook.sh`, ni `/hook`, ni `headers`; `units.test.ts` falla entero porque importa `writeHeaders`, que aún no existe).
2. **Cabeceras en el hub.** `hub/src/config.ts` (`Paths.headers`, `writeHeaders`, llamadas en `createKeyIfMissing` y `rotateKey`), `hub/src/main.ts` (`writeHeaders` tras `readKey`), `hub/src/setup.ts:33` (mensaje). Verificable: `cd hub && bun test test/units.test.ts` en verde; `bun run typecheck` en verde.
3. **Ruta `/hook`.** `hub/src/hook.ts` nuevo, la ruta en `hub/src/server.ts` y el test de `hookResponse` en `hub/test/units.test.ts`. Verificable: `cd hub && bun test test/server-v2.test.ts test/units.test.ts` en verde; `bun run typecheck` en verde.
4. **Script único y `hooks.json`.** Crear `plugin/hooks/office-hook.sh` (`chmod +x`, `sh -n` limpio), reescribir `plugin/hooks/hooks.json`, borrar `emit.sh`, `gate.sh` y `guard.sh`. Verificable: `cd hub && bun test test/hooks.test.ts` en verde; `grep -c '"command":' plugin/hooks/hooks.json` da 17; `grep -c 'office-hook.sh' plugin/hooks/hooks.json` da 17; `grep -rn 'emit.sh\|gate.sh\|guard.sh' plugin/ hub/src hub/test` vacío.
5. **Scripts de sesión.** `office-sync.sh`, `office-statusline.sh` y, si existe, `office-chat.sh` junto con los tests del chat que preparan `key` para lanzarlo, que escriben también `headers` (si no, `bun run test` se pondría en rojo al exigir el script `[ -r "$dir/headers" ]`). Verificable: `grep -rn 'X-Office-Key: \$(cat\|X-Office-Token: \$' plugin/` vacío; `cd hub && bun test test/usage.test.ts` en verde; `sh -n` de los tres.
6. **README** (`:132`, `:137`, `:146`, `:181`). Verificable: `grep -n 'emit.sh\|gate.sh\|guard.sh' README.md` vacío.
7. **Receta manual y entrega.** Seguir «Verificación» (M4 con `ps`, M5 con el contador de peticiones y `sh -x`). El jefe de la planta pide al tester `bun run test` y `bun run typecheck` en el clon y manda `HECHO:` con su resultado.

## Riesgos

- **`hooks.json` se lee en vivo en todas las sesiones del usuario** (`CLAUDE.md:9`; riesgo «M5 cambia hooks.json» de la auditoría). Un error en `office-hook.sh` afecta al momento a todas las sesiones, de la oficina y personales. Mitigación: todo el desarrollo en el clon; `hub/test/hooks.test.ts` ejecuta el script real con `sh` contra un servidor falso, con el hub caído y sin `headers`; antes de traerlo a la copia en vivo, la receta manual con `AGENT_OFFICE_HOME`/`AGENT_OFFICE_CLAUDE_HOME` temporales; y traerlo con las sesiones cerradas. El script falla abierto (exit 0) en todo lo que no sea un `block:` explícito del hub.
- **Transición en la copia en vivo.** Tras el `git pull`, hasta que el hub se reinicie: (a) no existe `~/.config/agent-office/headers`, así que el hook nuevo sale en silencio sin mandar nada, y (b) el hub viejo no tiene `/hook`, así que si `headers` ya existiera `curl -f` recibiría 404 y saldría igual en silencio. En los dos casos la oficina queda ciega (sin guardia ni puerta) sin bloquear ninguna sesión. Mitigación: el hub escribe `headers` al arrancar (paso 2), así que el orden «pull, reiniciar hub, abrir sesiones» basta; el README lo dice. M11 convertirá «ciega» en «bloqueada» para los departamentos.
- **Ficheros huérfanos en `$dir`.** Si Claude Code mata un hook con `SIGKILL` (no con `SIGTERM`, que el `trap` atiende al momento), quedan `hook.<pid>` y `hook.<pid>.out` en la carpeta de la oficina, 600 y en una carpeta 0700. Un hook posterior con el mismo PID no puede escribir `hook.<pid>` (`set -C`) y manda el evento sin socket, token, rol ni nombre; como `touchSession` conserva los valores anteriores de la sesión cuando no llega ninguno (`hub/src/office.ts:1258-1264`), el hub sigue entregando órdenes a esa sesión, y solo si el huérfano coincide con su `SessionStart` faltan rol y nombre (y la inyección de lecciones) hasta el siguiente evento. Es raro (PID reciclado y huérfano a la vez) y el siguiente evento lo corrige. El `.out` huérfano sí se sobrescribe (`curl -o` no pasa por `noclobber`). Limpieza de huérfanos: fuera de este plan; si molestan, `main.ts` puede borrar `hook.*` de más de un día al arrancar.
- **Carpeta compartida.** No se usa `TMPDIR` ni `/tmp`: en una carpeta compartida `set -C` no protege contra una FIFO ajena con el nombre predecible `office-hook.<pid>` (bash y dash solo rechazan ficheros regulares). En `$dir` (0700) solo escribe el usuario. Si alguien configurara `AGENT_OFFICE_HOME` en una carpeta con otros permisos, `headers` y `key` ya estarían igual de expuestos, así que no añade superficie.
- **`--connect-timeout 0.3` bajo carga.** La conexión a `127.0.0.1` tarda microsegundos; solo vence si el hub no acepta conexiones durante 300 ms (colgado o cola de `accept` llena). En ese caso el evento se pierde como hoy a los 2 s, pero antes.
- **Orden `ingest` → `guard`.** Hoy los dos corren en paralelo; con el orden fijo, un `PreToolUse` bloqueado queda registrado con `tool = Edit` y el fichero (como hoy, porque `emit.sh` también lo mandaba). No cambia ningún test de `office.test.ts`.
- **El plan del chat y el `grep`.** Si el chat entra después de este plan con su `office-chat.sh` tal cual, el primer criterio vuelve a fallar. Por eso la Convivencia fija el orden: chat primero. Si no puede ser, pregunta abierta 1.
- **Versiones de curl.** `-H @fichero` necesita curl ≥ 7.55 y `--connect-timeout` decimal ≥ 7.32. macOS 15 trae 8.x; en Linux cualquier distribución de los últimos años también. `curl --version` en la receta manual.

## Verificación

Todo en el clon `/Users/victorsanblasgomez/Projects/agent-office-dev`. Nunca `bun run setup`, `bun run floor`, `bun run hub` ni `bun run office`.

Automática:

```sh
cd ~/Projects/agent-office-dev
bun run test        # hub: hooks, units, usage, server-v2 y el resto; ui sin cambios
bun run typecheck   # hub y ui
grep -rn 'X-Office-Key: \$(cat\|X-Office-Token: \$' plugin/      # vacío
grep -c '"command":' plugin/hooks/hooks.json                       # 17
grep -c 'office-hook.sh' plugin/hooks/hooks.json                   # 17
ls plugin/hooks                                                    # hooks.json office-hook.sh
```

`hub/test/hooks.test.ts` (paso 1), con el mismo servidor falso de hoy (`hooks.test.ts:39-61`) que además cuenta peticiones y responde en `/hook`:

- Sin `headers` en `AGENT_OFFICE_HOME`: `office-hook.sh` sale 0 sin salida y no llega ninguna petición (aunque exista `key`).
- Con el hub caído (`port` a un puerto cerrado): exit 0, sin salida, en menos de 1 s.
- `port` escrito sin salto de línea final (`writeFileSync(join(home, 'port'), String(server.port))`): la petición llega igual al servidor falso (el `read` conserva el valor aunque devuelva EOF).
- Cabeceras: un `SessionStart` con `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `AGENT_OFFICE_ROLE` y `AGENT_OFFICE_NAME` exportados llega a `/hook` con `x-office-key`, `x-office-socket`, `x-office-token`, `x-office-role` y `x-office-name` correctos y el cuerpo igual al evento (hoy `hooks.test.ts:81-98`).
- Sin token exportado, la petición no trae `x-office-token`.
- `pass` con inyección: `/hook` responde `pass\n{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"Lecciones"}}` y el script imprime solo el JSON (hoy `:100-104`); lo mismo para un `PreToolUse` de Edit con `additionalContext` (lo que necesita el chat).
- `pass` solo: stdout vacío, exit 0.
- `block:` en un `PreToolUse` de Write: exit 2, el motivo en stderr, stdout vacío (hoy `:106-117`).
- Un `PreToolUse` de Edit produce **exactamente una** petición, a `/hook` (criterio «un único curl», contado por peticiones HTTP como admite la Verificación de la auditoría).
- `office-hook.sh ask` va a `/ask` e imprime el JSON tal cual (hoy `:126-130`); `office-hook.sh permission` a `/permission` (hoy `:119-124`); `office-hook.sh gate-message` a `/gate-message` y sale 2 con `block:` (hoy `:140-145`). En los tres, el **cuerpo** recibido por el servidor falso es exactamente el evento de stdin (hoy solo lo comprueba el de `SessionStart`, `:92`): es lo que detecta un `curl` en segundo plano leyendo de `/dev/null`.
- `TaskCompleted` sin argumento va a `/hook`; con respuesta `block:Falta tester…` sale 2 con ese motivo (hoy `:132-138`), y el cuerpo recibido es el evento.
- Ficheros de sesión: con el servidor falso retrasando la respuesta 300 ms, durante la ejecución existen en `home` (el `AGENT_OFFICE_HOME` del test) `hook.<pid>` con modo `0o600` y contenido `X-Office-Token: tok-1` y `hook.<pid>.out`; al terminar, `readdirSync(home)` solo contiene `headers`, `key` y `port`. Con `TMPDIR` exportado a otra carpeta del test, esa carpeta sigue vacía (el hook no la usa).
- `SIGTERM` con la petición retenida: el servidor falso retiene `/ask` hasta que se le indique; el test lanza `office-hook.sh ask`, espera a que exista `hook.<pid>`, hace `proc.kill('SIGTERM')` y comprueba que el proceso termina en menos de 1 s, que no quedan `hook.*` en `home` y que no queda ningún `curl` hijo (`pgrep -P <pid>` vacío o, más simple, que el servidor falso ve abortada la petición: `req.signal.aborted`).
- Respuesta sin salto de línea final: el servidor falso responde `pass\n{"hookSpecificOutput":{}}` sin `\n` final y el script imprime el JSON completo (el bucle `read … || [ -n "$line" ]` conserva la última línea).
- Línea de comandos: el test lee `plugin/hooks/office-hook.sh`, `plugin/scripts/office-sync.sh`, `plugin/scripts/office-statusline.sh` (y `office-chat.sh` si existe) y comprueba que ninguno contiene `X-Office-Key: $(` ni `X-Office-Token: $` y que todos contienen `-H @"$dir/headers"`.

`hub/test/units.test.ts`: `createKeyIfMissing` deja `p.headers` con modo 600 y contenido `X-Office-Key: <key>\n`; `rotateKey` lo reescribe con la key nueva; `writeHeaders` sobre un `headers` previo con `chmodSync(…, 0o644)` lo deja en 600. En el paso 3: `runHook` con un `office` falso cuyo `ingest` lanza una excepción y cuyo `guard` devuelve `block:` sigue devolviendo esa decisión, con `emit: null` y `onError` llamado una vez; `hookResponse({ emit: null, decision: { pass: false, reason: 'a\nb' } })` es `block:a b`; con `emit` es `pass\n<emit>`; sin nada es `pass`.

`hub/test/server-v2.test.ts`: `POST /hook` sin key → 401; el mismo caso que hoy prueba `/events` en `:80` (`addLesson` para el jefe de `mobile` y después un `SessionStart` con `X-Office-Role: office-lead-mobile`) responde `pass\n{…additionalContext…}` con la lección; `injection` solo devuelve algo si hay lecciones o informes del puesto (`hub/src/office.ts:945-964`), así que sin la lección previa la respuesta sería `pass` a secas. Un `PreToolUse` de Write de un jefe `office-lead-redaccion` (cabecera `X-Office-Role`) sobre `/etc/x.md` responde `block:Guardia de Agent Office: …` y el evento queda registrado (`snapshot().agents` tiene al agente con `tool: 'Write'`); un `PreToolUse` de Read responde `pass` y el agente pasa a `tool: 'Read'`; un `TaskCompleted` de una sesión sin equipo responde `pass`; un cuerpo que no es evento responde `pass`.

Manual, con un hub temporal (el `docsRepo` temporal es obligatorio porque `office.start()` llama a `sync.cleanup`, que borra las fotos de `redaccion/.fuentes/*` del `docsRepo` que no estén en su base de datos):

```sh
# HOLD hará de AGENT_OFFICE_HOME del hook en las pruebas de M4: mktemp -d la crea con 0700
HOLD=$(mktemp -d /tmp/office-hold.XXXXXX)
export AGENT_OFFICE_HOME=$(mktemp -d) AGENT_OFFICE_CLAUDE_HOME=$(mktemp -d)
mkdir -p /tmp/office-docs-hook
head -c 32 /dev/urandom | xxd -p -c 64 > "$AGENT_OFFICE_HOME/key"
printf 'secreto-token' > "$HOLD/token.txt"               # para buscar el token con grep -f sin ponerlo en argumentos
cat > "$AGENT_OFFICE_HOME/config.json" <<'EOF'
{ "configVersion": 2, "port": 4798, "docsRepo": "/tmp/office-docs-hook",
  "departments": { "redaccion": false, "mantenimiento": false }, "floors": {} }
EOF
cd ~/Projects/agent-office-dev
curl --version | head -1                                  # >= 7.55
bun hub/src/main.ts & HUB=$!                              # escribe $AGENT_OFFICE_HOME/headers y port
sleep 1; ls -l "$AGENT_OFFICE_HOME/headers"               # -rw------- ; contenido X-Office-Key: …

# M4. ps durante un hook no muestra ni la key ni el token. Para tener al curl vivo unos segundos,
# se apunta el hook a un puerto donde escucha nc sin responder (curl espera -m 2). HOLD hace de
# AGENT_OFFICE_HOME del hook: viene de mktemp -d (0700) y ahí caen hook.<pid> y hook.<pid>.out.
cp "$AGENT_OFFICE_HOME/headers" "$HOLD/"; echo 4799 > "$HOLD/port"
nc -l 127.0.0.1 4799 > "$HOLD/request.txt" & NC=$!
echo '{"session_id":"x","hook_event_name":"Stop"}' | CLAUDE_CODE_MESSAGING_TOKEN=$(cat "$HOLD/token.txt") \
  AGENT_OFFICE_HOME=$HOLD sh plugin/hooks/office-hook.sh & HOOK=$!
sleep 0.3
ps -o args= -p $(pgrep -n curl)                   # muestra -H @.../headers -H @.../hook.<pid>; ni la key ni el token
ps -axo args | grep -cF -f "$AGENT_OFFICE_HOME/key"   # 0: la key no está en ningún argumento (grep la lee de fichero, no la pone en los suyos)
ps -axo args | grep -cF -f "$HOLD/token.txt"          # 0: el token tampoco
ls -l "$HOLD"/hook.*                              # hook.<pid> y hook.<pid>.out, -rw------- mientras curl vive
wait $HOOK; ls "$HOLD"                            # headers port request.txt token.txt: el trap borró hook.*
kill $NC 2>/dev/null
grep -c 'X-Office-Token: secreto-token' "$HOLD/request.txt"   # 1: la cabecera sí llegó al servidor

# M4 bis. SIGTERM mientras la petición está retenida (como haría Claude Code al vencer el timeout o cerrar la sesión):
nc -l 127.0.0.1 4799 > /dev/null & NC=$!
echo '{"session_id":"x","hook_event_name":"PreToolUse","tool_name":"AskUserQuestion"}' \
  | AGENT_OFFICE_HOME=$HOLD sh plugin/hooks/office-hook.sh ask & HOOK=$!
sleep 0.3; kill -TERM $HOOK; time wait $HOOK      # vuelve en menos de 1 s (no espera los 3590 s del -m)
ls "$HOLD"/hook.* 2>/dev/null | wc -l             # 0: el trap borró los ficheros
pgrep -fl 'curl -sf' | wc -l                      # 0: el trap mató al curl
kill $NC 2>/dev/null

# M5. Un PreToolUse de Edit lanza un único curl y una única petición. En macOS /bin/sh es bash y traza
# algunos comandos con dos signos (++), así que el patrón admite uno o más. env -u quita el token y el
# socket del entorno por si la terminal es el Bash de una sesión de Claude Code: sh -x los imprimiría expandidos.
echo '{"session_id":"x","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"/tmp/a.ts"}}' \
  | env -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_MESSAGING_SOCKET sh -x plugin/hooks/office-hook.sh 2>&1 \
  | grep -c '^+* *curl '   # 1 (la traza muestra además la línea completa de curl, sin key)
# Contador de peticiones en el hub: el evento se registra una vez por petición, así que se cuenta en la BD:
sqlite3 "$AGENT_OFFICE_HOME/office.db" "select count(*) from events where session_id='x' and event='PreToolUse'"   # 1 por cada Edit enviado (hub/src/db.ts:25-36)
# Alternativa con privilegios (como la Verificación de la auditoría): sudo fs_usage -w -f exec | grep -c 'curl\|/bin/sh\|cat\|rm'
# durante una sesión de prueba con el plugin cargado desde AGENT_OFFICE_CLAUDE_HOME: por llamada a herramienta
# (PreToolUse + PostToolUse), un Read pasa de 8 procesos a 6 (2 x sh+curl+rm) y un Edit o un Bash de 12 a 6.
kill $HUB
```

Comprobaciones del revisor sobre el código: `ls plugin/hooks` (solo `hooks.json` y `office-hook.sh`); `grep -n 'headers' hub/src/config.ts hub/src/main.ts`; `grep -n "app.post('/hook'" hub/src/server.ts`; `git diff --stat` del clon no incluye `hub/src/office.ts`, `hub/src/state-machine.ts`, `hub/src/guard.ts` ni `ui/`.

## Preguntas abiertas

1. Si el usuario decide ejecutar este plan antes de que `chat-interno-agentes` llegue a `build/v1`: ¿se le pide al jefe de ese encargo que `office-chat.sh` nazca ya con `[ -r "$dir/headers" ]` y `-H @"$dir/headers"`? Es una línea en su sección 4 y evita que el primer criterio de este plan deje de cumplirse al entrar el chat.
2. ¿Se quiere que `rotate-key` reescriba también `headers` en los `AGENT_OFFICE_HOME` de otros usuarios de la máquina? No: la oficina es por usuario y `paths()` solo conoce el suyo. Se anota para que no se interprete como olvido.
3. El fichero temporal de sesión podría evitarse si Claude Code pasara el token por stdin en el JSON del evento en vez de por variables de entorno; hoy no lo hace (campos comunes documentados: `session_id`, `cwd`, `hook_event_name`, `agent_id`…). Si lo hiciera, el hook podría mandar el evento tal cual y el hub leer el token del cuerpo.
