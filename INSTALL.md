# Instalar Agent Office

Guía para poner en marcha Agent Office desde cero en tu máquina. Todos los comandos se ejecutan desde la raíz del repositorio y existen en `package.json` (scripts `bun run <nombre>`) o en `hub/src`.

Agent Office es un hub local (Bun + Hono + SQLite) que escucha solo en `127.0.0.1`, un plugin de Claude Code cuyos hooks le envían los eventos de tus sesiones, y un panel web. No instala nada fuera de tu usuario.

## Requisitos

- **macOS o Linux.** En macOS `bun run office` y `bun run panel` abren el navegador solos y las sesiones se abren con tmux o, si no hay tmux, en ventanas de Terminal (`osascript`). En Linux no se abre nada solo: `bun run panel` imprime el enlace y `office.sh` usa tmux o te imprime los comandos de cada sesión. Windows no está soportado (los hooks y los lanzadores son scripts `sh`).
- **[Bun](https://bun.sh) 1.4 o superior** (el repositorio se probó con 1.4.3, la de `bun.lock`/`@types/bun`). Con Homebrew: `brew install oven-sh/bun/bun`.
- **git 2.31 o superior.** El hub usa `git rev-parse --path-format=absolute` (git 2.31) además de worktrees, `commit --only` y `--pathspec-from-file`. Está probado con git 2.54; cualquier git reciente (2.38 o más) vale.
- **`curl` y `sh`**, que usan los hooks y los scripts del plugin.
- **La CLI `claude` (Claude Code) en el `PATH` y con la sesión iniciada**: `bun run setup` ejecuta `claude plugin marketplace add` y `claude plugin install`, y las sesiones de la oficina son sesiones de `claude`. Se recomienda 2.1.290 o superior (con versiones anteriores `TaskCreated`, `TaskCompleted` y `TeammateIdle` llegan sin `agent_id`).
- **tmux**, para **Relanzar** sesiones desde el panel. Sin tmux el hub contesta «sin tmux» (501) al relanzar.
- **`gh` (GitHub CLI)**, opcional: solo hace falta para abrir pull requests de los encargos con carpeta propia; con `gh auth login` hecho.

## 1. Clonar e instalar dependencias

```sh
git clone <url-del-repositorio> agent-office
cd agent-office
bun install
```

`bun install` en la raíz instala los dos paquetes del workspace (`hub` y `ui`) con un solo comando; no hace falta ejecutarlo dentro de cada carpeta. Usa `bun.lock`.

Comprobación opcional:

```sh
bun run typecheck   # tsc en hub y en ui
bun run test        # tests del hub y de la interfaz (usan carpetas temporales, no tocan tu configuración)
```

## 2. Compilar la interfaz

```sh
bun run build
```

Compila el panel con Vite en `hub/public/` (no se versiona). Sin este paso el hub arranca, pero avisa «La interfaz no está compilada».

## 3. Configurar la oficina: `bun run setup`

```sh
bun run setup          # pregunta antes de cada paso con efecto fuera del repositorio
bun run setup --yes    # contesta que sí a todo
```

Qué hace, en orden:

1. Crea `~/.config/agent-office/` (permisos 700) con:
   - `key`: la clave del hub, generada al azar (permisos 600).
   - `headers`: la cabecera `X-Office-Key` que leen los hooks (permisos 600).
   - `id`: el identificador de este hub.
   - `config.json`: la configuración con los valores por defecto (puerto 4747, `docsRepo`, departamentos, roles…).
   - `port`: el puerto, para que los hooks lo encuentren.
2. Pregunta si registrar **este repositorio** como marketplace local de Claude Code (`claude plugin marketplace add <este repositorio>`) e instalar el plugin `office` (`claude plugin install office@agent-office`). Sus hooks se ejecutan en **todas** tus sesiones de Claude Code; con el hub parado salen al instante sin hacer nada. Es el único cambio que toca `~/.claude/settings.json` (`extraKnownMarketplaces` y `enabledPlugins`). **Si mueves o borras el clon, el plugin deja de cargarse.**
3. Si existen `~/Projects/mobile` o `~/Projects/backend`, pregunta si los añade como plantas gestionadas. Si no existen, no pregunta nada. Para otros repositorios usa el paso 4.
4. Pregunta si crea el repositorio de documentos de Redacción y Mantenimiento en la ruta de `docsRepo` (por defecto `~/Projects/office-docs`) con `redaccion/planes/`, `redaccion/historial/`, `taller/skills/` y un primer commit. Si prefieres otra ruta, edita `docsRepo` en `~/.config/agent-office/config.json` y vuelve a ejecutar `bun run setup`. Si contestas que no, los departamentos no podrán trabajar hasta que lo crees o los desactives en Ajustes.
5. Escribe en `~/.claude/agents/office-*.md` los agentes de la oficina (director, revisor, departamentos y tres por cada planta gestionada) con el modelo y el esfuerzo de su rol, y los lanzadores `~/.config/agent-office/office.sh` y `sessions/*.sh`.

Es repetible: conserva la key, el id y tu `config.json` (solo lo reescribe normalizado). `bun run rotate-key` genera otra key (invalida los enlaces y tokens del panel; después reinicia el hub).

La carpeta `office-docs/` de este repositorio es solo material de ejemplo (léase `office-docs/SNAPSHOT.md`): **no** es el repositorio de documentos de la oficina.

## 4. Añadir repositorios (plantas)

```sh
bun run floor add <ruta>                  # p. ej. bun run floor add ~/Projects/mi-app
bun run floor add <ruta> --slug <nombre>  # si el nombre por defecto ya está cogido
bun run floor add --all                   # regenera los agentes de todas las plantas
bun run floor list
bun run floor remove <nombre>             # la planta pasa a observada y se borran sus agentes
```

`floor add` detecta el stack (flutter, laravel, node o generic), escribe tres agentes (jefe, desarrollador, tester) en `~/.claude/agents/` y regenera los lanzadores. Todas las plantas se ven también sin gestionarlas: cualquier sesión de Claude Code abierta en un repositorio git aparece como planta observada. No se puede añadir como planta la copia en la que corre la oficina (ver `CLAUDE.md`).

## 5. Arrancar

```sh
bun run office   # hub + panel en el navegador (macOS) + sesiones del director, los jefes y los departamentos
bun run hub      # solo el hub, en esta terminal (Ctrl+C lo para)
bun run panel    # abre el panel con un enlace nuevo; --print solo imprime el enlace
```

El hub corre en primer plano, en la terminal donde lo lanzas; no es un servicio. `bun run office` abre además las sesiones de `claude` en una sesión de tmux llamada `agent-office` (`tmux attach -t agent-office`).

El panel no lleva la key: `bun run panel` crea un enlace `http://127.0.0.1:4747/?t=…` firmado que vale 10 minutos y una sola vez. El panel lo cambia por un token de 30 días guardado en tu navegador.

Para desarrollar la interfaz (no hace falta para usarla): `bun run dev:hub` y `bun run dev:ui` (Vite en el puerto 5173). Las reglas para trabajar sobre este código con la propia oficina están en `CLAUDE.md`.

## Dónde vive cada cosa

Todo lo del usuario está en `~/.config/agent-office/` (o en la carpeta de `AGENT_OFFICE_HOME`, si la defines):

| Fichero | Contenido |
|---|---|
| `config.json` | Configuración: puerto, plantas, roles, departamentos, `docsRepo`. El hub la relee al cambiar; el puerto exige reiniciar. |
| `key`, `headers`, `id` | Clave del hub, cabecera que leen los hooks y su id. Permisos 600. |
| `office.db` (+ `-wal`, `-shm`) | Base de datos SQLite (eventos, informes, memoria). Ver `docs/db.md`. |
| `hub.log` (y `hub.log.1`) | Registro del hub, modo 600; rota al llegar a 1 MB. |
| `office.sh`, `sessions/`, `director-floors.md` | Lanzadores de las sesiones de la oficina. |
| `layouts.json`, `port` | Diseño del editor de la oficina y puerto vigente. |

Fuera de esa carpeta: `~/.claude/agents/office-*.md` (agentes generados), las dos entradas del plugin en `~/.claude/settings.json`, y el repositorio de documentos de `docsRepo`. `AGENT_OFFICE_CLAUDE_HOME` cambia `~/.claude` (útil para pruebas). Referencias de rutas y tablas: `docs/api.md`, `docs/db.md`.

## Actualizar

```sh
git pull
bun install
bun run build
bun run floor add --all   # regenera los agentes con las plantillas nuevas
```

Después reinicia el hub (Ctrl+C y `bun run office` o `bun run hub`) y abre un panel nuevo con `bun run panel`. El plugin se lee en vivo desde este repositorio: un cambio en `plugin/` vale en la siguiente sesión o tras `/reload-plugins`. Las sesiones ya abiertas piden **Relanzar** en el panel cuando sus reglas o su lanzador han cambiado.

## Desinstalar

1. Para el hub (Ctrl+C) y las sesiones: `tmux kill-session -t agent-office`.
2. Quita el plugin y el marketplace:
   ```sh
   claude plugin uninstall office@agent-office
   claude plugin marketplace remove agent-office
   ```
3. Borra los agentes generados: `rm ~/.claude/agents/office-*.md`.
4. Borra la configuración, la key, la base de datos y el registro: `rm -rf ~/.config/agent-office`.
5. Opcional: el repositorio de documentos (`docsRepo`, por defecto `~/Projects/office-docs`) y las skills que Mantenimiento haya instalado en `~/.claude/skills/` son tuyos; bórralos solo si no los quieres.
6. Borra el clon.

## Problemas frecuentes

- **El panel dice «Bloqueado» o «Acceso caducado».** El panel no tiene un token válido: no ha abierto nunca un enlace, el token de 30 días caducó o rotaste la key. Ejecuta `bun run panel` (en Linux, `bun run panel --print` y abre el enlace). El enlace vale una sola vez y 10 minutos: si ya lo abriste, pide otro.
- **«No hay key de Agent Office. Ejecuta primero: bun run setup».** Aún no has hecho el paso 3, o `AGENT_OFFICE_HOME` apunta a otra carpeta.
- **El puerto 4747 está ocupado.** Otro hub (o programa) lo usa. Busca el proceso con `lsof -nP -iTCP:4747 -sTCP:LISTEN`, párralo, o cambia `port` en `~/.config/agent-office/config.json` y reinicia el hub; el hub reescribe `port` al arrancar y `bun run panel` lo lee de ahí. Las sesiones de la oficina ya abiertas deben abrirse de nuevo para usar el puerto nuevo.
- **«La interfaz no está compilada».** Falta `bun run build`.
- **Los hooks no hacen nada.** Es lo previsto con el hub parado: cada hook sale con código 0 sin escribir nada (también si falta `~/.config/agent-office/headers`), así que tus sesiones de Claude Code no se bloquean. Sin hub no hay panel, ni guardia de permisos, ni puerta de tests, y las sesiones de Redacción y Mantenimiento se niegan a arrancar («El hub de Agent Office no responde»). Arráncalo con `bun run hub`; comprueba `curl http://127.0.0.1:4747/health`. Si el hub arranca pero los hooks siguen mudos, mira `hub.log` y comprueba que el plugin está activo con `claude plugin list`.
- **Los hooks bloquean una herramienta de una sesión de la oficina.** Es la guardia o la puerta de tests: el motivo sale en la propia sesión y en la actividad del panel. Tus sesiones normales no se bloquean por la guardia de los departamentos.
- **Relanzar responde «sin tmux» o «sin ventana».** Relanzar solo funciona con las sesiones abiertas por `office.sh` dentro de la sesión de tmux `agent-office`: instala tmux, o la ventana se cerró (si `claude` termina, la ventana de tmux se cierra con él). Abre solo esa sesión de nuevo, con el nombre que muestra el panel: `tmux new-window -t agent-office -n <nombre> ~/.config/agent-office/sessions/<nombre>.sh` (si la sesión de tmux no existe, `tmux new-session -d -s agent-office -n <nombre> …`), o vuelve a lanzar todas con `sh ~/.config/agent-office/office.sh`, que abre una ventana nueva por sesión. Tras un relanzamiento correcto, la sesión reanuda la conversación si tiene transcripción y, si no, abre una nueva.
- **`bun run setup` termina con «terminó con código …» en el registro del plugin.** Comprueba que `claude` está en el `PATH`, que has iniciado sesión y que `claude plugin marketplace list` no tiene ya otro marketplace llamado `agent-office` apuntando a otra carpeta.
