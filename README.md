# Agent Office

Oficina visual para los agentes de Claude Code. Cada repositorio es una planta; en ella se ve quién trabaja, quién pregunta, quién está bloqueado y quién pasa los tests. Un director reparte el trabajo entre los jefes de planta, cada jefe dirige su equipo (desarrollador, tester, revisor) y desde el panel puedes contestar preguntas y dar órdenes.

Dos departamentos completan la oficina: **Redacción** escribe planes que un revisor nuevo devuelve ronda a ronda hasta aprobarlos, y **Mantenimiento**, en un edificio anexo, crea skills de Claude Code y las instala donde decidas. Cada rol tiene su modelo y su esfuerzo, elegidos en la pestaña Ajustes, y cada agente tiene un informe de lo que ha hecho y una memoria de lecciones que hereda quien ocupe su puesto.

Diseños aprobados: [v1](docs/plan.md) y [v2](docs/plan-v2.md). Resultados de los spikes: [docs/spikes.md](docs/spikes.md). Personajes 3D: [docs/assets.md](docs/assets.md).

## Requisitos

- [Bun](https://bun.sh) 1.4 o superior (`brew install oven-sh/bun/bun`).
- Claude Code 2.1.290 o superior en la terminal (`brew upgrade --cask claude-code`). Con versiones anteriores funciona la observación, pero `TaskCreated`, `TaskCompleted` y `TeammateIdle` llegan sin `agent_id`.
- `git` y `curl`. Para abrir las sesiones: tmux si está instalado; si no, Terminal de macOS.

## Puesta en marcha

```sh
bun install
bun run setup      # key, configuración, plugin y plantas
bun run build      # compila la interfaz en hub/public
bun run office     # hub + oficina en el navegador + sesiones del director, los jefes y los departamentos
```

`bun run setup` pregunta antes de cada paso con efecto fuera del repositorio:

- Crea `~/.config/agent-office/` con la key (permisos 600), `config.json` y el puerto.
- Registra este repositorio como marketplace local e instala el plugin `office` a nivel de usuario. Sus hooks se ejecutan en todas tus sesiones de Claude Code; si el hub no está arrancado, salen al momento sin escribir nada. Un marketplace de directorio local lee el plugin en vivo: un cambio en `plugin/` vale en la siguiente sesión o tras `/reload-plugins`.
- Ofrece convertir `~/Projects/mobile` y `~/Projects/backend` en plantas gestionadas, lo que escribe tres agentes por planta en `~/.claude/agents/`.
- Crea el repositorio de documentos `~/Projects/office-docs` (`docsRepo` en `config.json`) con `redaccion/planes/` y `taller/skills/`, y un primer commit.
- Escribe en `~/.claude/agents/office-*.md` todos los agentes de la oficina (director, revisor y departamentos incluidos) con el modelo y el esfuerzo de su rol. Una configuración de v1 se completa con los valores por defecto sin perder sus plantas.

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

También se dan de alta y se borran desde **Ajustes → Proyectos**, sin reiniciar el hub. El panel exige la carpeta raíz de un repositorio git; `bun run floor add` es más permisivo y acepta cualquier carpeta. Borrar desde el panel elimina la planta de `config.json`, sus agentes y su lanzador, todo lo que la oficina guarda de ella en `office.db` y sus fotos de Redacción; el repositorio no se toca. Se rechaza mientras haya sesiones abiertas en la planta.

Los perfiles por stack (skill, comandos de test y de revisión) están en `plugin/profiles/` y las plantillas de los agentes en `plugin/templates/`. Cada planta gestionada tiene una rama base (`baseBranch`, por defecto `develop` si existe en `origin`) que es la que lee Redacción.

## Ajustes: modelo y esfuerzo por rol

La pestaña **Ajustes** edita `config.json`: el modelo (`opus`, `sonnet`, `haiku`, `fable`, `inherit` o un id completo) y el esfuerzo (`low` a `max`) de cada rol, los departamentos activos, el número máximo de rondas de revisión, los topes de la memoria y la rama base de cada planta. Al guardar, el hub regenera los agentes de `~/.claude/agents/` y los lanzadores; vale para las sesiones y los equipos nuevos, y las sesiones abiertas siguen igual hasta que las reinicias con `bun run office`.

| Rol | Por defecto | Por qué |
|---|---|---|
| Director | fable · xhigh | Reparte entre plantas y fija los contratos que comparten: un error se propaga a todas. Es una sola sesión larga. |
| Jefes (plantas y departamentos) | sonnet · medium | Coordinan, reparten piezas ya decididas y vigilan las puertas. |
| Desarrolladores | opus · high | Cambios en varios ficheros de código real, donde un fallo cuesta de detectar. |
| Testers | sonnet · medium | Ejecutan los tests que pide el jefe y resumen el resultado. |
| Revisores de código | opus · high | Buscan fallos y problemas de seguridad que se escaparían. |
| Redactores | fable · xhigh | Diseñan el plan, que es la decisión de la que depende todo lo demás. |
| Revisores de planes | sonnet · xhigh | Otro modelo que el redactor y revisión a fondo; en la prueba en vivo encontró un bloqueante real. |
| Artesanos de skills | sonnet · medium | Siguen `skill-creator` sobre un brief cerrado. |
| Revisores de skills | opus · high | Revisan scripts que se instalarán en tus sesiones: es revisión de seguridad. |

El esfuerzo sigue el que tienes por modelo en `~/.claude/settings.json` (xhigh para Fable, high para Opus, medium para el resto), salvo el revisor de planes. Fable va solo donde una mala decisión se propaga a todo lo demás: el director y los redactores. Haiku no es el valor por defecto de ningún rol. Todo se puede cambiar en Ajustes.

Los lanzadores pasan además `--model` y `--effort` al director y a los jefes, y los jefes no nombran modelo al lanzar compañeros: manda el agente generado.

## Departamentos

**Redacción** (`lead-redaccion`, en `office-docs/redaccion`):

1. El director o tú le encargáis un plan. El jefe prepara las fuentes con `plugin/scripts/office-sync.sh <slug> <planta>…`: el hub hace `git fetch` de la rama base de cada planta y crea un worktree desacoplado en `redaccion/.fuentes/<slug>/<planta>/`. Nunca hace `pull` ni `checkout` en tu copia de trabajo.
2. El redactor escribe `redaccion/planes/<slug>.md` y pide `REVISAR:`. Un revisor nuevo por ronda contesta `MEJORAR:` con puntos `bloqueante:` o `menor:`, `APROBADO:` cuando no quedan bloqueantes o `SIN ACUERDO:` en la última ronda.
3. El hub hace un commit del plan en `office-docs` en cada ronda, con `git commit --only` para no arrastrar lo que tengas preparado.
4. El `HECHO:` del redactor y el del jefe solo salen si hay un `APROBADO:` de esa ruta posterior al último cambio del fichero. Al entregar, el hub retira los worktrees; tras la aprobación avisa si la rama base ha avanzado.

**Mantenimiento** (`lead-mantenimiento`, en `office-docs/taller`, edificio anexo):

1. El jefe comprueba que el nombre de la skill está libre y lanza un artesano, que la escribe con la skill `skill-creator` en `taller/skills/<nombre>/`.
2. Mismo bucle de rondas con un revisor de skills, que además lee los scripts incluidos.
3. Con la aprobación, el jefe te pregunta dónde instalarla (`~/.claude/skills/<nombre>` o `.claude/skills/<nombre>` de una planta) y copia solo esa carpeta.

Los lanzadores de los departamentos comprueban `GET /health` y no abren la sesión sin hub, porque sin hub no hay guardia.

## Memoria e informes

- Un agente que aprende algo envía `LECCIÓN: …` a su jefe. El hub la guarda para la pareja planta y rol, sin duplicados y con tope por sesión, y poda las más antiguas de origen agente; las que añades desde el panel no se podan.
- Al arrancar, cada agente de la oficina recibe por hook las lecciones de su puesto y una línea de cada uno de los tres últimos informes, como contexto y con un tope de caracteres.
- El panel muestra el **Informe** del agente seleccionado (ficheros, tests, veredictos, mensajes, preguntas, bloqueos, lecciones y cierre) y la **Memoria** de su puesto, donde puedes añadir y borrar lecciones.

## Uso

- La oficina vive en <http://127.0.0.1:4747>. Pestañas **Oficina**, **Tabla** y **Ajustes**; el panel de la derecha muestra el agente seleccionado. La oficina 3D está en <http://127.0.0.1:4747/?view=3d>; la 2D (PixiJS) sigue siendo la vista por defecto hasta que la 3D esté a la par.
- **Idioma**: el selector de la cabecera cambia todo el panel entre español e inglés al momento. La elección se guarda en el navegador (`localStorage`); sin elegir, el panel sale en español. Los textos que llegan del hub y de los agentes (actividad, notas de guardado, errores, preguntas, títulos de documentos) siguen en español.
- **Ayuda**: la Tabla tiene una leyenda desplegable con las columnas, los estados, los chips, los estados de los documentos y las alertas, y recuerda si la cierras. En Ajustes, cada rol, el bloque de modelos y esfuerzos, cada destino de permisos, cada planta y cada dato del hub llevan una línea que explica para qué sirven.
- **Entregables**: al seleccionar un agente de Redacción o Mantenimiento, el panel lista sus planes o skills con estado, ronda, nota, base y avance de la rama, y los abre en un visor de markdown.
- **Preguntas**: con la pestaña visible, las `AskUserQuestion` de las sesiones de la oficina se retienen en el panel en vez de salir en la terminal. "Devolver al terminal" las suelta al momento. Con la pestaña oculta o cerrada salen en la terminal como siempre.
- **Órdenes**: el cuadro de órdenes escribe en el inbox de la sesión elegida (por defecto el director). Llegan con el prefijo `[Agent Office]`.
- **Puerta de tests**: el jefe de planta avisa al director con un mensaje que empieza por `HECHO:`. Si el desarrollador cambió ficheros y no hay tests en verde de un tester de la planta posteriores, el mensaje no sale y el jefe recibe el motivo. Con herramientas de tareas, completar una tarea pasa por la misma comprobación.
- **Permisos**: con la pestaña visible, las peticiones de permiso de las sesiones de la oficina también salen en el panel, con Permitir, Denegar y Devolver al terminal. La terminal sigue mostrando el diálogo: vale la primera respuesta.
- **Modo de permisos**: en Ajustes eliges con qué modo se abre cada sesión: el director, cada planta y cada departamento. Los modos son automático, manual, aceptar ediciones, plan o no preguntar, y su equipo lo hereda.
- **Bloqueos**: un agente que envía `BLOQUEADO: <qué falta> — necesito <qué> de <quién>` se pinta bloqueado hasta que vuelve a trabajar. Una pregunta sin respuesta durante 5 minutos también.
- **Demo sin sesiones**: <http://127.0.0.1:4747/?replay=/replays/demo.json> (añade `&view=3d` para la 3D).

## Arquitectura

```
plugin/   plugin "office": hooks (emit.sh, gate.sh, guard.sh), office-sync.sh, protocolo, perfiles y plantillas de todos los agentes
hub/      Bun + Hono + SQLite: estado de los agentes, puertas, guardia, memoria, informes, documentos y fuentes de Redacción
ui/       Vite + TypeScript: tabla, oficina 2D (PixiJS) y 3D (Three.js), panel, ajustes y replay
```

Cada hook ejecuta `plugin/hooks/emit.sh`, que hace POST del evento al hub con `curl -m 2`, reenvía en cabeceras el socket y el token de mensajería de la sesión e imprime la respuesta del hub cuando la hay (la memoria de `SessionStart` y `SubagentStart`). `AskUserQuestion` usa el mismo script contra `/ask`, que puede esperar hasta 15 minutos. `gate.sh` comprueba los `HECHO:` y `guard.sh` las escrituras de los departamentos; los dos salen con código 2 y el motivo cuando el hub bloquea, y con 0 si el hub no responde.

### Seguridad

Una orden del panel acaba en una sesión con Bash, así que el hub se trata como ejecución remota de código:

- Escucha solo en `127.0.0.1` y comprueba la cabecera `Host` en todas las rutas (DNS rebinding).
- Todo POST exige `X-Office-Key`. La key solo viaja dentro del HTML que sirve el propio hub; no hay CORS.
- El WebSocket comprueba `Origin` y exige la key en el primer mensaje antes de 1 segundo.
- Key y base de datos con permisos 600. `bun run rotate-key` genera otra; los hooks la leen en cada evento.
- **Guardia de los departamentos.** Redacción solo escribe en `office-docs/redaccion` (nunca en `.fuentes/`) y Mantenimiento en `office-docs/taller`, salvo el jefe de Mantenimiento al instalar una skill aprobada. Para Edit y Write la regla es exacta. Para Bash es parcial: detecta rutas escritas en el comando, pero no `cd`, variables ni scripts que escriben por su cuenta. Como red de seguridad, el hub guarda una huella de los ficheros que `git status` lista en cada planta gestionada mientras trabaja un agente de departamento y, al acabar su turno, avisa en el panel de los cambios que no puede atribuir a un Edit o Write de la planta: **alerta** si nadie de la planta trabajaba y **posible** si alguien sí.

### Privacidad

En plantas observadas el hub guarda solo estado, herramienta y ruta; nunca el contenido de las herramientas ni los mensajes, y no hay memoria ni lecciones. Los eventos se borran a los 14 días (`retentionDays` en `config.json`). Las lecciones, los informes y los veredictos de los documentos se conservan: desde el esquema v2 las migraciones de la base de datos solo añaden tablas o columnas.

## Probado en vivo

La v2 se probó el 2026-10-16 con Claude Code 2.1.292:
- Ajustes regenera los agentes.
- La memoria llega a compañeros lanzados en paralelo.
- La guardia bloquea al redactor fuera de su carpeta.
- Redacción entrega un plan sobre mobile en dos rondas, con commits por ronda y las fuentes retiradas al acabar.
- Mantenimiento crea una skill y la instala solo donde se le indica.

Los detalles y los hallazgos corregidos están en [docs/spikes.md](docs/spikes.md). El hub anota en `~/.config/agent-office/hub.log` cada arranque, los errores que no captura y la señal que lo para.

La v1 se probó el 2026-10-15, con Claude Code 2.1.292, en una planta de pruebas y en mobile y backend con tareas de solo lectura. Funcionaron la observación de sesiones, el equipo con desarrollador y tester, la puerta con `HECHO:` en ambos sentidos, las preguntas en el panel y su vuelta a la terminal, las órdenes desde el panel, el bloqueo y su respuesta, el encargo del director a una planta, la promoción de una planta en caliente y el hub apagado. Los detalles están en [docs/spikes.md](docs/spikes.md).

## Desarrollo

Para que la oficina trabaje sobre su propio código, sigue [CLAUDE.md](CLAUDE.md). El trabajo se hace en un clon, nunca en la copia de la que corre la oficina, y sin los comandos que administran la oficina real. El jefe de una planta que sea un clon de Agent Office se abre con esos comandos como reglas `ask` (`plugin/settings/clone-permissions.json`), y la pregunta de permiso sale en el panel para que la permitas o la deniegues. Tus sesiones normales de Claude no llevan esas reglas.

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
