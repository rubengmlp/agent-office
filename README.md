# Agent Office

Oficina visual para los agentes de Claude Code. Cada repositorio es una planta; en ella se ve quién trabaja, quién pregunta, quién está bloqueado y quién pasa los tests. Un director reparte el trabajo entre los jefes de planta, cada jefe dirige su equipo (desarrollador, tester, revisor) y desde el panel puedes contestar preguntas y dar órdenes.

El diseño aprobado está en [docs/plan.md](docs/plan.md) y los resultados de los spikes en [docs/spikes.md](docs/spikes.md).

## Requisitos

- [Bun](https://bun.sh) 1.4 o superior (`brew install oven-sh/bun/bun`).
- Claude Code 2.1.290 o superior en la terminal (`brew upgrade --cask claude-code`). Con versiones anteriores funciona la observación, pero `TaskCreated`, `TaskCompleted` y `TeammateIdle` llegan sin `agent_id`.
- `git` y `curl`. Para abrir las sesiones: tmux si está instalado; si no, Terminal de macOS.

## Puesta en marcha

```sh
bun install
bun run setup      # key, configuración, plugin y plantas
bun run build      # compila la interfaz en hub/public
bun run office     # hub + oficina en el navegador + sesiones del director y los jefes
```

`bun run setup` pregunta antes de cada paso con efecto fuera del repositorio:

- Crea `~/.config/agent-office/` con la key (permisos 600), `config.json` y el puerto.
- Registra este repositorio como marketplace local e instala el plugin `office` a nivel de usuario. Sus hooks se ejecutan en todas tus sesiones de Claude Code; si el hub no está arrancado, salen al momento sin escribir nada. Un marketplace de directorio local lee el plugin en vivo: un cambio en `plugin/` vale en la siguiente sesión o tras `/reload-plugins`.
- Ofrece convertir `~/Projects/mobile` y `~/Projects/backend` en plantas gestionadas, lo que escribe tres agentes por planta en `~/.claude/agents/`.

Aparte de las dos entradas que escribe `claude plugin` en `~/.claude/settings.json`, el marketplace en `extraKnownMarketplaces` y el plugin en `enabledPlugins`, no toca tu configuración. Agent teams y la caché de una hora se activan solo en las sesiones que abre `office.sh`.

## Plantas

| | Observada | Gestionada |
|---|---|---|
| Cómo nace | Sola, con el primer evento de un repositorio nuevo | `bun run floor add <ruta>` |
| Qué tiene | Agentes pintados en gris, sin contenido de herramientas | Jefe de planta, equipo, puerta de tests y preguntas en el panel |

```sh
bun run floor add ~/Projects/mobile             # detecta el stack y genera office-{lead,dev,tester}-mobile
bun run floor add ~/otra/ruta/mobile --slug mobile-2
bun run floor add --all                         # regenera todos los agentes tras cambiar un perfil o una plantilla
bun run floor remove mobile                     # vuelve a observada y borra sus agentes
bun run floor list
```

Los perfiles por stack (skill, comandos de test y de revisión) están en `plugin/profiles/` y las plantillas de los agentes en `plugin/templates/`.

## Uso

- La oficina vive en <http://127.0.0.1:4747>. Pestañas **Oficina** (PixiJS) y **Tabla**; el panel de la derecha muestra el agente seleccionado.
- **Preguntas**: con la pestaña visible, las `AskUserQuestion` de las sesiones de la oficina se retienen en el panel en vez de salir en la terminal. "Devolver al terminal" las suelta al momento. Con la pestaña oculta o cerrada salen en la terminal como siempre.
- **Órdenes**: el cuadro de órdenes escribe en el inbox de la sesión elegida (por defecto el director). Llegan con el prefijo `[Agent Office]`.
- **Puerta de tests**: el jefe de planta avisa al director con un mensaje que empieza por `HECHO:`. Si el desarrollador cambió ficheros y no hay tests en verde de un tester de la planta posteriores, el mensaje no sale y el jefe recibe el motivo. Con herramientas de tareas, completar una tarea pasa por la misma comprobación.
- **Bloqueos**: un agente que envía `BLOQUEADO: <qué falta> — necesito <qué> de <quién>` se pinta bloqueado hasta que vuelve a trabajar. Una pregunta sin respuesta durante 5 minutos también.
- **Demo sin sesiones**: <http://127.0.0.1:4747/?replay=/replays/demo.json>.

## Arquitectura

```
plugin/   plugin "office": hooks (emit.sh, gate.sh), director, revisor, protocolo, perfiles y plantillas
hub/      Bun + Hono + SQLite: recibe los hooks, calcula el estado de cada agente y lo emite por WebSocket
ui/       Vite + TypeScript + PixiJS: tabla, oficina, panel y replay
```

Cada hook ejecuta `plugin/hooks/emit.sh`, que hace POST del evento al hub con `curl -m 2` y reenvía en cabeceras el socket y el token de mensajería de la sesión. `AskUserQuestion` usa el mismo script contra `/ask`, que puede esperar hasta 15 minutos. `TaskCompleted` usa `gate.sh`, que sale con código 2 y el motivo cuando el hub bloquea el cierre.

### Seguridad

Una orden del panel acaba en una sesión con Bash, así que el hub se trata como ejecución remota de código:

- Escucha solo en `127.0.0.1` y comprueba la cabecera `Host` en todas las rutas (DNS rebinding).
- Todo POST exige `X-Office-Key`. La key solo viaja dentro del HTML que sirve el propio hub; no hay CORS.
- El WebSocket comprueba `Origin` y exige la key en el primer mensaje antes de 1 segundo.
- Key y base de datos con permisos 600. `bun run rotate-key` genera otra; los hooks la leen en cada evento.

### Privacidad

En plantas observadas el hub guarda solo estado, herramienta y ruta; nunca el contenido de las herramientas ni los mensajes. Los eventos se borran a los 14 días (`retentionDays` en `config.json`).

## Probado en vivo

El 2026-10-15, con Claude Code 2.1.292, en una planta de pruebas y en mobile y backend con tareas de solo lectura. Funcionaron la observación de sesiones, el equipo con desarrollador y tester, la puerta con `HECHO:` en ambos sentidos, las preguntas en el panel y su vuelta a la terminal, las órdenes desde el panel, el bloqueo y su respuesta, el encargo del director a una planta, la promoción de una planta en caliente y el hub apagado. Los detalles están en [docs/spikes.md](docs/spikes.md).

## Desarrollo

```sh
bun run test                         # tests del hub
bun run typecheck                    # hub y ui
bun run dev:hub                      # hub aceptando el origen de Vite
bun run dev:ui                       # Vite en :5173 con proxy al hub
AGENT_OFFICE_RAW=1 bun run hub       # guarda cada evento crudo en hub/test/fixtures/raw/ (no versionado)
AGENT_OFFICE_RECORD=grabacion.json bun run hub   # graba lo emitido para reproducirlo con ?replay=
```

## Cambios respecto al plan

- **Hooks `command` en vez de `http`.** Los hooks `http` funcionan (probado en 2.1.236 y 2.1.300), pero `emit.sh` lee la key de un fichero 600 sin tocar el `env` de los settings, falla en silencio con el hub apagado y siempre recibe el socket y el token de mensajería.
- **Sin `office.sh --dev`.** El plan suponía que el marketplace local copia el plugin a caché; la documentación dice que con `source` relativo lo lee en vivo. Cargarlo además con `--plugin-dir` duplicaría los hooks.
- **Variables por sesión.** `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, `CLAUDE_CODE_ENABLE_TODO_TOOLS`, `--teammate-mode in-process` y `subagentPromptCacheTtl` van en el lanzador de cada sesión de la oficina, no en `~/.claude/settings.json`. Activar agent teams globalmente cambia cómo delega Claude en todas tus sesiones.
- **Puerta con `HECHO:`.** En Claude Code 2.1.292 los modelos actuales no tienen `TaskCreate` ni `TaskUpdate` con ninguna de las vías documentadas, así que `TaskCompleted` no llega nunca. La puerta se comprueba en un hook `PreToolUse` sobre `SendMessage` cuando el jefe avisa con `HECHO:`.
- **Jefe sin lista `tools`.** Una lista `tools:` en el agente del jefe limitaba también a sus compañeros de equipo, y el desarrollador no podía escribir. El jefe no edita por instrucción, no por permisos.
- **tmux.** Si está instalado, `office.sh` abre las sesiones en `tmux attach -t agent-office`; si no, en ventanas de Terminal.
- **Preguntas de permisos.** El plan dejaba como opcional retener también `PermissionRequest`; no está hecho.
