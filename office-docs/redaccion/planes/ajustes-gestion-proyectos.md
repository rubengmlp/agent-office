> **Descartado** desde el panel de Agent Office el 2026-10-16 03:29. No se continúa: un encargo nuevo empieza con otro slug.

# Alta y baja de plantas desde Ajustes

## Contexto

Hoy una planta (proyecto) solo se da de alta con `bun run floor add <ruta>` y solo se "quita" con `bun run floor remove <nombre>`, que no la borra: la deja como observada (`managed: false`) y conserva todo lo que la oficina ha guardado de ella (`hub/src/floor-cli.ts:147-164`). La pestaña Ajustes ya edita `config.json` en caliente (roles, departamentos, límites y la rama base de cada planta), pero no puede crear ni eliminar plantas (`hub/src/settings.ts:36-90`, `ui/src/settings/settings.ts:289-333`).

Base sobre la que se escribe:

- agent-office-dev `build/v1` @ `61f915e` (2026-10-16)

Es el primer plan sobre esta planta; no hay cambios previos con los que comparar.

## Objetivo

Que el usuario dé de alta una planta desde Ajustes (nombre, ruta del repositorio y rama base) y la oficina le cree su piso al momento, sin editar ficheros ni reiniciar el hub; y que pueda borrarla con confirmación explícita y desaparezca todo lo que la oficina guarda de ella: configuración, agentes, lanzadores, lecciones, informes, registro de eventos, sesiones y fotos de Redacción.

## Alcance

Entra:

- Formulario de alta en la sección "Plantas" de Ajustes: ruta (obligatoria), nombre (opcional, por defecto el de la carpeta), rama base (opcional, por defecto la que detecta el hub) y una casilla "Abrir su jefe de planta" (marcada por defecto). El stack se detecta como hace el CLI y `managed` siempre es `true`: son los cuatro campos de `FloorConfig` (`hub/src/types.ts:26`).
- Endpoints `POST /api/floors` y `DELETE /api/floors/:slug` en el hub, con el mismo guardado y recarga en caliente que `POST /api/settings`.
- Botón "Borrar" por planta gestionada, con confirmación tecleando el nombre, que elimina la planta de la configuración y todos sus datos (inventario en Diseño, D6).
- Validaciones en el hub con mensaje claro en el panel: ruta inexistente o que no es la raíz de un repositorio git, nombre duplicado o reservado, rama inexistente.
- Si la planta tiene sesiones abiertas, el borrado se rechaza y se listan (D5).
- Tests del hub para alta, baja y validaciones; actualización del README.

Queda fuera:

- El repositorio del proyecto: no se clona, no se mueve y no se borra nada de él. La única excepción es el registro de worktrees que la propia oficina creó en su `.git/worktrees/` para las fotos de Redacción, que se retira con `git worktree remove` como ya hace `SyncDesk.remove` (`hub/src/sync.ts:160-171`). Las skills que Mantenimiento haya instalado en `<repo>/.claude/skills` (`hub/src/office.ts:663-668`) se quedan: están dentro del repositorio.
- Departamentos (Redacción y Mantenimiento): siguen gestionándose con sus interruptores.
- Cambios en la escena 3D y 2D más allá de que un piso aparezca o desaparezca; ambas ya se reconstruyen al cambiar la lista de plantas (`ui/src/scene/scene.ts:183`, `ui/src/scene/scene.ts:267-299`, `ui/src/office/office.ts:107`).
- El comando `bun run floor remove` conserva su semántica (pasar a observada). Las entradas observadas que deja en `config.json` no aparecen en Ajustes (`ui/src/settings/draft.ts:54-56`) y no se gestionan aquí.
- Ficheros de Claude Code que no son de la oficina: `~/.claude/teams/<equipo>/config.json` (`hub/src/office.ts:1147`) y `~/.claude/settings.json`.

## Diseño

### D1. El alta reutiliza el CLI de plantas; la baja necesita una función nueva

`planFloor` (`hub/src/floor-cli.ts:77-102`) ya resuelve la ruta, comprueba que existe y es carpeta (`resolveDir`, `hub/src/floor-cli.ts:65-75`), valida el nombre (`checkSlug`, `hub/src/floor-cli.ts:57-63`, con los reservados de `hub/src/floors.ts:11`), rechaza nombre o ruta duplicados (`hub/src/floor-cli.ts:87-93`), detecta el stack y renderiza los tres agentes. `writeFloor` (`hub/src/floor-cli.ts:104-118`) escribe los agentes, guarda la planta en `config.json`, regenera los agentes fijos (la lista de plantas va en sus plantillas: `floorsList`, `hub/src/agents.ts:59-68`) y los lanzadores (`writeOfficeScripts`, `hub/src/office-sh.ts:171-182`). El servicio del panel llama a esas dos funciones. Cambios mínimos en `floor-cli.ts`:

- `FloorPlan` gana `baseBranch?: string` y `writeFloor` usa `plan.baseBranch ?? previous?.baseBranch ?? detectBaseBranch(plan.path)` en `hub/src/floor-cli.ts:112`. Así la rama que escribe el usuario manda, sin cambiar la firma (el cuarto parámetro ya es `templatesDir`).
- `resolveDir` pasa a exportarse: el servicio necesita la ruta real antes de `planFloor` para dar sus propios mensajes de duplicado (los del CLI hablan de `--slug`, que no existe en el panel).
- Nueva `deleteFloor(p, profiles, slug): string[]`, al lado de `removeFloor`: borra `office-{lead,dev,tester}-<slug>.md` (`agentFile`, `hub/src/floor-cli.ts:39-41`), hace `delete config.floors[slug]`, `saveConfig`, `writeFixedAgents` y `writeOfficeScripts`. Esto último elimina `sessions/lead-<slug>.sh` (`hub/src/office-sh.ts:175-178`) y reescribe `office.sh` y `director-floors.md` sin la planta.

Los agentes ya existentes con ese nombre en `~/.claude/agents` (restos de una planta anterior; `plan.existing`, `hub/src/floor-cli.ts:101`) se sobrescriben sin preguntar: en el panel no hay `askYesNo` y una planta que no está en `config.json` no tiene agentes vigentes.

### D2. Servicio `floor-admin.ts` y dos endpoints

Nuevo `hub/src/floor-admin.ts`, hermano de `settings.ts`:

```ts
export type FloorAdmin = {
  add(raw: unknown): FloorCreateResult;
  remove(slug: string, raw: unknown): Promise<FloorDeleteResult | { ok: false; status: 400 | 404 | 409; error: string }>;
};
export function createFloorAdmin(deps: {
  p: Paths;
  profiles: () => Profiles;
  office: Office;
  onSaved: (config: OfficeConfig) => void;
  open: (sessionName: string) => boolean;
  log: (text: string) => void;
}): FloorAdmin;
```

Tipos nuevos en `hub/src/types.ts` (la UI los reexporta: `ui/src/types.ts:1`):

```ts
export type FloorCreate = { path: string; slug?: string; baseBranch?: string; open?: boolean };
export type FloorCreateResult =
  | { ok: true; slug: string; path: string; stack: Stack; baseBranch: string; files: number; opened: boolean; launcher: string; note: string }
  | { ok: false; error: string };
export type FloorDeleteResult =
  | { ok: true; slug: string; removed: { agents: number; rows: number; worktrees: number }; note: string }
  | { ok: false; error: string };
```

Rutas en `createApp` (`hub/src/server.ts:107-116` como modelo), con `ServerOptions.floors?: FloorAdmin`:

- `POST /api/floors` → `floors.add(body)`; 200 si `ok`, 400 si no; 503 `Gestión de plantas no disponible` si no hay servicio.
- `DELETE /api/floors/:slug` con cuerpo `{ confirm: string }` → `await floors.remove(slug, body)`; 200 si `ok`, si no el `status` del servicio (`c.json({ ok: false, error }, status)`). Hono acepta cuerpo en DELETE y `readJson` ya tolera que no lo haya (`hub/src/server.ts:281-287`).

Las respuestas de error llevan `error` en el JSON porque `readError` de la UI lo muestra tal cual (`ui/src/api.ts:21-43`).

`add(raw)`, en este orden, devolviendo el primer error:

1. `path` obligatorio (`text(body.path)`); `slug` si viene pasa por `checkSlug` y no supera 80 caracteres (tope que ya usan `/api/memory/:floor`, `hub/src/server.ts:121`, y `addLesson`, `hub/src/office.ts:527`); `baseBranch` si viene pasa por `validBranch` (`hub/src/config.ts:119-128`).
2. `real = resolveDir(path)` → "No existe …" o "… no es una carpeta" (mensajes de `hub/src/floor-cli.ts:71-73`).
3. `real` no puede estar dentro del repositorio de documentos (`docsRepoPath`) ni del `workspace`: el resolutor los atiende antes que a las plantas (`hub/src/floors.ts:95-99`) y la planta quedaría a la sombra. Mensaje: "… es parte de la oficina, no puede ser una planta."
4. `gitSync(real, ['rev-parse', '--show-toplevel'])` (`hub/src/git.ts:30-42`): si falla, "… no es un repositorio git."; si la raíz no coincide con `real`, "… está dentro del repositorio <raíz>: la planta tiene que ser su raíz." Es más estricto que el CLI y a propósito: Redacción hace fetch y worktrees sobre la planta (`hub/src/sync.ts:249-275`) y la guardia compara con git (`hub/src/guard.ts`), así que una carpeta sin git es una planta a medias.
5. `wanted = slug ?? slugify(basename(real))`; si `config.floors[wanted]?.managed` y su ruta real es `real` → "La planta "x" ya existe."; si es otra ruta → "Ya hay una planta llamada "x" (<ruta>). Elige otro nombre."; si otra planta gestionada tiene esa misma ruta → "<ruta> ya es la planta "y"." Después `planFloor(p, profiles, real, wanted)` queda como red de seguridad (sus propios errores también se devuelven).
6. `branch = baseBranch ?? config.floors[wanted]?.baseBranch ?? detectBaseBranch(real)` (`hub/src/floor-cli.ts:43-55`). Comprobación con `gitSync(real, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/<branch>'])` y, si falla, `refs/heads/<branch>`. Si ninguna existe: "La rama <branch> no existe en <ruta> (ni en local ni en origin)." y, cuando el usuario no escribió rama, se añade "Indica la rama base.": `detectBaseBranch` devuelve `develop` aunque no exista.
7. `writeFloor(p, profiles, { ...plan, baseBranch: branch })`, `onSaved(loadConfig(p))`, `opened = open === true ? deps.open('lead-<slug>') : false`, línea en `hub.log`.

La nota de éxito sigue el estilo de `SETTINGS_NOTE` (`hub/src/settings.ts:19-20`): "Planta <slug> (<stack>) añadida: 3 agentes y su lanzador. Su jefe de planta se está abriendo en una terminal." o, si no se pidió abrirlo, "Ábrelo con: sh <lanzador>". Y siempre: "El director en marcha no la verá hasta que lo reinicies (bun run office)."

`remove(slug, raw)`:

1. `config.floors[slug]` no existe → 404 "No hay ninguna planta "x"." (incluye las observadas de config: no aparecen en el panel pero sí podrían llegar por API).
2. `confirm !== slug` → 400 "Para borrar la planta escribe su nombre exacto: x."
3. `office.tick()` (cierra las sesiones cuyo socket ya no existe, `hub/src/office.ts:609-612`) y `office.liveSessionsOn(slug)`; si hay alguna → 409 "La planta x tiene N sesiones abiertas: lead-x, … Ciérralas antes de borrarla."
4. `agents = deleteFloor(p, profiles, slug)`.
5. `summary = await office.forgetFloor(slug, realPath(floor.path), loadConfig(p), profiles())` (D6).
6. Línea en `hub.log` y respuesta con `removed: { agents, rows, worktrees }`.

### D3. Sin reiniciar el hub: la recarga ya es en caliente

No hace falta reiniciar. `createSettings.update` ya llama a `onSaved(config)` (`hub/src/settings.ts:111`), que en `main.ts` es `reload` → `office.reload(config, profiles)` (`hub/src/main.ts:52-63`); además el hub vigila `config.json` y recarga sola a los 200 ms (`hub/src/main.ts:72`, `hub/src/config-watch.ts:30-35`). `Office.reload` sustituye la configuración, vuelve a asignar planta a las sesiones vivas y emite `floors` y `settings` (`hub/src/office.ts:615-635`); el `Store` de la UI marca el tema `floors` (`ui/src/store.ts:127-130`) y la escena 3D, la 2D, la tabla, el panel de memoria y el de pedidos se reconstruyen (`ui/src/scene/scene.ts:183`, `ui/src/office/office.ts:107`, `ui/src/table/table.ts:257`, `ui/src/panel/memory.ts:214`, `ui/src/panel/orders.ts:140`). El servicio nuevo usa el mismo `onSaved`.

Lo que no es en caliente, y se dice en la nota de guardado: las sesiones de Claude ya abiertas. El director recibe la lista de plantas por `--append-system-prompt-file director-floors.md` al arrancar (`hub/src/office-sh.ts:35`) y los agentes fijos leen su `.md` al empezar; se regeneran en disco pero la sesión viva no los relee. Es la misma limitación que ya documenta `SETTINGS_NOTE`.

### D4. Validar en el hub; la UI solo evita viajes inútiles

El hub es la fuente de verdad (ruta, git, rama y duplicados necesitan disco). La UI replica lo barato antes de enviar: ruta no vacía, nombre con `SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/` (nuevo en `ui/src/settings/options.ts`, espejo de `checkSlug`) y rama con la `validBranch` que ya tiene `ui/src/settings/draft.ts:72-80`. Los mensajes del hub se muestran en el mismo `settings-status` que usa el guardado (`ui/src/settings/settings.ts:386-401`).

### D5. Con sesiones abiertas no se borra

El hub no tiene manera de cerrar una sesión de Claude: `order()` solo entrega texto por el socket (`hub/src/office.ts:498-516`) y los lanzadores los abre el usuario en su terminal o tmux (`hub/src/office-sh.ts:141-169`). Matar procesos desde una petición HTTP sería frágil y perdería trabajo en curso. Por eso el borrado se rechaza con 409 y la lista de sesiones (`name` o los 8 primeros caracteres del id), y el panel lo muestra. `office.liveSessionsOn(slug)` = sesiones con `floor === slug` y `endedAt === null` (`SessionRuntime`, `hub/src/office.ts:98-112`). Una sesión que se cerró hace menos de diez minutos sigue en memoria pero ya con `endedAt` (`FORGET_ENDED_MS`, `hub/src/office.ts:155`) y no bloquea.

### D6. Inventario de lo que se guarda por planta y cómo se borra

| Qué | Dónde | Cómo se borra |
|---|---|---|
| Configuración | `~/.config/agent-office/config.json` → `floors.<slug>` (`hub/src/config.ts:167-182`) | `deleteFloor` |
| Agentes | `~/.claude/agents/office-{lead,dev,tester}-<slug>.md` (`hub/src/agents.ts:45-50`) | `deleteFloor` |
| Lanzador y listas | `~/.config/agent-office/sessions/lead-<slug>.sh`; la planta en `office.sh` (`NAMES`) y en `director-floors.md` (`hub/src/office-sh.ts:73-97`, `171-182`); su línea en los agentes fijos (`floorsList`, `hub/src/agents.ts:59-68`) | `writeOfficeScripts` + `writeFixedAgents` dentro de `deleteFloor` |
| Base de datos, tablas con columna `floor` | `office.db`: `events`, `sessions`, `agents`, `edits`, `verdicts`, `messages`, `questions`, `lessons`, `reports`, `floor_sync`, `sync_worktrees`, `alerts` (`hub/src/db.ts:15-187`) | `forgetFloorRows` |
| Base de datos, registro de plantas observadas | `floors` (`slug`, `path`) (`hub/src/db.ts:55-59`, `dbRegistry` `hub/src/db.ts:238-249`) | `forgetFloorRows`, por `slug` o por `path` real |
| Base de datos, tablas por equipo | `tasks.scope` y `gate_decisions.scope` son el equipo (`team` de la sesión o `session-<8 chars>`, `teamOfSession` `hub/src/office.ts:181-183`), no la planta | `forgetFloorRows`, por los equipos de las sesiones de la planta, antes de borrar `sessions` |
| Mensajes recibidos | `messages.to_key` apunta a agentes o sesiones de la planta aunque `floor` sea la del remitente (por ejemplo, el director escribiendo a `lead-<slug>`) | `forgetFloorRows`, antes de borrar `agents` y `sessions` |
| Fotos de Redacción | `<docsRepo>/redaccion/.fuentes/<plan>/<slug>/` (worktrees, `hub/src/sync.ts:10`, `232`, `274`) y su registro en `<repo>/.git/worktrees/` | `SyncDesk.removeFloor` |
| Memoria del hub | `sessions`, `agents`, `messages`, `activity` (`hub/src/office.ts:201-207`) | purga en `forgetFloor` |
| `hub.log` | Solo arranques, errores y señales (`hub/src/main.ts:26-30`); nada por planta | No se toca; se añade una línea de auditoría del alta y de la baja (ver Preguntas abiertas) |

Nuevo `hub/src/forget.ts`, con el estilo de `prune.ts` (`hub/src/prune.ts:5-22`), `forgetFloorRows(db, slug, path): number` en una transacción, en este orden:

```sql
DELETE FROM tasks WHERE scope IN (SELECT team FROM sessions WHERE floor = ? AND team IS NOT NULL)
   OR scope IN (SELECT 'session-' || substr(session_id, 1, 8) FROM sessions WHERE floor = ?);
DELETE FROM gate_decisions WHERE scope IN (…misma subconsulta…);
DELETE FROM messages WHERE floor = ?
   OR to_key IN (SELECT agent_key FROM agents WHERE floor = ?)
   OR to_key IN (SELECT session_id FROM sessions WHERE floor = ?);
DELETE FROM events WHERE floor = ?;        DELETE FROM edits WHERE floor = ?;
DELETE FROM verdicts WHERE floor = ?;      DELETE FROM questions WHERE floor = ?;
DELETE FROM alerts WHERE floor = ?;        DELETE FROM lessons WHERE floor = ?;
DELETE FROM reports WHERE floor = ?;       DELETE FROM floor_sync WHERE floor = ?;
DELETE FROM sync_worktrees WHERE floor = ?;
DELETE FROM agents WHERE floor = ?;        DELETE FROM sessions WHERE floor = ?;
DELETE FROM floors WHERE slug = ? OR path = ?;
```

Nuevo `SyncDesk.removeFloor(floor): Promise<number>` junto a `remove` (`hub/src/sync.ts:160-171`): por cada fila de `sync_worktrees` con ese `floor`, en la cola de su repo, `git worktree remove --force <path>` y `git worktree prune` si el repo existe, `removeDir(path)` (que solo borra dentro de `.fuentes`, `hub/src/sync.ts:325-330`), borra la fila y, si la carpeta del plan quedó vacía, la quita; al final `onChange()` para que los documentos recalculen `base`/`ahead`. Devuelve cuántas fotos quitó.

Nuevo `Office.forgetFloor(slug, path, config, profiles): Promise<{ rows: number; worktrees: number }>`, en este orden y por esta razón:

1. Purga en memoria: borra de `this.sessions` y `this.agents` lo que tenga `floor === slug`, quita de `this.messages` lo de esa planta y de `this.activity` las entradas de los agentes purgados. Va antes de `reload` porque `reload` recorre `this.sessions` y re-resuelve su `cwd` (`hub/src/office.ts:619-630`); con la planta ya fuera de `config.floors`, una sesión terminada pero aún en memoria haría que `FloorResolver.resolve` registrase el repo como observado con el mismo nombre (`hub/src/floors.ts:103-111`), resucitando una fila en `floors`.
2. `this.reload(config, profiles)`: emite `floors` y `settings` sin la planta.
3. `worktrees = await this.sync.removeFloor(slug)` (necesita las filas de `sync_worktrees`, así que va antes del paso 4).
4. `rows = forgetFloorRows(db, slug, path)`.
5. `this.emit({ type: 'snapshot', data: this.snapshot() })` y una entrada de actividad "planta borrada desde el panel: x". Se reutiliza `snapshot` en vez de añadir un tipo de mensaje nuevo: `Store.applySnapshot` ya vacía agentes, sesiones, mensajes y actividad y vuelve a marcar todos los temas (`ui/src/store.ts:265-281`), que es justo lo que hace falta para que no quede ningún agente ni mensaje de la planta en pantalla; el grabador y el replay ya lo entienden (`hub/src/recorder.ts:9`).

`Office.liveSessionsOn(slug): string[]` es el único otro método público nuevo.

Entre el paso 3 y el 4 el hub cede el control; si en ese hueco llega un evento tardío de una sesión ya cerrada de esa planta, `touchSession` la recrea como observada (`hub/src/office.ts:909-927`), que es el comportamiento normal para cualquier repositorio sin planta. Se acepta.

### D7. Abrir el jefe de planta desde el hub

Criterio 1 pide que el jefe de planta aparezca en el panel, y solo aparece si su sesión arranca. El hub ya sabe abrir sesiones: `main.ts --open` ejecuta `sh office.sh` (`hub/src/main.ts:115-122`), pero ese script abre todas (`hub/src/office-sh.ts:141-168`). Cambio en `officeScript`: tras `NAMES=…` añadir `if [ $# -gt 0 ]; then NAMES="$*"; fi`, de modo que `sh office.sh lead-mobile` abre solo esa. En `main.ts` el `open` por defecto es `Bun.spawn(['sh', p.officeSh, name], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })` dentro de un `try` (devuelve `false` si no se pudo lanzar). Si no hay tmux ni osascript el script solo imprime instrucciones, por eso la nota de éxito incluye siempre el comando manual del lanzador. En tests `open` es un espía.

### D8. Interfaz: sección "Plantas" de Ajustes

En `ui/src/settings/settings.ts`, `buildControls` (`ui/src/settings/settings.ts:223-343`) cambia la sección "Plantas":

- Cada planta gestionada pasa de `label.setting-row` a `div.setting-row` con el `label` (nombre, chip del stack, ruta y el campo de rama que ya existe) y un `button('Borrar', 'danger')`. Al pulsarlo se despliega debajo un bloque `floor-confirm`: texto "Vas a borrar la planta x y todo lo que la oficina guarda de ella: agentes, lanzador, lecciones, informes, registro de actividad y fotos de Redacción. El repositorio no se toca.", un campo "Escribe x para confirmar" y los botones "Borrar definitivamente" (deshabilitado hasta que el texto coincida) y "Cancelar". Confirmar llama a `api.deleteFloor(slug, texto)`; el resultado va a `this.outcome` y a un `store.toast`; el mensaje `settings` que emite el hub trae la lista sin la planta, cambia la `signature` (`ui/src/settings/settings.ts:201-207`) y la sección se reconstruye sola.
- Debajo, un formulario `floor-form` "Añadir planta": `textInput` para ruta (placeholder `~/Projects/mi-app`), nombre (placeholder "el de la carpeta") y rama base (placeholder "se detecta"), un `toggleRow` "Abrir su jefe de planta en una terminal" marcado, y `button('Añadir', 'primary')`. Validación local (D4) con `markInvalid`; al enviar, `api.addFloor(...)` con un indicador `busy` propio que deshabilita el formulario. Si el hub responde `ok`, el `settings` posterior reconstruye la sección (y vacía el formulario); si responde error, la lista no cambia, el formulario conserva lo escrito y el error se ve en `settings-status`.

Estas acciones no pasan por el borrador ni por "Guardar": son inmediatas, como borrar una lección en el panel de memoria. Por eso viven dentro del mismo `fieldset` (se deshabilitan sin conexión igual que el resto, `ui/src/settings/settings.ts:373`) pero no tocan `draft`. `reconcileDraft` ya absorbe plantas nuevas o desaparecidas conservando las ramas que el usuario esté editando (`ui/src/settings/draft.ts:104-108`).

`ui/src/api.ts` gana:

```ts
addFloor(request: FloorCreate): Promise<ApiData<FloorCreateResult>> { return this.send('POST', '/api/floors', request); }
deleteFloor(slug: string, confirm: string): Promise<ApiData<FloorDeleteResult>> {
  return this.send('DELETE', `/api/floors/${encodeURIComponent(slug)}`, { confirm });
}
```

CSS en `ui/src/styles.css`, junto a `.setting-row` (`ui/src/styles.css:982-1033`): `button.danger` (no existe hoy; `button.primary` está en `ui/src/styles.css:95`), `.floor-form` (rejilla de tres campos) y `.floor-confirm`.

### D9. Documentación

README: en "Plantas" (`README.md:34-49`) la fila "Cómo nace" pasa a "`bun run floor add <ruta>` o desde Ajustes", se añade que desde Ajustes se borra con todos sus datos y que `floor remove` solo la vuelve observada; en "Ajustes" (`README.md:53`) se añaden el alta y la baja de plantas y la nota sobre el director.

## Pasos

1. `hub/src/types.ts`: añadir `FloorCreate`, `FloorCreateResult` y `FloorDeleteResult` (D2). Verificable: `bun run typecheck` pasa en hub y ui.
2. `hub/src/floor-cli.ts`: `FloorPlan.baseBranch?`, `writeFloor` lo respeta, exportar `resolveDir`, añadir `deleteFloor` (D1). Verificable: test nuevo en `hub/test/floor-cli.test.ts` "deleting a floor removes its agents, its launcher and its config entry" (config sin la clave, `sessions/lead-x.sh` ausente, `office.sh` y `director-floors.md` sin la planta); los tests existentes de `removeFloor` siguen igual.
3. `hub/src/git.ts`: `gitToplevel(dir): string | null` y `branchExists(dir, branch): boolean` sobre `gitSync` (D2, pasos 4 y 6 del alta). Verificable: test en `hub/test/units.test.ts` con `originAndClone` (`hub/test/helpers.ts:109-122`): `develop` existe vía `origin`, `feature/local` existe en local, `release/9` no.
4. `hub/src/office-sh.ts`: `officeScript` acepta nombres por argumentos (D7). Verificable: en `hub/test/units.test.ts:219-221` comprobar que el script contiene `if [ $# -gt 0 ]; then NAMES="$*"; fi`.
5. `hub/src/forget.ts` con `forgetFloorRows` (D6). Verificable: test `hub/test/forget.test.ts` que siembra una fila por tabla para `mobile` y otra para `web`, llama con `mobile` y comprueba `COUNT(*) = 0` para `mobile` en las 14 tablas y `COUNT(*) = 1` para `web`; incluye un mensaje con `floor = 'direccion'` y `to_key` del lead de `mobile` (debe borrarse) y una tarea con `scope = 'session-<8 del lead>'` (debe borrarse).
6. `hub/src/sync.ts`: `SyncDesk.removeFloor` (D6). Verificable: en `hub/test/sync.test.ts`, tras un `sync` de un plan con dos plantas, `removeFloor('mobile')` deja la foto de la otra, borra `.fuentes/<plan>/mobile`, `git worktree list` del repo ya no la lista y `sync_worktrees` solo tiene la otra fila.
7. `hub/src/office.ts`: `liveSessionsOn` y `forgetFloor` (D5, D6). Verificable: test en `hub/test/office.test.ts`, sección "configuration reload" (`hub/test/office.test.ts:336`): con una sesión `SessionStart` en la planta, `liveSessionsOn` la devuelve; tras `SessionEnd`, está vacía; `forgetFloor` deja `snapshot().floors` y `snapshot().agents` sin la planta, la base sin filas y el último mensaje emitido es `snapshot`.
8. `hub/src/floor-admin.ts` con `createFloorAdmin` (D2). Verificable: paso 11.
9. `hub/src/server.ts`: rutas y `ServerOptions.floors`; `hub/src/main.ts`: `createFloorAdmin({ p, profiles, office, onSaved: reload, open, log: (t) => logLine(p, t) })` y pasarlo a `startServer` (D2, D7). Verificable: en `hub/test/server-v2.test.ts`, con un `FloorAdmin` falso como el `settings` falso de `hub/test/server-v2.test.ts:29-35`: `POST /api/floors` devuelve 200/400 según el servicio, `DELETE /api/floors/x` propaga 404 y 409, ambos 401 sin clave; en `hub/test/server.test.ts` (sin servicio) devuelven 503.
10. `ui/src/api.ts`, `ui/src/settings/options.ts`, `ui/src/settings/settings.ts`, `ui/src/styles.css` (D4, D8). Verificable: `bun run typecheck` y `bun run build`; prueba manual de Verificación.
11. `hub/test/floor-admin.test.ts` (criterio 4), con `harness()` (`hub/test/helpers.ts:55-86`), `fakePaths(h.root)` y `saveConfig(p, h.config)` para que disco y oficina coincidan, `originAndClone` para el repo, `ensureDocsRepo(join(h.root, 'docs'))` para las fotos, `onSaved: (c) => h.office.reload(c, profiles)` y `open` espía:
    - Alta: respuesta `ok` con `slug: 'mobile'`, `stack`, `baseBranch: 'develop'`, `files: 3`; `loadConfig(p).floors.mobile` con `managed: true`; existen los tres agentes y `sessions/lead-mobile.sh`; `office.sh` lista `lead-mobile`; `director-floors.md` la menciona; `h.office.snapshot().floors` la tiene como `managed`; `h.messages` contiene `floors` y `settings`; `open` recibió `lead-mobile` solo con `open: true`.
    - Validaciones, cada una con su mensaje: ruta inexistente ("No existe"), carpeta sin git ("no es un repositorio git"), subcarpeta de un repo ("tiene que ser su raíz"), nombre reservado `redaccion`, nombre con mayúsculas, nombre de otra planta ("Elige otro nombre"), misma ruta con otro nombre ("ya es la planta"), misma planta repetida ("ya existe"), rama inexistente con y sin rama escrita ("no existe en", "Indica la rama base"), repo sin `origin/develop` ni `origin/HEAD` con rama local `main` escrita (debe aceptarse).
    - Baja: siembra de datos reales por la vía normal (`ingest` de `SessionStart`, `PreToolUse` Edit, `SendMessage`, `Stop`, `SessionEnd` con `leadMeta` como en `hub/test/office.test.ts:13`; `addLesson`; `syncSources` de un plan sobre `mobile`), más filas sembradas a mano en las tablas que no se alimentan fácil (`alerts`, `questions`, `floor_sync`, `gate_decisions`). Comprobaciones: `confirm` erróneo → 400; con la sesión viva → 409 y el mensaje nombra `lead-mobile`; tras `SessionEnd` → `ok` con `removed.agents === 3`, `removed.worktrees === 1`, `rows > 0`; `COUNT(*) = 0` para `mobile` en las 14 tablas y en `floors`; `config.floors.mobile` ausente; agentes y lanzador borrados; `office.sh` y `director-floors.md` sin la planta; `.fuentes/<plan>/mobile` ausente y `git -C repo worktree list` sin ella; `snapshot()` sin la planta ni sus agentes; los datos de otra planta `web` intactos; el repo `mobile` sigue existiendo con su `README.md`.
12. README (D9). Verificable: lectura.

## Riesgos

- Doble recarga: `onSaved` y el vigilante de `config.json` recargan ambos (`hub/src/main.ts:52-72`). Ya pasa con Ajustes y `reload` es idempotente; solo emite `floors`/`settings` dos veces.
- Resurrección como observada: si tras el borrado el usuario abre una sesión normal de Claude en ese repositorio, el resolutor lo registra como planta observada con el nombre de la carpeta (`hub/src/floors.ts:105-111`). No es un resto: es el comportamiento de cualquier repositorio nuevo, y la fila solo guarda `slug`, `path` y `stack`.
- `git worktree remove` escribe en el `.git` del proyecto. Es retirar lo que la oficina puso ahí; `SyncDesk.remove` ya lo hace al cerrar un plan. Si el repositorio ya no existe, se salta git y se borra solo la carpeta de la foto.
- Fotos a medias: `removeFloor` borra fila a fila; si git falla en una, la fila queda y `forgetFloorRows` la elimina después. La carpeta residual, si la hubiera, la recoge `cleanup` al arrancar (`hub/src/sync.ts:193-217`).
- Carrera entre la comprobación de sesiones y la purga: una sesión que arranque en ese hueco acabará como observada (D6, último párrafo). Es una ventana de milisegundos y no deja datos de la planta gestionada.
- Abrir terminales desde una petición HTTP: solo escucha en 127.0.0.1 con clave (`hub/src/server.ts:175-177`, `requireKey`) y es lo mismo que hace `bun run office`. Si el entorno no tiene tmux ni osascript, el script solo imprime; la nota lleva el comando manual.
- El director en marcha sigue con su lista antigua de plantas hasta reiniciarlo. Se dice en la nota y en el README; igual que con el resto de Ajustes.
- Sobrescribir agentes huérfanos sin preguntar (D1): solo afecta a ficheros `office-*-<slug>.md` de una planta que ya no está en `config.json`.
- Reemitir un `snapshot` completo reinicia la selección y las listas del panel para todos los clientes conectados. Es una acción administrativa rara y el coste es un repintado.

## Verificación

Automática, en el clon (`CLAUDE.md:15-18`):

```sh
bun run test                      # cd hub && bun test: incluye floor-admin, forget, sync, office, server-v2, units, floor-cli
cd hub && bun test test/floor-admin.test.ts test/forget.test.ts
bun run typecheck                 # hub y ui
bun run build                     # la UI compila con la sección nueva
```

Manual, con un hub de pruebas aislado (`CLAUDE.md:18`), nunca contra `~/.config/agent-office`:

```sh
export AGENT_OFFICE_HOME=/tmp/ao-home AGENT_OFFICE_CLAUDE_HOME=/tmp/ao-claude
mkdir -p $AGENT_OFFICE_HOME && echo '{"port":4799,"docsRepo":"/tmp/ao-docs"}' > $AGENT_OFFICE_HOME/config.json
bun run setup && bun run build && bun run hub
```

1. En Ajustes, "Añadir planta" con la ruta de un clon cualquiera y rama `develop`: aparece el piso en la vista 3D (`?view=3d`) y 2D sin recargar; en la terminal que se abre arranca `lead-<slug>` y su figura aparece en el piso. Comprobar en disco: `floors.<slug>` en `$AGENT_OFFICE_HOME/config.json`, `office-{lead,dev,tester}-<slug>.md` en `$AGENT_OFFICE_CLAUDE_HOME/agents`, `$AGENT_OFFICE_HOME/sessions/lead-<slug>.sh`, la planta en `office.sh` y en `director-floors.md`.
2. Probar cada validación y leer el mensaje en el panel: ruta que no existe, carpeta sin git, subcarpeta de un repo, nombre `redaccion`, nombre repetido, misma ruta con otro nombre, rama `no-existe`.
3. Con `lead-<slug>` abierto, pulsar "Borrar", teclear el nombre y confirmar: el panel dice que hay una sesión abierta y la nombra. Cerrar la sesión y repetir: el piso desaparece, el panel queda sin sus agentes y la nota da las cuentas.
4. Comprobar que no queda rastro:

```sh
grep -c '"<slug>"' $AGENT_OFFICE_HOME/config.json                    # 0
ls $AGENT_OFFICE_CLAUDE_HOME/agents | grep -- "-<slug>.md"            # vacío
ls $AGENT_OFFICE_HOME/sessions | grep "lead-<slug>"                   # vacío
grep -c "<slug>" $AGENT_OFFICE_HOME/office.sh $AGENT_OFFICE_HOME/director-floors.md $AGENT_OFFICE_CLAUDE_HOME/agents/office-director.md   # 0 en los tres
for t in events sessions agents edits verdicts messages questions lessons reports floor_sync sync_worktrees alerts; do
  echo "$t $(sqlite3 $AGENT_OFFICE_HOME/office.db "SELECT COUNT(*) FROM $t WHERE floor = '<slug>'")"; done   # todo 0
sqlite3 $AGENT_OFFICE_HOME/office.db "SELECT COUNT(*) FROM floors WHERE slug = '<slug>'"                      # 0
ls /tmp/ao-docs/redaccion/.fuentes/*/<slug> 2>/dev/null                                                       # nada
git -C <repo> worktree list | grep -c .fuentes                                                                # 0
grep "<slug>" $AGENT_OFFICE_HOME/hub.log                                                                      # solo las líneas de auditoría del alta y la baja
```

## Preguntas abiertas

- `hub.log` recibirá una línea por alta ("planta x añadida desde el panel") y otra por baja (con las cuentas). Es el registro del operador del hub, no datos del proyecto, y ayuda a saber qué pasó; si se prefiere que ni el nombre quede ahí, se quitan las dos líneas y la única huella es la entrada de actividad en memoria.
- Las plantas observadas que `bun run floor remove` deja en `config.json` (`managed: false`) no se muestran en Ajustes y, por tanto, no se pueden borrar desde el panel; solo por API. ¿Conviene listarlas con su botón de borrar en una iteración posterior?
- La casilla "Abrir su jefe de planta" va marcada por defecto. Si el usuario suele abrir las sesiones con `bun run office`, podría preferirse desmarcada.

## Historial de revisión

- Ronda 1: versión inicial.
