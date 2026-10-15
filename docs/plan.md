# Agent Office — oficina visual para los agentes de Claude Code

## Contexto

Quieres ver, en una sola pantalla con metáfora de oficina, qué agentes están trabajando, cuáles tienen una pregunta pendiente, un director que reparte órdenes, trabajadores de distintas tareas que se consultan entre sí cuando se bloquean, y testers que verifican el trabajo. Debe servir para cualquier repositorio en el que trabajes (hoy `mobile` en Flutter y `backend` en Laravel), y quieres poder controlarlo todo desde la oficina: responder preguntas, dar órdenes al director y que no se cierre una tarea sin tests.

Decisiones tomadas contigo: oficina propia pintada con PixiJS, alcance "control total desde la UI", hub en Bun + Hono + SQLite, un equipo por repo con director por encima, plantas dinámicas (una por repositorio), agentes por planta generados a nivel de usuario. Revisiones v2 a v6 incorporadas (ver las secciones de cambios al final).

### Hallazgos que condicionan el diseño (docs verificadas 2026-10-15, Claude Code 2.1.300)

- **La orquestación ya existe; no se reimplementa.** Agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`): una sesión lead más teammates, lista de tareas compartida, `SendMessage` entre cualquier par, `ListAgents`, y los teammates ociosos avisan al lead solos. Las sesiones locales de distintos repos también se mensajean entre sí (cross-session messaging, socket Unix por sesión). Teammates sólo en sesiones interactivas, nunca en `-p` ni en el Agent SDK; por eso el SDK queda descartado como base.
- **Direccionamiento entre sesiones:** una sesión responde al nombre que le da `claude --name <nombre>` (flag documentado en la CLI, también `/rename`), y `SendMessage` la encuentra por ese nombre; si varias sesiones comparten nombre, `ListAgents` añade un identificador corto y el mensaje lo usa. El spike 5 confirma que `director` → `lead-mobile` llega por nombre.
- **Un teammate siempre corre en el directorio del lead.** Doc de subagentes: "the teammate then runs in the main session's working directory"; API de mods: "A teammate runs in the session's [cwd]: a rewrite is left out". No hay campo `cwd` para teammates. De ahí la topología de un equipo por repo.
- **`--add-dir` da acceso a ficheros, no carga la configuración `.claude/` de esa carpeta.** Un lead en una carpeta padre perdería los `CLAUDE.md`, skills y hooks de cada repo.
- **El lead se arranca como agente con `claude --agent <nombre>`.** Los teammates se instancian con definiciones de agente ("Spawn a teammate using the office-dev-mobile agent type"). En in-process se aplican `tools`, `model`, `disallowedTools`, `effort` y el cuerpo **se añade** al system prompt; en split-pane el cuerpo **sustituye** al system prompt y se aplican `mcpServers`. `skills` del frontmatter se ignora en teammates en ambos modos.
- **Las definiciones de agente a nivel de usuario (`~/.claude/agents/`) se leen al arrancar la sesión**, sin caché de plugin: un fichero nuevo lo ve la siguiente sesión que se abra. Es el camino para los agentes generados por planta: `floor add` escribe el fichero y el lead de esa planta se abre después.
- **Identidad de teammates:** cada teammate es una sesión completa con su propio `session_id` y sus propios hooks. El enlace con el lead es `team_name` = `session-` + 8 primeros caracteres del `session_id` del lead (lo traen `TeammateIdle`, `TaskCreated/Completed`), y `~/.claude/teams/{team}/config.json` con `members[]` (nombre, agent id, agent type; el lead lleva `team-lead`).
- **Hooks `http`:** POST del JSON del evento a una URL; `timeout` en segundos (defecto 600); `onFailure: "continue"` por defecto. 2xx con JSON = salida de hook; 2xx vacío = nada. Un hook `http` no puede "exit 2": para bloquear se usa un hook `command`.
- **Responder una pregunta desde fuera es oficial:** hook `PreToolUse` sobre `AskUserQuestion` que devuelve `permissionDecision: "allow"` con `updatedInput` = `questions` repetidas + `answers` (`{"<texto pregunta>": "<label>"}`, multi-select une labels con comas). El hook corre antes de que la pregunta se muestre: mientras se retiene, el terminal no enseña nada.
- **Puerta de tests es oficial:** hook `TaskCompleted` (`command`) que sale 2 impide completar la tarea y su stderr vuelve al modelo. Campos: `task_id`, `task_subject`, `teammate_name` (puede faltar), `team_name`, `agent_id`. Lo puede disparar el lead al marcar la tarea con `TaskUpdate`.
- **Resultado de un comando:** `Bash` con salida distinta de 0 llega por `PostToolUseFailure` con `error` que empieza por `Exit code N`; con 0 llega por `PostToolUse` con `tool_response.{stdout, stderr, interrupted}`. Se confirma con fixture en la fase 0.
- **Inyectar texto en una sesión desde fuera:** cada sesión expone su inbox como socket Unix en `CLAUDE_CODE_MESSAGING_SOCKET` (exportado a hooks antes de `SessionStart`, junto a `CLAUDE_CODE_MESSAGING_TOKEN`). Primera línea opcional `{"type":"auth","token":"…"}`; el formato de la línea de mensaje no está en la doc pública. Un mod del plugin sólo puede meter texto en la sesión donde corre (`$.session.append`); no puede invocar `SendMessage` por el modelo.
- **`tools` del frontmatter sólo acepta nombres de herramienta** (`Read, Grep, Bash`), no patrones; un `disallowedTools` con especificador como `Bash(git push *)` quita Bash entero. Para acotar comandos hay que hacerlo en el cuerpo del agente, o con `permissions.deny` en settings, que aplica a toda la sesión. Por eso el reviewer lleva `Bash` y la restricción en el cuerpo.
- **`claude agents --json`** existe (referencia de la CLI: "print active sessions as a JSON array for scripting"), pero la doc lo describe para sesiones en segundo plano (agent view); si lista también las interactivas lo confirma el spike 5.
- **Un plugin a nivel de usuario carga en todas las sesiones**, no sólo en las de la oficina. Por eso puerta y retención se limitan a las plantas gestionadas y al `agent_type` del lead, y en plantas observadas el hub no guarda `tool_input` crudo.
- **Skills disponibles para los agentes:** `laravel-senior-backend` está a nivel de usuario (`~/.claude/skills/`), así que cualquier sesión la tiene; `senior-flutter` está en `mobile/.claude/skills/`, así que sólo la tienen las sesiones cuyo cwd es `mobile`, que son justo las del equipo de esa planta. El repo `backend` no tiene `.claude/skills/`.
- **`subagentPromptCacheTtl: "1h"`** aparece literalmente en la doc de agent teams. Verificado.
- **Referencias:** [Pixel Agents](https://github.com/martinmunozhr/pixel-agents) (sprites y animaciones de inspiración) y [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) (misma tubería hooks → Bun → SQLite → WS).

## Proyecto aparte: sí

Repo nuevo `~/Projects/agent-office`, **privado en GitHub** (los prompts de agente y las fixtures describen cómo trabajamos). Herramienta de desarrollo genérica, stack TypeScript; los repos observados no necesitan ningún cambio, y los gestionados sólo que el plugin esté cargado.

El plugin es **100 % versionable y no contiene ficheros generados**: los agentes por planta viven en `~/.claude/agents/`. Durante el desarrollo se instala desde el clon local (marketplace local apuntando a `plugin/`, o `--plugin-dir`); como nada se genera dentro, una instalación desde GitHub también valdría más adelante.

## Plantas dinámicas: una por repositorio

Las plantas no están fijadas en el código. Hay dos niveles:

| | Planta observada | Planta gestionada |
|---|---|---|
| Cómo nace | Sola: el primer evento de una raíz git nueva la crea | `bun run floor add <ruta>` |
| Qué tiene | Agentes pintados, sin jefe (planta gris); sólo el evento normalizado, sin `tool_input` crudo | Jefe de planta, equipo, puerta de tests, retención de preguntas, eventos completos |
| Coste | Ninguno | Una sesión lead más, sólo si está abierta |

Cualquier sesión de Claude Code con el plugin cargado aparece en su planta observada (Kapper, un repo de pruebas, lo que sea). Sólo las plantas gestionadas tienen equipo, puerta y retención. La planta "Dirección" es la de la sesión del director y cuenta como gestionada a efectos de retención.

### `bun run floor add <ruta> [--slug <x>]` (`hub/src/floor-cli.ts`)
1. Slug: el nombre de la carpeta, o `--slug`. Si el slug ya existe en `config.json` con otra ruta, error y salida (dos carpetas `mobile` en rutas distintas se distinguen con `--slug`).
2. Detecta el stack: `pubspec.yaml` → `flutter`; `composer.json` + `artisan` → `laravel`; `package.json` → `node`; cualquier otro → `generic`.
3. Usa el perfil `plugin/profiles/<stack>.json`: `{ skill, testRegex, checkRegex, testCommand, label }`.
   - `flutter`: skill `senior-flutter`, test `flutter test`, check `flutter analyze|layering_guard|ds_guard`, comando `flutter test <ruta>`, label "Flutter".
   - `laravel`: skill `laravel-senior-backend`, test `php artisan test|phpunit|pest`, check `pint|phpstan`, comando `php artisan test --filter=<Clase>`, label "Laravel".
   - `node`: sin skill, test `vitest|jest|npm test|pnpm test|bun test`, check `eslint|prettier --check|tsc`, comando `npx vitest run <spec>`, label "Node".
   - `generic`: sin skill, test `\btest\b`, check `\blint\b`, comando "el que documente el repo", label "Genérico".
4. Genera `~/.claude/agents/office-lead-<slug>.md`, `office-dev-<slug>.md` y `office-tester-<slug>.md` a partir de `plugin/templates/{lead,dev,tester}.md.tpl` rellenando slug, ruta, label, skill y comando de test. Si ya existen, pregunta antes de sobrescribir. Nada se escribe dentro del repo.
5. Escribe la planta en `~/.config/agent-office/config.json`: `floors[<slug>] = { path, stack, managed: true }`. El hub la recoge en caliente (ver `config-watch.ts`).
6. Regenera `~/.config/agent-office/office.sh` (fuera del repo: lleva rutas de la máquina) e imprime el comando de arranque del jefe de planta: `cd <ruta> && claude --agent office-lead-<slug> --name lead-<slug>`.

`bun run floor remove <slug>` borra los tres agentes generados y marca la planta como observada; `bun run floor list` muestra plantas, stack y estado. Una planta observada se promociona con el mismo `floor add`. `bun run floor add --all` regenera los agentes de todas las plantas gestionadas: hay que ejecutarlo **tras cambiar un perfil o una plantilla**, porque `config-watch` sólo recarga las regex del hub y el `testCommand` y la skill ya están escritos en los `.md` generados.

`~/.config/agent-office/config.json` (lo escribe `setup`): `{ "floors": {}, "blockedAfterMinutes": 5, "retentionDays": 14, "port": 4747 }`. `setup` ofrece ejecutar `floor add` para `~/Projects/mobile` y `~/Projects/backend`.

## Topología: un equipo por planta gestionada, director por encima

```
director            sesión en ~/Projects/agent-office/workspace   (claude --agent office:director --name director)
  │ cross-session SendMessage por nombre
  ├─ lead-mobile    sesión en ~/Projects/mobile    (claude --agent office-lead-mobile --name lead-mobile)
  │    teammates: office-dev-mobile, office-tester-mobile, office:reviewer     ← corren en mobile con su CLAUDE.md, skills y hooks
  ├─ lead-backend   sesión en ~/Projects/backend   (claude --agent office-lead-backend --name lead-backend)
  │    teammates: office-dev-backend, office-tester-backend, office:reviewer   ← corren en backend con su CLAUDE.md, skills y hooks
  └─ lead-<slug>    una por cada planta gestionada que añadas
```

- El director (Opus) no edita código. Desglosa, manda la tarea de cada planta a su jefe por `SendMessage`, recibe los avisos de fin y resuelve bloqueos entre plantas. **La lista de plantas gestionadas se la pasa `office.sh` en el prompt inicial** (leer `~/.config` desde su cwd le haría saltar un permiso).
- Cada jefe de planta (`model: sonnet`, `effort: medium`; cada `TeammateIdle` y cada mensaje de un teammate le cuesta un turno) es el lead de su equipo: crea tareas, hace spawn de devs y testers con las definiciones generadas y del reviewer del plugin, pide un tester tras cada dev antes de cerrar.
- Consultas entre plantas (dev-mobile necesita un contrato de dev-backend): van al jefe de la otra planta, que las reenvía o contesta. Mensaje directo entre teammates de plantas distintas sólo si el spike 5 lo confirma.
- `teammateMode` fijado a **`in-process`** en settings de usuario: funciona en cualquier terminal, incluido el de VS Code, y el cuerpo del agente se añade al prompt por defecto. Aun así los cuerpos se escriben **autosuficientes** (protocolo, a quién preguntar, formato de BLOQUEADO, "al empezar invoca la skill `<skill del perfil>`" como instrucción explícita), de modo que valgan igual si un día se pasa a split-pane, donde el cuerpo sustituye al prompt.
- Planta = repo principal del `cwd` del evento: `git rev-parse --git-common-dir` resuelto a absoluto y su carpeta padre (vale igual para el checkout principal y para un worktree bajo `…/.claude/worktrees/…`), cacheado por cwd. La sesión del director cae en "Dirección". Como segunda fuente, `tool_input.file_path` y las rutas de los comandos Bash colorean la planta tocada.
- Arranque: `bun run office` levanta el hub y ejecuta `~/.config/agent-office/office.sh`, que abre el director y un lead por planta gestionada (tmux o iTerm2, una ventana por sesión) con sus flags. `office.sh --dev` arranca esas sesiones con `--plugin-dir ~/Projects/agent-office/plugin` en vez del plugin instalado: el marketplace local copia el plugin a caché, y en desarrollo cada cambio en `director.md`, `reviewer.md` o `hooks.json` exigiría `claude plugin update office` y reabrir sesiones. El marketplace queda para el uso normal. Los agentes de planta no se ven afectados porque viven en `~/.claude/agents/`.
- Alternativa descartada: un solo equipo con el lead en una carpeta padre (pierde la configuración por repo).

## Arquitectura (monorepo, 3 paquetes)

```
agent-office/
  plugin/                      plugin "office", sin ficheros generados (carga en TODAS las sesiones; puerta y retención se acotan abajo)
    .claude-plugin/plugin.json
    hooks/hooks.json           http → hub, timeout 2 s en todo salvo AskUserQuestion/PermissionRequest (900 s); TaskCompleted = command gate.sh
    hooks/gate.sh              curl -m 2 al hub; exit 2 + motivo sólo si el hub responde "block"; exit 0 si no contesta
    profiles/{flutter,laravel,node,generic}.json   skill, testRegex, checkRegex, testCommand, label
    templates/{lead,dev,tester}.md.tpl             plantillas de los agentes por planta (se materializan en ~/.claude/agents/)
    agents/director.md         model opus; tools: SendMessage, ListAgents, Read, Grep, Glob, TaskCreate/Get/List/Update; cuerpo autosuficiente
    agents/reviewer.md         tools: Read, Grep, Glob, Bash; model sonnet; effort medium; el cuerpo limita Bash a git diff/log/show; una línea por hallazgo
    skills/office-protocol/SKILL.md   el mismo protocolo que llevan los cuerpos, para la sesión principal y para leerlo
  hub/                         Bun + Hono + WebSocket nativo + bun:sqlite, bind 127.0.0.1:4747, sirve la UI compilada desde hub/public
    src/server.ts              POST /events · GET /state · WS /live · POST /answers/:id · POST /orders · POST /gate · GET / (HTML con la key inyectada)
    src/security.ts            Host ∈ {127.0.0.1:4747, localhost:4747} en todas las rutas; X-Office-Key en todo POST; WS: Origin + primer mensaje {"type":"auth","key"} en < 1 s o cierre
    src/state-machine.ts       evento crudo → transición de agente; testRegex/checkRegex vienen del perfil de la planta (bun test con fixtures reales)
    src/floors.ts              cwd → git-common-dir → planta (cache); crea la planta observada al primer evento; rutas de tool_input como segunda fuente
    src/floor-cli.ts           bun run floor add|remove|list
    src/config-watch.ts        fs.watch sobre ~/.config/agent-office/config.json y plugin/profiles/; recarga plantas y perfiles y emite "floors" por WS; no toca los .md generados (eso es floor add --all)
    src/scope.ts               ¿esta sesión/equipo es de la oficina? (planta gestionada o Dirección, y agent_type del lead office-lead-* u office:director)
    src/privacy.ts             corre DESPUÉS de state-machine; en plantas observadas deja sólo {state, tool, path}; nunca tool_input ni last_assistant_message crudos
    src/prune.ts               borra events más antiguos que retentionDays al arrancar y una vez al día
    src/courier.ts             órdenes a una sesión por su socket Unix (fase 4; plan B mod)
    src/db.ts                  events, agents, sessions (socket, token, cwd, team, agent_type), floors, questions, tasks (owner), edits, test_runs. Fichero 0600
    src/setup.ts               bun run setup: genera la key una vez (0600 en ~/.config/agent-office/key), la añade a env.AGENT_OFFICE_KEY en ~/.claude/settings.json (merge), escribe config.json por defecto, registra el marketplace local e instala el plugin desde el clon, ofrece floor add para mobile y backend. Nunca rota sola; bun run rotate-key avisa de reiniciar sesiones
  ui/                          Vite + TypeScript, build a hub/public (un solo origen, sin CORS). Primero tabla HTML (fase 2), PixiJS al final (fase 5)
    src/table/                 tabla por planta (gestionadas en color, observadas en gris): agente, rol, estado, última herramienta, pregunta pendiente, botones responder / devolver al terminal / orden
    src/office/                PixiJS: layout, cámara, plantas creadas al vuelo, mesas asignadas al vuelo (fase 5)
    src/sprites/               director (traje), jefe de planta (chaleco), dev (sudadera), tester (bata), reviewer (gafas), becario (agent_type desconocido)
    src/panel/                 lateral: timeline del agente, pregunta con formulario, caja de órdenes
    src/heartbeat.ts           cada 10 s manda {"type":"heartbeat","visible":true} sólo si document.visibilityState === "visible"
    src/replay.ts              reproduce un events.json grabado
```

Fuera del repo: `~/.claude/agents/office-{lead,dev,tester}-<slug>.md` (generados), `~/.config/agent-office/{key,config.json,office.sh,office.db}`.

### Seguridad del hub (una orden acaba en una sesión con Bash: es ejecución remota de código)
El director no tiene Bash, pero `courier.ts` puede escribir en el socket de cualquier sesión registrada, y leads y devs sí lo tienen.
- Bind sólo a `127.0.0.1`. `Host` validado en todas las rutas contra `127.0.0.1:4747` y `localhost:4747` (cierra el DNS rebinding).
- La key viaja al HTML al servirlo (`window.__OFFICE_KEY__`); no existe `GET /key`. UI y API comparten origen, sin CORS.
- Todo POST exige `X-Office-Key`. WS: key en el primer mensaje `{"type":"auth","key":…}`; sin él en 1 s, cierre; `Origin` comprobado en el handshake.
- Los hooks se identifican por `X-Office-Key`. Tokens de socket en claro, protegidos por `0600` en key y base de datos.

### Privacidad de los datos del hub
- Orden fijo: primero la máquina de estados calcula el estado con el evento completo (necesita el comando de `tool_input` para distinguir test, check o trabajo), y después `privacy.ts` recorta lo que se guarda y se emite.
- Plantas observadas: `privacy.ts` reduce cada evento a `{ts, sessionId, agentId, floor, state, tool, path}`; `tool_input`, `tool_response` y `last_assistant_message` no se guardan. El laboratorio se ve igual en una planta gris porque el estado ya venía calculado.
- Plantas gestionadas: evento completo (hace falta para la puerta, las preguntas y el panel).
- `prune.ts` borra `events` más antiguos que `retentionDays` (14 por defecto); `questions`, `tasks`, `edits` y `test_runs` de sesiones terminadas se van con la misma poda.

### Modelo de estado por agente (en el hub)

| Estado | Lo dispara | Lo pinta |
|---|---|---|
| `idle` | SessionStart, TeammateIdle, Stop | sentado, café |
| `working` | PreToolUse Edit/Write/MultiEdit/NotebookEdit (registra `edits`); Bash que no es test ni check (no registra `edits`; hueco conocido: build_runner, dart format) | teclea |
| `reading` | PreToolUse Read/Grep/Glob/WebFetch | hojea carpetas |
| `testing` | PreToolUse Bash cuyo comando matchea el `testRegex` del perfil de la planta (en planta observada o `generic`, `\btest\b`) | laboratorio; `PostToolUse` = verde, `PostToolUseFailure` = rojo; registra `test_runs` (agente, rol, repo, ts, ok) |
| `checking` | PreToolUse Bash cuyo comando matchea el `checkRegex` del perfil | sello "revisando"; no cuenta para la puerta |
| `asking` | PreToolUse AskUserQuestion, Notification `permission_prompt` | mano levantada, bocadillo "?" |
| `talking` | PreToolUse SendMessage (`to`, `message`) | línea entre mesas; ida y vuelta en < 2 min = sala de reuniones |
| `blocked` | mensaje con prefijo `BLOQUEADO:` o `asking` sin respuesta > `blockedAfterMinutes` | rojo, candado |
| `done` / `failed` | SubagentStop, TaskCompleted, SessionEnd | check / cruz, se va |

Identidad: `agent_id` (o `session_id` para la sesión principal); padre = sesión o `parentAgentId`; para teammates, lead = sesión cuyo id empieza por los 8 caracteres de `team_name`; planta = repo principal; rol = `agent_type` (`office-dev-<slug>`, `office:reviewer`, etc.; otro, becario). Antirrebote de 400 ms a `reading`/`working` en la UI; el hub guarda cada transición tal cual.

### Dueño de una tarea
Se registra en `tasks` a partir de `PreToolUse` de `TaskCreate` y `TaskUpdate` (`tool_input` trae `taskId`, `owner`, `status`; el `agent_id` del evento es quien reclama). En `TaskCompleted` el dueño sale de `tasks`, con `teammate_name` como respaldo; nunca del `agent_id` del evento, que puede ser el lead cerrando con `TaskUpdate`.

### Puerta de tests: "con tester"
`TaskCompleted` → `gate.sh` → `POST /gate {task_id, team_name}`. El hub:
1. Si la planta del equipo no es gestionada, o el lead del `team_name` no tiene `agent_type` `office-lead-*` → `pass` (plantas observadas y equipos ajenos a la oficina nunca se bloquean).
2. Si el dueño no tiene `edits` en ese repo → `pass` (investigación, revisión).
3. Si existe un `test_run` verde de un agente con rol `office-tester-*` en el mismo repo posterior a la última edición del dueño → `pass`.
4. Si no → `block` con motivo "falta tester: <último test del dev no vale>". Los prompts de leads y director dicen lo mismo: un test del propio dev no cierra la tarea.
Si `curl` falla o tarda más de 2 s, `gate.sh` sale 0.

Huecos conocidos (aceptados en v1): los cambios hechos por Bash (`build_runner`, `dart format`) no cuentan como `edits`; con dos devs en el mismo repo, un test verde del tester para la tarea de A también desbloquea la de B si es posterior a la última edición de B.

### Retención de preguntas
El hook de `AskUserQuestion` (timeout 900 s) llega al hub. El hub retiene sólo si se cumplen las tres: la sesión pertenece a la oficina (`scope.ts`: su lead o ella misma es `office-*`/`office:*`), su planta es gestionada o es Dirección, y algún cliente WS mandó un latido con `visible: true` en los últimos 30 s. Si no, 200 vacío al instante y la pregunta sale en el terminal como siempre. Mientras retiene: la emite por WS, el panel la muestra con "responder" (devuelve el JSON oficial con `answers`) y "devolver al terminal" (200 vacío). Si los latidos cesan 30 s o vence el timeout, libera. Una respuesta al panel después de liberar recibe `409` y la UI muestra "ya se contestó en el terminal". Mismo mecanismo opcional para `PermissionRequest`.

### Coste
Director (Opus) + por cada planta gestionada abierta: jefe (Sonnet) + dev + tester + reviewer. Con dos plantas, 9 contextos: 1 + 2 × 4. El reviewer no puede compartirse entre plantas porque un teammate vive en el cwd de su lead. Testers y reviewer: `model: sonnet`, `effort: medium`, `tools` mínimas, un comando de test por tarea, informe de 10 líneas. Devs: el modelo que diga el jefe de planta en el spawn. `subagentPromptCacheTtl: "1h"` en settings de usuario. Las plantas observadas no cuestan nada.

## Fases

### Fase 0 — Repo, esqueleto mínimo y spikes (un día). Cada spike deja una fixture recortada en `hub/test/fixtures/`
0. **Repo:** `git init ~/Projects/agent-office && cd ~/Projects/agent-office && gh repo create agent-office --private --source . --push`. `.gitignore` raíz con `hub/test/fixtures/raw/`, `hub/public/`, `node_modules/`.
0b. **Esqueleto del plugin y del CLI** (lo que los spikes necesitan): `plugin.json`, `agents/director.md`, perfiles `flutter` y `laravel`, plantillas de una línea de cuerpo con frontmatter `model`/`tools`, `floor-cli.ts` mínimo que escriba `~/.claude/agents/office-lead-mobile.md` y `office-dev-mobile.md`, `setup.ts` mínimo que registre el marketplace local e instale el plugin; un hook `command` que vuelca stdin a `hub/test/fixtures/raw/<evento>-<ts>.json` (lleva `last_assistant_message`, `tool_input` con código de los repos y rutas de transcript, por eso no se versiona; al repo sólo van las fixtures recortadas a los campos que usan los tests).
1. **Socket de mensajería:** dos sesiones; una manda `SendMessage` a la otra; capturar la línea con un socket espejo (`socat UNIX-LISTEN:…`). Probar también meter texto en el lead y ver si lo reenvía a un teammate in-process con `SendMessage`. Si el formato no sale en 2 horas, el plan B (mod con `$.session.append`) pasa a ser el plan A para órdenes y despertares.
2. **Resultado verde/rojo:** `flutter test` que pasa y uno que falla; confirmar `PostToolUse` vs `PostToolUseFailure` y qué trae `tool_response`.
3. **Roles por el camino real:** plugin instalado por `setup` (marketplace local, no `--plugin-dir`) y agentes generados en `~/.claude/agents/`; `cd ~/Projects/mobile && claude --agent office-lead-mobile`; pedir "spawn a teammate using the office-dev-mobile agent type"; confirmar en `~/.claude/teams/*/config.json` el agent type y que sus hooks traen `team_name`; comprobar que el `SessionStart` del lead trae su `agent_type` (lo necesita `scope.ts`; si no, leerlo de `config.json` del equipo). Confirmar que un `floor add` nuevo lo ve la siguiente sesión sin reinstalar nada.
4. **Identidad y dueño:** grabar `SessionStart`, `TeammateIdle`, `TaskCreated/Completed`, `PreToolUse` de `TaskUpdate` de un teammate; confirmar el enlace con el lead y el `owner` en `tool_input`.
5. **Topología y direccionamiento:** director en `workspace/` con `--name director`, lead-mobile y lead-backend en sus repos con `--name`; el director manda una tarea a cada lead por `SendMessage` y se confirma que llega por nombre; confirmar el `cwd` de los hooks de cada teammate; y si un teammate in-process aparece en `ListAgents` de otra sesión (mensaje directo entre plantas) o no (todo pasa por los jefes). Si `--name` no bastara, `office.sh` lee los ids con `claude agents --json` y se los pasa al director en el prompt inicial; confirmar en este mismo spike que ese comando lista las sesiones interactivas y no sólo las de segundo plano (si no, leer los ids de `~/.claude/teams/*/config.json` o del `SessionStart` que recibe el hub).

### Fase 1 — Hub + plugin de hooks (observar). 1-2 días
6. Scaffold: `bun init` en `hub/` y `ui/`; `bun run setup` (marketplace local, plugin desde el clon, `floor add` para mobile y backend, `office.sh` en `~/.config/agent-office/`).
7. Hub: esquema normalizado `{ts, sessionId, agentId, parentId, repo, floor, role, state, detail}`; `state-machine.ts` (regex por perfil), `floors.ts` (git-common-dir, plantas observadas al vuelo), `floor-cli.ts` (slug, colisión, stack), `config-watch.ts`, `scope.ts`, `privacy.ts`, `prune.ts`, `security.ts` con `bun test` sobre las fixtures de la fase 0.
8. `hooks/hooks.json`: hooks `http` a `http://127.0.0.1:4747/events` con `timeout: 2`, cabeceras `X-Office-Key: $AGENT_OFFICE_KEY`, `X-Office-Socket: $CLAUDE_CODE_MESSAGING_SOCKET`, `X-Office-Token: $CLAUDE_CODE_MESSAGING_TOKEN` y `allowedEnvVars` para las tres. `AskUserQuestion` y `PermissionRequest` con `timeout: 900`. `TaskCompleted` como `command` → `gate.sh`.
9. Sesión en `mobile` con el plugin, un `Agent`, ver `SubagentStart/Stop` en el hub; sesión en un repo cualquiera sin `floor add`, ver nacer su planta observada con eventos reducidos.

### Fase 2 — Tabla en vivo (depurar). Medio día
10. Página servida por el hub: tabla por planta (gestionadas en color, observadas en gris) con agente, rol, estado, última herramienta, pregunta pendiente, botones. Latido de visibilidad. Las plantas llegan por WS y se actualizan al vuelo. Queda como vista alternativa.

### Fase 3 — El reparto (orquestar). 1-2 días
11. Cuerpos completos y autosuficientes de `director.md`, `reviewer.md`, las tres plantillas y `skills/office-protocol`; regenerar los agentes de las plantas con `floor add --all` (pide confirmación para sobrescribir).
12. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, `teammateMode: "in-process"` y `subagentPromptCacheTtl: "1h"` en settings de usuario; `office.sh` que abre director (con la lista de plantas en el prompt inicial) y un lead por planta gestionada. Durante esta fase se usa `office.sh --dev` para que los cambios en el plugin se vean sin reinstalar.
13. Prueba real: tarea que toca un endpoint en `backend` y su consumo en `mobile`; el director reparte; dev-mobile pregunta por el contrato; tester corre; cada lead cierra; el director sintetiza. Grabar `events.json` para `replay.ts`.

### Fase 4 — Control desde la oficina. 2-3 días
14. Retención de `AskUserQuestion` según la regla de arriba; `POST /answers/:id` (409 si ya liberada).
15. Puerta de tests según la regla de arriba; `POST /gate`.
16. Órdenes al director: `courier.ts` con el formato confirmado en el spike 1 (o plan B: mod `hooks/register.tsx` con long-poll a `GET /orders?session=` y `$.session.append`; `claude plugin validate plugin/`).
17. Despertar bloqueados: la respuesta del colega se entrega al lead de la planta del bloqueado, y el prompt del lead dice reenviarla por `SendMessage` al teammate.

### Fase 5 — La oficina PixiJS (pintar). 2-4 días
18. Layout: despacho acristalado del director; una planta por repositorio creada al vuelo (gestionadas con mesa del jefe y color; observadas en gris, sin jefe), mesas asignadas al vuelo; laboratorio; sala de reuniones; café.
19. Sprites por rol, animación por estado, bocadillos, líneas de conversación, panel lateral. Contra `replay.ts` con el `events.json` de la fase 3.
20. Opcional: panel SVG dentro de VS Code (surface `vscode` del mod).

## Verificación de punta a punta
- `bun test` en `hub/`: máquina de estados con regex por perfil; `floors` (checkout principal, worktree por git-common-dir, workspace del director, planta observada nueva al primer evento); `floor-cli` (slug por carpeta y por `--slug`, error por colisión, detección de stack por fixtures de carpetas, agentes generados en una carpeta `HOME` falsa con los valores del perfil, `remove` deja la planta observada); `config-watch` (editar config.json en el test cambia las plantas en memoria y emite por WS); `scope` (planta gestionada con lead `office-lead-*` → oficina; planta observada o equipo de otro proyecto → fuera); `privacy` (evento de planta observada sin `tool_input`); `prune` (eventos más viejos que `retentionDays` desaparecen); `security` (Host inválido → 403; POST sin key → 401; WS sin auth en 1 s → cierre); retención (sesión ajena → libera; planta observada → libera; Dirección → retiene; sin latido visible → libera; con latido → retiene; botón devolver → libera; respuesta tardía → 409); `gate` (planta observada → pass; equipo ajeno → pass; sin ediciones → pass; edición y test verde del propio dev → block; test verde de `office-tester-*` del repo → pass; dueño desde `tasks` aunque cierre el lead; hub caído → `gate.sh` sale 0).
- Hub colgado a propósito (`sleep` en el handler): un `PreToolUse` no tarda más de 2 s; `gate.sh` deja cerrar.
- Sesión de otro proyecto (Kapper) con el plugin cargado: aparece en una planta gris; en SQLite no hay `tool_input` suyo; sus `AskUserQuestion` salen en el terminal sin demora y sus tareas cierran sin puerta.
- Pestaña de la oficina en segundo plano: una `AskUserQuestion` de la oficina sale en el terminal sin demora.
- CSRF y rebinding: desde otro origen, `fetch('http://127.0.0.1:4747/orders', {method:'POST'})` falla; `curl -H 'Host: evil.test:4747' …` recibe 403.
- Sesiones reales: lead-mobile en `mobile` y lead-backend en `backend` a la vez, cada uno en su planta; un `SendMessage` entre ambos dibuja la línea; un teammate en worktree cae en la planta de su repo.
- `floor add` sobre un tercer repo con el hub en marcha: la planta pasa de gris a color en la UI sin reiniciar el hub; la siguiente sesión `claude --agent office-lead-<slug>` arranca con el agente generado sin reinstalar el plugin.
- Cerrar una tarea con ediciones y sólo con el test del dev: bloqueada con motivo; tras un test verde del tester: cierra.
- Orden escrita en el panel: llega al terminal del director como `Message from @office`.

## Fuera de alcance / no recomendado
- Agent SDK como base (pierde agent teams y `AskUserQuestion` en subagentes).
- Un solo equipo en carpeta padre (pierde la configuración por repo).
- Laravel + Reverb para el hub.
- Tocar código de producto en los repos observados o gestionados.

## Cambios respecto a v3
- Puerta y retención acotadas a la oficina: `scope.ts` por `agent_type` del lead y plantas gestionadas.
- Fase 0 arranca con un esqueleto mínimo del plugin para que los spikes 3 y 5 no dependan de la fase 1.
- `teammateMode` fijado a `in-process`; cuerpos de agente autosuficientes en cualquier caso; "invoca la skill X" como instrucción explícita del cuerpo, no frontmatter.
- Puerta "con tester": el `test_run` verde debe venir de un tester del mismo repo; prompts y hub dicen lo mismo.
- Direccionamiento por `--name` recogido en hallazgos; spike 5 lo confirma y tiene plan B (`claude agents --json`).
- Leads con `model: sonnet`, `effort: medium`; director con Opus.
- `POST /answers/:id` devuelve 409 tras liberar; la UI avisa.

## Retoques v4.1
- Retención por defecto incluye la planta del director.
- Cabecera de seguridad: "una orden acaba en una sesión con Bash".
- `hub/test/fixtures/raw/` en `.gitignore`; al repo sólo fixtures recortadas.
- Verificado en la doc: `tools` no acepta patrones; el reviewer lleva `Bash` con la restricción en el cuerpo. `claude agents --json` existe; qué sesiones lista se confirma en el spike 5.

## Cambios respecto a v4.1 (v5)
- Repo en GitHub, privado, creado en el paso 0 de la fase 0.
- Plantas dinámicas, una por repositorio, en dos niveles: observada y gestionada. `bun run floor add` con detección de stack y perfiles. Desaparecen las plantas fijas mobile/backend y el vestíbulo.
- La máquina de estados usa las regex del perfil de la planta.

## Cambios respecto a v5 (v6)
- **Agentes generados a nivel de usuario (opción B):** `floor add` escribe `~/.claude/agents/office-{lead,dev,tester}-<slug>.md`; el plugin queda 100 % versionable, sin `.gitignore` de agentes ni dependencia de la caché de plugins. `scope.ts` y la puerta matchean `office-lead-*` / `office-tester-*` (nivel de usuario) y `office:director` / `office:reviewer` (plugin). El spike 3 prueba el camino real (`setup` + marketplace local, no `--plugin-dir`) y que un `floor add` nuevo lo ve la siguiente sesión sin reinstalar.
- **Coste corregido:** con dos plantas son 9 contextos (1 + 2 × 4); el reviewer es uno por planta y no puede compartirse.
- **`office.sh` fuera del repo:** se genera en `~/.config/agent-office/office.sh` porque lleva rutas de la máquina.
- **`config-watch.ts`:** el hub vigila `config.json` y `plugin/profiles/` con `fs.watch`, recarga plantas y perfiles y emite `floors` por WS; así una planta pasa de gris a color sin reiniciar.
- **Privacidad:** en plantas observadas sólo se guarda el evento normalizado (`privacy.ts`); `prune.ts` poda `events` por `retentionDays` (14).
- **Menores:** `floor add --slug` y error por colisión; worktrees por `git rev-parse --git-common-dir`; el director recibe las plantas sólo por el prompt inicial de `office.sh`; hueco de la puerta con dos devs en el mismo repo anotado junto al de `build_runner`.

## Retoques v6.1
- `office.sh --dev` arranca las sesiones con `--plugin-dir` para editar el plugin en la fase 3 sin `claude plugin update` ni reabrir sesiones; el marketplace local queda para el uso normal.
- Orden fijo en el hub: la máquina de estados ve el evento completo y después `privacy.ts` recorta lo que se guarda; así el laboratorio también se ve en plantas observadas.
- `floor add --all` regenera los agentes de todas las plantas gestionadas; obligatorio tras cambiar un perfil o una plantilla, porque `config-watch` no toca los `.md`. `--all` sobrescribe sin preguntar (ya es una orden explícita); `floor add <ruta>` sobre una planta existente sigue pidiendo confirmación salvo `--yes`.
