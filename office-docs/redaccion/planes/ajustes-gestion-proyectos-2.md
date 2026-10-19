# Gestión de proyectos (plantas) desde Ajustes

## Contexto

Hoy una planta solo se da de alta con `bun run floor add <ruta>` y `floor remove` no la borra: la deja como observada (`managed: false`) y conserva su configuración y todos sus datos en `office.db`. El panel (sección Ajustes) solo permite editar la rama base de cada planta.

- agent-office-dev build/v1 @ 7480a64 (2026-10-16)

## Objetivo

Desde Ajustes, dar de alta un proyecto indicando la ruta de su repositorio (se crea su planta con jefe, dev y tester) y borrar una planta eliminando todo lo que la oficina guarda de ella. Sin reiniciar el hub.

## Alcance

Entra:
- Hub: `POST /api/floors` (alta, reutiliza `planFloor`/`writeFloor`) y `DELETE /api/floors/:slug` (baja completa, nueva).
- UI: sección "Proyectos" en Ajustes con formulario de alta y lista de todas las plantas de `config.json` (gestionadas y observadas) con botón de borrar y confirmación escribiendo el nombre de la planta.
- Tests del hub para alta, baja y errores.

Queda fuera:
- Abrir la sesión del jefe de planta desde el panel (la respuesta devuelve el comando y `bun run office` la abre).
- Plantas observadas que solo existen en la tabla `floors` de `office.db` (sin entrada en `config.json`): `DELETE` responde 404 y no aparecen en la lista.
- Tocar el repositorio del proyecto (ni `.claude/skills` instaladas allí), `~/.claude/teams`, `hub.log` ni los planes de `redaccion/planes` que citen la planta.
- Avisos de escritorio (`avisos-escritorio`) e idioma/ayudas (`panel-i18n-ayuda`).

## Diseño

### Inventario: qué datos tiene una planta y quién los borra

| Dato | Dónde vive | Lo borra |
|---|---|---|
| `floors[slug]`, `permissionModes[slug]` | `config.json` (`hub/src/config.ts:181`, `:218`) | `purgeFloor` (nuevo, `floor-cli.ts`) |
| `office-{lead,dev,tester}-<slug>.md` | `~/.claude/agents` (`hub/src/agents.ts:49`) | `purgeFloor` via `agentFile` (`floor-cli.ts:39`) |
| `sessions/lead-<slug>.sh`, `office.sh`, `director-floors.md`, lista `{{floorsList}}` de agentes fijos | `~/.config/agent-office` (`hub/src/office-sh.ts:216`, `agents.ts:59`) | `writeFixedAgents` + `writeOfficeScripts` al regenerar sin la planta |
| Filas con columna `floor`: `events`, `sessions`, `agents`, `edits`, `verdicts`, `messages`, `questions`, `lessons`, `reports`, `alerts`, `floor_sync`, `sync_worktrees` | `office.db` (`hub/src/db.ts:14-187`) | `purgeFloorData` (nuevo, `floor-data.ts`) |
| `tasks` y `gate_decisions` (sin columna `floor`; `scope` es `team_name`/`session.team`/`agent.team` o `session-<8>` de la sesión, `office.ts:447`, `:1121`, `:181`) | `office.db` | `purgeFloorData`, por `scope` derivado de `sessions`/`agents` de la planta, antes de borrar esas tablas |
| Registro de plantas observadas `floors` (slug, path con `realPath`, `floors.ts:106,118`) | `office.db` (`db.ts:238`) | `purgeFloorData` por `slug` o `path` real |
| Fotos `redaccion/.fuentes/<plan>/<slug>` (worktrees del repo de la planta) | repo de documentos + `sync_worktrees` | `SyncDesk.removeFloor` (nuevo, `sync.ts`), como `remove` en `sync.ts:160` |
| Estado en memoria: `agents`, `sessions`, `messages`, `activity`, `permissionHolds`, preguntas del `desk` | `Office` (`office.ts:201-212`) | `Office.forgetFloor` (nuevo) |

### Hub

1. `hub/src/floor-cli.ts`
   - `FloorConflictError extends FloorError`, lanzada en los dos casos "ya es la planta" (`floor-cli.ts:94` y `:97`) para que el endpoint devuelva 409.
   - Extraer de `removeFloor` (`:157-163`) `deleteFloorAgents(p, slug): string[]`.
   - `purgeFloor(p, profiles, slug): string[]`: `deleteFloorAgents`, `delete config.floors[slug]`, `delete config.permissionModes[slug]`, `saveConfig`, `writeFixedAgents`, `writeOfficeScripts`. `FloorError` si no existe. `removeFloor` y el CLI `remove` no cambian.
   - Las validaciones de alta ya existen en `planFloor` (`:77-107`): ruta inexistente / no carpeta (`:65-75`), copia en vivo (`:85`), nombre reservado (`checkSlug`), repo repetido con otro nombre. Falta el caso "mismo repo, mismo nombre, ya gestionada": `planFloor` lo deja pasar (`:93-98`) y lo resuelve `floor-admin.add` (punto 5).
2. `hub/src/floor-data.ts` (nuevo): `purgeFloorData(db, slug, realPath): number` en una `db.transaction`. Orden: primero `tasks` y `gate_decisions` con `scope IN (SELECT 'session-' || substr(session_id, 1, 8) FROM sessions WHERE floor = ? UNION SELECT team FROM sessions WHERE floor = ? AND team IS NOT NULL UNION SELECT team FROM agents WHERE floor = ? AND team IS NOT NULL)`; luego `DELETE ... WHERE floor = ?` en las doce tablas del inventario; por último `DELETE FROM floors WHERE slug = ? OR path = ?`. Devuelve filas borradas. (El guardia `DESTRUCTIVE` de `db.ts:189` solo afecta a migraciones; `prune.ts` ya borra en caliente.)
3. `hub/src/sync.ts`: `SyncDesk.removeFloor(floorSlug): Promise<number>`: para cada fila `sync_worktrees WHERE floor = ?`, en `queue.run(row.repo)`: `worktree remove --force` si existe el dir, `worktree prune`, `removeDir(row.path)`; un `code != 0` de git (repo desaparecido) se ignora y el dir se borra igual; `DELETE` de la fila; `removeDir(join(fuentes, row.slug), true)`. Después `DELETE FROM floor_sync WHERE floor = ?` y `onChange()`. Una excepción del `GitRunner` sí se propaga (es lo que hace reintentable la baja, punto 5).
4. `hub/src/office.ts`
   - `floorInUse(slug): string[]`: nombres (o id) de `sessions` con `floor === slug && endedAt === null`.
   - `async forgetFloor(slug, path): Promise<{ rows: number; worktrees: number }>`, en este orden: (1) toma de `agents`/`sessions` en memoria las claves y sesiones de la planta (terminadas hace menos de 10 min, `office.ts:155`); (2) `await this.sync.removeFloor(slug)`; (3) `desk.release` de las preguntas de esas sesiones, limpia `permissionHolds` de esas claves, quita esos `agents`/`sessions`, filtra `messages` por `floor` y `activity` por las claves retiradas; (4) `purgeFloorData`; (5) `pushActivity` `planta borrada desde el panel: <slug>` (agentKey `panel`, como `office.ts:606`); (6) `emit({ type: 'snapshot', data: this.snapshot() })` para que los clientes suelten agentes, sesiones y mensajes de la planta (`ui/src/store.ts:124-125` aplica el snapshot entero; sin esto `floorList()` la re-añadiría como observada por agentes recién terminados, `store.ts:232-237`).
5. `hub/src/floor-admin.ts` (nuevo): `createFloorAdmin(p, profiles: () => Profiles, office, reload: () => void): FloorAdmin`.
   - `add(raw)`: `path` obligatorio (`text`, ≤ 1000), `slug` opcional; `planFloor`; si `loadConfig(p).floors[plan.slug]?.managed` → `FloorConflictError` "<ruta> ya es la planta gestionada «slug»" (409); solo sigue si no hay entrada o es observada (`managed: false`, que vuelve a gestionarse, el caso de `floor remove`); `writeFloor` → `reload()`. Devuelve `{ ok: true, slug, path, stack, startCommand, note }`. `FloorConflictError` → 409; `FloorError`/`TemplateError` → 400. Así desde el panel nunca se sobrescriben los agentes de una planta ya gestionada; regenerarlos sigue siendo `bun run floor add --all`.
   - `remove(slug)`: slug con `/^[a-z0-9][a-z0-9-]*$/` si no 400; sin entrada en config → 404; `office.floorInUse` no vacío → 409 "Cierra la sesión lead-<slug> (y su equipo) antes de borrar la planta"; después, en `try/catch`: `await office.forgetFloor(slug, realPath(floor.path))` → `purgeFloor(p, profiles, slug)` → `reload()`; cualquier excepción → `{ ok: false, status: 500, error }`. Devuelve `{ ok: true, slug, removed: { files, rows, worktrees } }`.
   - Por qué datos antes que config: mientras la planta siga en `config.json` un fallo a medias (git colgado, hub muerto) se repara repitiendo el `DELETE`; y como la memoria se limpia antes de tocar config, el `reload` que dispara el watcher de `config.json` (`config-watch.ts:5`, `main.ts:72`) ya no encuentra sesiones de la planta que re-resolver como observadas con otro slug (`office.ts:654-657`, `floors.ts:105-111`).
   - Va aparte de `settings.ts` porque los otros dos planes editan ese fichero y porque la baja es asíncrona (`SettingsService.update` es síncrono).
   - `reload` es el mismo callback que usa `createSettings` en `main.ts:52-63`: `office.reload` emite `floors` y `settings` (`office.ts:666-667`), que es lo que hace aparecer o desaparecer la planta en el panel sin reiniciar. El watcher dispara un segundo `reload`, idempotente.
6. `hub/src/server.ts`: `ServerOptions.floors?: FloorAdmin`; tras `/api/settings` (`:124`): `POST /api/floors` y `DELETE /api/floors/:slug` con `requireKey`; 503 si no hay servicio; en `DELETE`, `holdRequest(c.req.raw)` antes de esperar (como `/api/redaccion/sync`, `:166-167`: `idleTimeout: 30`, `:186`). Respuesta `c.json(result, result.ok ? 200 : result.status)`; para que Hono acepte el status, los tipos lo declaran como literal (punto 8).
7. `hub/src/main.ts`: `const floors = createFloorAdmin(p, () => loadProfiles(PROFILES_DIR), office, reload)` y pasarlo a `startServer`.
8. `hub/src/types.ts`: `FloorAddRequest = { path: string; slug?: string }`; `FloorErrorStatus = 400 | 404 | 409 | 500`; `FloorAddResult` y `FloorRemoveResult` (`ok: true` con datos | `{ ok: false; status: FloorErrorStatus; error: string }`). La UI los recibe por `ui/src/types.ts:1`.

### UI

9. `ui/src/settings/projects.ts` (nuevo): `mountProjects(host, store, api)`. Sección `settings-section` "Proyectos": formulario (input `Ruta del repositorio`, input `Nombre (opcional)`, botón `Añadir proyecto` `primary`) y lista de `store.settings.floors` (todas: la observada que dejó `floor remove` también se puede borrar) con slug, chip de stack, chip `observada` si `managed: false`, `code.setting-path` y botón `Borrar`. Borrar: `window.prompt` que enumera lo que se elimina (agentes, lanzador, configuración, eventos, mensajes, lecciones, informes, fotos de Redacción) y, si `store.documents` tiene planes abiertos (`status` distinto de `cerrado`/`descartado`) cuyo `base` incluye la planta, los nombra avisando de que Redacción perdería sus fotos; exige escribir el slug. Estado en una línea `settings-status` (`ok`/`error`), como `settings.ts:410-425`; durante la llamada se deshabilitan los controles. Repinta con `store.watch(['settings', 'documents'])` (más `'lang'` si ya existe el tema de i18n); con `api === null` la sección se oculta (patrón de `panel/memory.ts:37`).
10. `ui/src/settings/settings.ts`: `private readonly projectsHost = el('div', 'settings-projects')`; en `start()` (`:143`) `mountProjects(this.projectsHost, this.store, this.api)`; en `buildControls` (`:365`) `el('div', 'settings-form', fieldset, this.projectsHost, hub)`. Fuera del `fieldset` para que el guardado de ajustes no lo deshabilite; montado una vez y movido de nodo en cada reconstrucción.
11. `ui/src/api.ts`: `addFloor(request)` → `send('POST', '/api/floors', request)`; `deleteFloor(slug)` → `send('DELETE', '/api/floors/${encodeURIComponent(slug)}')`. `readError` (`:21`) ya extrae `error` del JSON. Los dos métodos van al final de la clase, lejos de las líneas que toca i18n (`:19`, `:50-58`, `:112`).
12. `ui/src/styles.css`: bloque al final para `.project-form` (ruta + nombre + botón) y `.project-delete`; el resto reutiliza `setting-row`, `setting-text`, `setting-label`, `setting-path`, `chip`, `invalid`, `settings-status`.

### Ficheros que toca este plan (coordinación)

- Hub: `floor-cli.ts`, `sync.ts`, `office.ts`, `server.ts`, `main.ts`, `types.ts`; nuevos `floor-data.ts`, `floor-admin.ts`.
- Tests: nuevo `test/floor-admin.test.ts`; añadidos en `floor-cli.test.ts`, `sync.test.ts`, `server-v2.test.ts`.
- UI: nuevo `settings/projects.ts`; `settings/settings.ts` (solo `:143-145` y `:365`); `api.ts` (dos métodos al final de la clase); `styles.css` (bloque al final).
- No toca `hub/src/settings.ts`, `ui/src/settings/draft.ts`, `ui/src/settings/options.ts`, `ui/src/store.ts` ni `ui/src/main.ts`.
- Orden de ejecución acordado por el jefe de Redacción: 1º `panel-i18n-ayuda`, 2º este plan, 3º `avisos-escritorio`. Este plan parte de la base que deja el primero (`ui/src/i18n/{es,en,index}.ts`, `t()`, tema `lang`, `labels.ts` como funciones) y no prevé ejecutarse sin ella.
- Textos: `projects.ts` no contiene ningún literal visible; todo se pinta con `t()` y claves `settings.floors.*` añadidas a `ui/src/i18n/es.ts` y `en.ts` (regla de D10 de ese plan); la etiqueta de stack sale de la función que deja `labels.ts` tras su D5; no hace falta nada en `SAME_IN_BOTH` (sin nombres propios nuevos). El test de rastreo de `ui/test/i18n.test.ts` (español fuera del diccionario) tiene que seguir pasando; forma parte de la verificación.
- Orden en `settings-form` (`settings.ts:365`): este plan deja `fieldset, projectsHost, hub`; `avisos-escritorio`, que entra después, añade su sección tras `hub`. Resultado final: `fieldset, projectsHost, hub, avisos`.
- Mensajes del hub en castellano como el resto (`floor-cli.ts`, `floor-admin.ts`).

## Pasos

1. `floor-cli.ts`: `FloorConflictError`, `deleteFloorAgents`, `purgeFloor`. Test en `floor-cli.test.ts`: tras `purgeFloor` no hay `floors.mobile` ni `permissionModes.mobile`, no existen los tres agentes ni `lead-mobile.sh`, `office.sh` y `director-floors.md` no nombran la planta; `planFloor` del mismo repo con otro slug lanza `FloorConflictError`.
2. `floor-data.ts` con `purgeFloorData` y `sync.ts` con `removeFloor`. Test en `sync.test.ts` (con `originAndClone`): dos planes con fotos de `mobile` y `backend`; `removeFloor('mobile')` borra `.fuentes/*/mobile`, sus filas y `floor_sync`, y deja `backend`; `git worktree list` del repo de mobile ya no las lista.
3. `office.ts`: `floorInUse` y `forgetFloor`. `types.ts`: tipos nuevos.
4. `floor-admin.ts` y wiring en `server.ts` y `main.ts`.
5. `test/floor-admin.test.ts` con `harness` + `fakePaths`; antes de nada `saveConfig(p, testConfig({ docsRepo: join(h.root, 'docs'), ... }))` como `floor-cli.test.ts:19` (sin él `loadConfig(p)` devuelve `defaultConfig()` y el `reload` pondría al Office a vigilar `~/Projects/office-docs`, `config.ts:103,237`); `reload = () => h.office.reload(loadConfig(p), profiles)`; `git` del harness es un stub con un flag `broken` (lanza si está activo; si no, `{ code: 0, stdout: '', stderr: '' }`).
   - Alta: `makeRepo` con `pubspec.yaml` → `ok`, `stack: 'flutter'`, tres agentes escritos, `loadConfig(p).floors.mobile.managed === true`, `snapshot().floors` incluye `mobile` como `managed`.
   - Errores: ruta inexistente → 400 "No existe"; mismo repo y mismo nombre ya gestionado → 409 "ya es la planta gestionada" y los agentes conservan su `mtime`; mismo repo con otro slug → 409 "ya es la planta"; `REPO_ROOT` → 400 "copia de la que corre la oficina"; slug `redaccion` → 400 "reservado"; sin `path` → 400. Y el caso permitido: tras `removeFloor` (observada), volver a añadir → 200 y `managed: true`.
   - Baja: sembrar filas con `floor = 'mobile'` en las doce tablas y una fila de control con `floor = 'otra'`; una sesión de mobile con `team = 'equipo-x'` y `tasks`/`gate_decisions` con scope `session-<8>` y `equipo-x`; fila `sync_worktrees` + dir bajo `docs/redaccion/.fuentes/x/mobile`; sesión terminada con `SessionEnd`. `await admin.remove('mobile')` → `ok`; `COUNT(*) WHERE floor='mobile'` es 0 en todas las tablas y `otra` sigue; no quedan `tasks`/`gate_decisions` de ninguno de los dos scopes ni fila en `floors`; config y ficheros como en el paso 1; el dir de la foto no existe; `snapshot()` sin `mobile` en `floors`, `agents`, `sessions` ni `messages`; `activity` contiene "planta borrada"; el último mensaje emitido antes de `floors` es un `snapshot`.
   - Baja reintentable: con `broken = true`, `remove('mobile')` → `{ ok: false, status: 500 }`, `loadConfig(p).floors.mobile` sigue y los agentes siguen; con `broken = false` un segundo `remove` → `ok` y todo borrado.
   - Baja con sesión viva → 409 que nombra la sesión; `nope` → 404; `Mal slug` → 400.
6. `server-v2.test.ts`: stub de `FloorAdmin` como el de `settings` (`:29-35`); `POST /api/floors` → 200 y 400, `DELETE /api/floors/x` → 404, sin key → 401.
7. UI: `api.ts`, `projects.ts` (con `t()` y claves `settings.floors.*` en `es.ts`/`en.ts`), `settings.ts`, `styles.css`. Verificable: `bun run typecheck` y el test de i18n de la UI (`ui/test/i18n.test.ts`: diccionarios completos y sin español fuera de ellos).
8. `bun run typecheck`, `bun run test`, `bun run build` en el clon.

## Riesgos

- Una sesión abierta en el repo tras la baja volvería a registrar la planta como observada con slug libre (`floors.ts:105-111`): por eso la baja se rechaza con sesiones vivas (409).
- `forgetFloor` borra también las lecciones escritas por el usuario (`origin = 'user'`): es lo pedido; la confirmación lo dice.
- Si el repo de la planta ya no existe, `git worktree remove` devuelve error: `removeFloor` lo ignora y borra dir y filas igualmente.
- Fallo a medias en la baja (git colgado, hub muerto): como config y ficheros se tocan al final, la planta sigue en Ajustes y repetir el `DELETE` termina el trabajo; a lo sumo quedan fotos ya retiradas de planes cerrados, que `sync.cleanup` no reclama (sus filas ya no existen) pero tampoco molestan.
- Borrar una planta con fotos de un plan abierto deja a Redacción sin fuentes en plena ronda: la confirmación lo avisa nombrando los planes; no se bloquea (ver Preguntas abiertas).
- Dos `reload` seguidos (callback + watcher): ambos emiten `floors`/`settings`; la UI re-renderiza dos veces sin efecto visible.

## Verificación

- `cd ~/Projects/agent-office-dev && bun run test` (incluye `floor-admin`, `floor-cli`, `sync`, `server-v2` y, tras `panel-i18n-ayuda`, los tests de la UI con el rastreo de i18n).
- `bun run typecheck` y `bun run build`.
- Manual, sin tocar la copia en vivo ni `~/Projects/office-docs`. El `docsRepo` temporal es obligatorio: `office.start()` (`main.ts:73`) llama a `sync.cleanup` (`office.ts:281`, `sync.ts:193-217`), que no mira `departments` y, con la BD temporal vacía, haría `worktree remove --force` y `rmSync` de todo `redaccion/.fuentes/*` del repo de documentos que apunte `docsRepo` (por defecto `~/Projects/office-docs`, `config.ts:103`), es decir, las fotos de los planes en curso.

  ```sh
  H=$(mktemp -d); C=$(mktemp -d)
  openssl rand -hex 32 > "$H/key"
  printf '{"port":4799,"docsRepo":"%s/docs","departments":{"redaccion":false,"mantenimiento":false}}\n' "$H" > "$H/config.json"
  AGENT_OFFICE_HOME=$H AGENT_OFFICE_CLAUDE_HOME=$C bun hub/src/main.ts &   # o en otra terminal con las mismas variables
  ```
  (`bun hub/src/main.ts *` es regla `ask` de `clone-permissions.json:15`: el usuario aprueba en el panel.) Luego, con `K="X-Office-Key: $(cat $H/key)"`:
  - `curl -s -X POST http://127.0.0.1:4799/api/floors -H "$K" -H 'Content-Type: application/json' -d '{"path":"/ruta/a/un/repo"}'` → 200 con `slug`; `ls $C/agents` muestra los tres agentes; abrir `http://127.0.0.1:4799` y ver la planta y la sección Proyectos.
  - Repetir la misma ruta → 409 "ya es la planta gestionada"; con `"slug":"otro"` → 409; con `/no/existe` → 400; con la ruta del clon → 400 "copia de la que corre la oficina".
  - `curl -s -X DELETE http://127.0.0.1:4799/api/floors/<slug> -H "$K"` → 200; `sqlite3 $H/office.db "select count(*) from lessons where floor='<slug>'"` → 0; `grep <slug> $H/config.json` sin resultado; la planta desaparece del panel sin reiniciar.
  - Al acabar: `kill %1` (o cerrar la otra terminal) y `rm -rf "$H" "$C"`.

## Preguntas abiertas

- ¿Bloquear la baja (409) cuando un plan abierto tiene fotos de la planta, en vez de solo avisar en la confirmación? Propuesta: avisar; el usuario decide.
- ¿Abrir la sesión del jefe de planta desde el panel tras el alta? Fuera de alcance; la respuesta incluye `startCommand`.

## Historial de revisión

- Ronda 1 (nota 7/10, MEJORAR). Aplicados los tres bloqueantes: (1) baja en orden datos → config → reload, `try/catch` con 500 y test de reintento con git roto; desaparece la pregunta abierta de idempotencia y se reescribe el riesgo de fallo a medias; (2) verificación manual con `docsRepo` temporal, hub en segundo plano y parada al final, con la explicación de `sync.cleanup`; (3) 409 "ya es la planta gestionada" en `add` para mismo repo y mismo nombre, con test, y solo se readmite una planta observada. Menores aplicados: (4) scopes de `tasks`/`gate_decisions` por `team` además de `session-<8>`, y `realPath` para el registro; (5) `activity` en el inventario y `snapshot` al final de `forgetFloor`, con test; (6) `holdRequest` en `DELETE` y status como literales; (7) la lista muestra también las observadas de config y Alcance dice que las que solo están en la tabla dan 404; (8) la confirmación nombra los planes abiertos con fotos de la planta (opción "avisar"; el 409 queda como pregunta abierta); (9) orden `fieldset, projectsHost, hub, avisos` y `panel-i18n-ayuda` antes que este plan, con claves `settings.floors.*` (prefijo que fija la regla D10 de ese plan; el revisor sugería `settings.projects.*`); (10) `saveConfig` con `docsRepo` temporal al inicio de `floor-admin.test.ts`. Ningún punto rechazado.
- Entre rondas: el jefe de Redacción fijó el orden de ejecución (`panel-i18n-ayuda` → este plan → `avisos-escritorio`); la coordinación lo asume como dato y desaparece la alternativa de textos en una const `TEXTS`.
