# Historial de `key-token-hook-unico`

## Ronda 4 — APROBADO, nota 8/10

El plan no se toca (cualquier cambio invalidaría la aprobación). El revisor deja cinco notas menores para quien lo ejecute:

1. `hook.<pid>.out` no existe mientras `curl` espera (`-o` crea el fichero al primer byte): el test «Ficheros de sesión» y la receta M4 deben comprobar solo `hook.<pid>` durante la espera.
2. En el test de `SIGTERM`, comprobar `req.signal.aborted` en el servidor falso, no `pgrep -P` (el `curl` huérfano cambia de padre).
3. Dos carreras pequeñas: poner `trap EXIT` antes de crear `hook.$$` y `trap HUP INT TERM` antes del `curl … &`, con `curl_pid=` vacío y `[ -n "$curl_pid" ] && kill "$curl_pid"` en el trap.
4. `README.md:26` podría mencionar `headers` junto a la key.
5. `config-watch.ts:30-35` vigila `p.home`: cada `hook.<pid>` dispara un evento de `fs.watch` que el filtro descarta; sin efecto hoy, a tener en cuenta si cambia el filtro.

## Ronda 3 — MEJORAR, nota 7/10

Aplicados los seis puntos:

1. (bloqueante) El `curl … @- &` leía de `/dev/null` (stdin de una lista asíncrona sin control de trabajos). Ahora `exec 3<&0` y `<&3`; motivo en Diseño §2 y §3; los tests de `ask`, `permission`, `gate-message` y `TaskCompleted` comprueban el cuerpo recibido.
2. (menor) `2>/dev/null` delante de las redirecciones de entrada en el `read` del puerto (tres scripts) y en el `done < "$resp"`.
3. (menor) `runHook` envuelve `ingest` en `try/catch` con `onError`, para que la guardia no dependa de la ingesta; test con `office` falso.
4. (menor) Cuentas de procesos por llamada a herramienta: Read 8 → 6, Edit/Bash 12 → 6, también en la receta de `fs_usage`.
5. (menor) Convivencia: si existe `office-chat.sh`, los tests del chat que preparan `key` escriben también `headers` (lista de ficheros y paso 5).
6. (menor) Riesgo del fichero huérfano corregido: `touchSession` conserva socket/token/rol/nombre anteriores (`office.ts:1258-1264`); solo se pierde algo si cae en `SessionStart`.

Rechazados: ninguno.

## Ronda 2 — MEJORAR, nota 7/10

Aplicados los cinco puntos:

1. (bloqueante) `set -C` no protege contra una FIFO ajena en `/tmp`: los ficheros de sesión pasan a `$dir/hook.$$` y `$dir/hook.$$.out`, dentro de la carpeta de la oficina (0700). Adaptados el test «Ficheros de sesión» de `hooks.test.ts`, la receta manual (todo en `$HOLD`, sin `export TMPDIR`) y Riesgos.
2. (menor) Señales: corregido el razonamiento (un trap no se ejecuta hasta que acaba el comando en primer plano); `curl` pasa a segundo plano con `wait`, y el trap de `HUP INT TERM` mata al `curl` y sale. La respuesta va a `$resp` y se lee con `read` (builtin). Test de `SIGTERM` con petición retenida en `hooks.test.ts` y «M4 bis» en la receta manual.
3. (menor) `2>/dev/null` antes de `> "$session"` en el `printf`.
4. (menor) La frase «reinicia el hub antes de abrir sesiones» entra en el cambio de `README.md:146`.
5. (menor) `env -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_MESSAGING_SOCKET` delante del `sh -x` de la receta de M5.

Rechazados: ninguno.

## Ronda 1 — MEJORAR, nota 6/10

Aplicados los siete puntos:

1. (bloqueante) `read -r port … || port=` borraba el puerto si `port` no acaba en salto de línea (`usage.test.ts:131,138,143`). Ahora `port=; read -r port < …; [ -n "$port" ] || port=4747` en los tres scripts, y un caso en `hooks.test.ts` con `port` sin salto final.
2. (bloqueante) `README.md:181` también nombraba `emit.sh`: añadido a la lista de ficheros, a la sección 7 y al paso 6.
3. (bloqueante) Receta manual: PIDs con `$!` en vez de `%N`; `HOLD` creado antes de cambiar `TMPDIR`; `grep -cF -f fichero` para buscar la key y el token sin ponerlos en argumentos; patrón `'^+* *curl '` porque `/bin/sh` de macOS es bash y traza `out=$(curl …)` con `++`.
4. (menor) Pasos: `typecheck` en rojo tras el paso 1 (import de `writeHeaders`) y en verde desde el 2; el test de `hookResponse` pasa al paso 3.
5. (menor) Test de `/hook` con inyección: reutiliza el caso de `server-v2.test.ts:80` (lead-mobile con `addLesson` previo); sin lección la respuesta sería `pass`.
6. (menor) `trap 'rm -f …' EXIT` y `trap 'exit 0' HUP INT TERM`, para que el shell muera con la señal como hoy y el `exit` dispare el borrado.
7. (menor) `writeHeaders` escribe siempre con `writeAtomic` (corrige permisos de un fichero previo con 644); test con `chmodSync 0o644`.

Rechazados: ninguno.

## Ronda 1 (envío original)

Enviada a revisión. Plan escrito sobre agent-office-dev build/v1 @ 7c89614, a partir de los hallazgos S3 y P1 y las mejoras M4 y M5 de `auditoria-agent-office.md`. Decisiones propias que no estaban literalmente en el brief: la respuesta de `/hook` va en texto (`pass`/`block:` más el JSON de inyección) y no en JSON, para que `sh` la lea sin procesos extra; la composición ingesta + guardia + puerta vive en `hub/src/hook.ts` y no en `office.ts`, para no chocar con `chat-interno-agentes`; `TaskCompleted` pasa también por `/hook`; el hub escribe `headers` al arrancar para que la copia en vivo no necesite `bun run setup` tras el pull.
