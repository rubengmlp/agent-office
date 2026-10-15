# Fase 0: resultados de los spikes

Fecha: 2026-10-15. Binarios probados: Claude Code 2.1.300 (extensión de VS Code) y 2.1.236 (el `claude` de Homebrew que usa la terminal).

Las capturas se hicieron con sesiones `claude -p` aisladas (`--setting-sources local`, modelo Haiku), con un hook `command` que vuelca stdin y un hook `http` hacia un listener local. Las fixtures recortadas que usan los tests están en `hub/test/fixtures/`.

## Resultados

| Spike | Estado | Resultado |
|---|---|---|
| 1. Formato del socket | Formato confirmado; inyección en vivo pendiente | Ver abajo |
| 2. Verde/rojo de un comando | Confirmado en 2.1.236 y 2.1.300 | Salida 0 llega por `PostToolUse`; salida distinta de 0 llega por `PostToolUseFailure` con `error: "Exit code 1"` e `is_interrupt: false` |
| 3. Roles con `--agent` | Pendiente (necesita sesión interactiva) | |
| 4. Identidad de teammates y dueño de tarea | Pendiente (necesita sesión interactiva) | Las herramientas de tareas no aparecen en `-p`, ver abajo |
| 5. Topología y direccionamiento | Parcial | `claude agents --json` sí lista sesiones interactivas |

### 1. Socket de mensajería

El binario 2.1.300 escribe en su log de depuración cómo inyectar mensajes en el inbox de una sesión. Son líneas JSON separadas por salto de línea:

```
{"type":"auth","token":"<CLAUDE_CODE_MESSAGING_TOKEN de la sesión destino>"}
{"type":"user","message":{"role":"user","content":"texto"}}
```

En macOS la línea de auth es opcional, pero con el token el mensaje cuenta como de un proceso hijo de la sesión y se entrega aunque el modo de permisos lo retuviera. Una conexión que no envía una línea completa en el plazo se cierra. `courier.ts` usa este formato.

La prueba en vivo (mandar un mensaje al propio socket) la bloqueó el clasificador de auto mode de la sesión que construyó esto. Para hacerla a mano, desde cualquier sesión de Claude Code:

```sh
{ printf '{"type":"auth","token":"%s"}\n' "$CLAUDE_CODE_MESSAGING_TOKEN"; \
  printf '%s\n' '{"type":"user","message":{"role":"user","content":"prueba agent-office"}}'; sleep 1; } \
  | nc -U -w 2 "$CLAUDE_CODE_MESSAGING_SOCKET"
```

Si el texto aparece en esa sesión como mensaje entrante, el plan A de órdenes y despertares vale y el plan B (mod) no hace falta.

### Hooks `http`

Funcionan en 2.1.236 y en 2.1.300. Las cabeceras interpolan tanto `$CLAUDE_CODE_MESSAGING_SOCKET` como una variable definida en el bloque `env` de los settings, siempre que estén en `allowedEnvVars`. La petición llega con `Host: 127.0.0.1:<puerto>` y `User-Agent: axios/...`.

Aun así el plugin usa hooks `command` (`emit.sh`) y no `http`. Motivo: un hook `command` lee la key de `~/.config/agent-office/key` y no hace falta tocar el `env` de `~/.claude/settings.json`; además falla en silencio cuando el hub no está (sale 0 sin escribir nada) y recibe siempre `CLAUDE_CODE_MESSAGING_SOCKET` y `CLAUDE_CODE_MESSAGING_TOKEN`, que se reenvían en cada evento. Así el hub conoce el socket de cada sesión aunque estuviera apagado en su `SessionStart`.

### Payloads observados

- `SessionStart` trae `source` (`startup`). 2.1.300 añade `scratchpad_dir`, `prompt_id` y `effort`.
- Los eventos de herramienta dentro de un subagente traen `agent_id` y `agent_type`. Los de la conversación principal no traen ninguno.
- `PreToolUse` de `Agent`: `tool_input` = `{description, prompt, subagent_type}` (más `name` si Claude lo nombra).
- `PostToolUse` de `Agent` devuelve `tool_response.agentId`, que enlaza la llamada (y su `name`) con el `agent_id` de `SubagentStart`. En 2.1.300 el subagente arranca en segundo plano y este `PostToolUse` llega antes que `SubagentStart`.
- `PostToolUse` de `Bash`: `tool_response` = `{stdout, stderr, interrupted, isImage, noOutputExpected}`. No hay código de salida: el éxito es el propio evento.
- `Stop` trae `last_assistant_message` y `background_tasks` (subagentes vivos). `SubagentStop` añade `agent_transcript_path`. `SessionEnd` trae `reason`.

### Herramientas de tareas

`TaskCreate`, `TaskUpdate`, `TaskList` y `TaskGet` solo existen por defecto en Opus 4.7, Sonnet 4.6, Haiku 4.5 y anteriores (docs, "Task tool availability"). En modelos nuevos hay que optar con `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools TaskCreate` o `--tools`.

En la captura con Haiku 5.5 en `-p` no aparecieron con ninguna de las tres vías. Sin esas herramientas no hay lista de tareas compartida ni evento `TaskCompleted`, y la puerta de tests no se dispara nunca. `office.sh` exporta `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` en todas las sesiones de la oficina; el spike 4 tiene que confirmar en una sesión interactiva que el jefe de planta ve `TaskCreate`.

### Marketplace local

La documentación de marketplaces dice que un marketplace añadido desde un directorio local con `source` relativo lee los ficheros del plugin en vivo: los cambios valen en la siguiente sesión o tras `/reload-plugins`. El modo `office.sh --dev` del plan (cargar además `--plugin-dir`) no hace falta y duplicaría los hooks, así que no existe.

### 5. `claude agents --json`

Lista también las sesiones interactivas (`"kind": "interactive"`), con `sessionId`, `name`, `cwd`, `status` (`waiting`, `busy`, `idle`) y `waitingFor` (`permission prompt`, `input needed`). Sirve de plan B para el direccionamiento.

## Versión de la terminal

El `claude` de la terminal es 2.1.236 (cask de Homebrew). Funciona todo lo que usa la fase 1, pero `agent_id` en `TaskCreated`, `TaskCompleted` y `TeammateIdle` llega a partir de 2.1.290. Antes de los spikes 3 y 4:

```sh
brew upgrade --cask claude-code
```

## Spikes pendientes (sesiones interactivas)

Requieren `bun run setup` hecho y `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Con el hub arrancado (`bun run hub`), cada evento queda en `~/.config/agent-office/office.db` y, con `AGENT_OFFICE_RAW=1`, en `hub/test/fixtures/raw/`.

3. Roles: `bun run office`, o a mano `~/.config/agent-office/sessions/lead-mobile.sh`. Pedir "spawn a teammate using the office-dev-mobile agent type". Mirar `~/.claude/teams/*/config.json` y si los eventos del teammate traen `team_name` y `agent_type`. Confirmar también que `--agent office:director` arranca el agente del plugin (con prefijo) en `~/.config/agent-office/sessions/director.sh`.
4. Identidad y dueño: en esa sesión, crear una tarea, asignarla al teammate y cerrarla. Confirmar que `TaskCreate` existe, la forma de `tool_input` de `TaskUpdate` (`taskId`, `owner`, `status`) y los campos de `TaskCreated` y `TaskCompleted`.
5. Topología: director en `workspace/` y dos jefes de planta; el director escribe a `lead-mobile` por nombre. Comprobar si un teammate in-process aparece en `ListAgents` de otra sesión.
