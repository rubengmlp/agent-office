# Fase 0: resultados de los spikes

Fecha: 2026-10-15. Binarios probados: Claude Code 2.1.300 (extensión de VS Code) y 2.1.236 (el `claude` de Homebrew que usa la terminal).

Las capturas se hicieron con sesiones `claude -p` aisladas (`--setting-sources local`, modelo Haiku), con un hook `command` que vuelca stdin y un hook `http` hacia un listener local. Las fixtures recortadas que usan los tests están en `hub/test/fixtures/`.

## Resultados

| Spike | Estado | Resultado |
|---|---|---|
| 1. Formato del socket | Confirmado en vivo | Una orden del panel llega al director como mensaje de otra sesión con el prefijo `[Agent Office]` y la ejecuta |
| 2. Verde/rojo de un comando | Confirmado en 2.1.236 y 2.1.300 | Salida 0 llega por `PostToolUse`; salida distinta de 0 llega por `PostToolUseFailure` con `error: "Exit code 1"` e `is_interrupt: false` |
| 3. Roles con `--agent` | Confirmado en 2.1.292 | `--agent office:director` carga el agente del plugin y `--agent office-lead-<planta>` el de usuario; `SessionStart` trae `agent_type`, `model` y `session_title` |
| 4. Identidad de teammates y dueño de tarea | Confirmado, con cambios de diseño | Ver "Equipos en vivo" |
| 5. Topología y direccionamiento | Confirmado | El jefe escribe al director por nombre y el director al jefe; `claude agents --json` lista también sesiones interactivas |

### 1. Socket de mensajería

El binario 2.1.300 escribe en su log de depuración cómo inyectar mensajes en el inbox de una sesión. Son líneas JSON separadas por salto de línea:

```
{"type":"auth","token":"<CLAUDE_CODE_MESSAGING_TOKEN de la sesión destino>"}
{"type":"user","message":{"role":"user","content":"texto"}}
```

En macOS la línea de auth es opcional, pero con el token el mensaje cuenta como de un proceso hijo de la sesión y se entrega aunque el modo de permisos lo retuviera. Una conexión que no envía una línea completa en el plazo se cierra. `courier.ts` usa este formato.

La prueba contra el socket de la propia sesión la bloqueó el clasificador de auto mode. La prueba real se hizo desde el panel contra la sesión del director: el mensaje llegó como "Another Claude session sent a message" con el texto `[Agent Office] Orden del usuario desde el panel de la oficina: ...` y el director lo ejecutó. Para repetirla a mano desde cualquier sesión de Claude Code:

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

## Equipos en vivo (2.1.292, 2026-10-15)

Prueba con el director y el jefe de una planta de pruebas (`~/Projects/office-sandbox`) en tmux, modo de permisos auto.

- **Herramientas de tareas.** `TaskCreate` y `TaskUpdate` no aparecen ni con `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, ni con `--allowedTools`, ni con `--tools`: en `-p` el modelo recibe `TodoWrite` y el jefe interactivo no tiene ninguna. Sin lista de tareas no hay `TaskCompleted`. La puerta de tests se comprueba ahora cuando el jefe avisa al director con un mensaje que empieza por `HECHO:` (hook `PreToolUse` sobre `SendMessage`); la de `TaskCompleted` se mantiene para cuando existan.
- **Herencia de herramientas.** Una lista `tools:` en el agente del jefe limita también a sus compañeros: el desarrollador no podía escribir. La plantilla del jefe ya no lleva `tools:`.
- **Identidad.** Los compañeros in-process emiten con el `session_id` del jefe y `agent_id` = `a<nombre>-<hash>`. Su `agent_type` en los hooks es su nombre (`dev-office-sandbox`), no su tipo. El tipo real llega en la respuesta del tool `Agent` (`status: "teammate_spawned"`, `agentId`, `agent_type`, `teammate_id`, `team_name`) y en `~/.claude/teams/<equipo>/config.json` (`members[].agentType`).
- **Fin de turno.** Cada compañero emite `SubagentStop` al acabar su turno y después `TeammateIdle`; el hub lo deja libre, no terminado.
- **Mensajes.** Un compañero escribe a su jefe con `to: "team-lead"`.
- **Sugerencias de prompt.** La interfaz lanza subagentes bifurcados con el `agent_type` del jefe que solo emiten `SubagentStop`; el hub los ignora.
- **Preguntas.** Con el panel visible, `AskUserQuestion` del director sale en el panel y la respuesta vuelve como si la hubiera dado el usuario ("User answered Claude's questions"). "Devolver al terminal" y la pestaña cerrada la llevan al diálogo de la terminal.

## Versión de la terminal

El `claude` de la terminal es 2.1.236 (cask de Homebrew). Funciona todo lo que usa la fase 1, pero `agent_id` en `TaskCreated`, `TaskCompleted` y `TeammateIdle` llega a partir de 2.1.290. Antes de los spikes 3 y 4:

```sh
brew upgrade --cask claude-code
```

## Pendiente

- Probar plantas reales (mobile y backend) con tareas que editen, cuando convenga.
