# Zona de escritura por encargo y marcador de propiedad de las fotos (M6 + M8)

## Contexto

Plan de implementación derivado de la auditoría `redaccion/planes/auditoria-agent-office.md`: hallazgos S5 y S6, mejoras M6, M8 y la regla M24 (los tests se escriben antes del cambio, en la misma rama), y sus dos riesgos asociados («M6 depende de que el nombre del agente llegue a tiempo» y «M8 deja huérfanas las fotos de hubs antiguos»).

Base:

- agent-office-dev build/v1 @ 7c89614 (2026-10-16). Sin cambios desde el último plan sobre esta planta.

Los dos problemas, verificados en la foto:

- **S5.** La zona de escritura de la guardia es por departamento: `zonesFor` (`hub/src/guard.ts:34-49`) devuelve para cualquier rol de Redacción `allowed: [docsRoot/redaccion]` y `forbidden: [docsRoot/redaccion/.fuentes]`, y para Mantenimiento `allowed: [docsRoot/taller]`. Con tres planes en paralelo, un redactor que se equivoque de slug puede escribir `redaccion/planes/<otro>.md` o `redaccion/historial/<otro>.md`, y la puerta de `HECHO:` del otro encargo se cierra porque hay un cambio posterior a su `APROBADO:` (`hub/src/gate.ts:48`). El hub ya conoce el nombre del agente (`AgentRuntime.name`, `hub/src/office.ts:95`, rellenado en `applySpawn` `office.ts:1385` y `resolveSpawnType` `office.ts:1381`; `toAuthor` lo usa para reconocer a `redactor-<slug>` en `office.ts:1104-1110`), pero `guard()` (`office.ts:594-617`) solo pasa el rol a `guardDecision`.
- **S6.** `SyncDesk.cleanup` (`hub/src/sync.ts:211-235`) recorre `redaccion/.fuentes/*/*` y retira con `git worktree remove --force` + `rmSync` toda carpeta cuya ruta no esté en `sync_worktrees`. `Office.start()` lo lanza en cada arranque (`office.ts:330`). Un hub con base de datos nueva y el mismo `docsRepo` (hub de pruebas sin `docsRepo` temporal, restauración de `office.db`, segundo hub por error) destruye las fotos de los planes en curso. La memoria del puesto de redactor guarda ya dos lecciones por este motivo.

## Objetivo

Criterios de aceptación del encargo, literales:

- M6. `zonesFor` (hub/src/guard.ts) recibe el nombre del agente: `redactor-<slug>` solo escribe redaccion/planes/<slug>.md y redaccion/historial/<slug>.md; `artesano-<nombre>` solo taller/skills/<nombre>/. El jefe conserva la zona del departamento. Si el nombre aún no se conoce, se aplica la zona del departamento (comportamiento actual); nunca bloquear de más.
- M8. `syncFloor` escribe redaccion/.fuentes/<slug>/.office con el id del hub (~/.config/agent-office/id, generado en `setup`). `cleanup` (hub/src/sync.ts) salta las entradas que empiezan por `.`, solo retira carpetas con su propio id y, si la base de datos está vacía y hay carpetas de otro, registra un aviso y no toca nada. La primera vez adopta las carpetas sin marcador que estén en su base de datos y avisa de las demás en la actividad.
- Test en hub/test/guard.test.ts: `redactor-a` escribiendo planes/b.md se bloquea con el motivo; planes/a.md pasa.
- Test en hub/test/sync.test.ts: con BD vacía y una foto ajena, `cleanup` devuelve `[]` y la carpeta sigue.
- Regla M24: el test de M8 (y los de M6) se escriben antes del cambio, misma rama; fallan con `git stash` de la corrección y pasan con ella.
- `bun run test` y `bun run typecheck` en verde, validados por el tester de la planta.

## Alcance

Entra:

- Zona por encargo en `zonesFor` para `office-redactor` con nombre `redactor-<slug>` y para `office-artesano` con nombre `artesano-<nombre>`, aplicada a las herramientas de edición (Edit, Write, MultiEdit, NotebookEdit); paso del nombre desde `Office.guard()`. La rama Bash de la guardia conserva la zona del departamento (ver Diseño).
- Fichero `id` del hub en `AGENT_OFFICE_HOME`, creado por `setup` (y por `main` si falta, ver Diseño), y pasado a `Office` y a `SyncDesk`.
- Marcador `.office` por slug en `redaccion/.fuentes/<slug>/`, escrito por `syncFloor`; `cleanup` que respeta la propiedad, adopta lo propio sin marcar y avisa en la actividad de lo ajeno.
- Tests nuevos (antes del cambio) en `hub/test/guard.test.ts`, `hub/test/sync.test.ts` y `hub/test/departments.test.ts`; adaptación de los tests existentes que el cambio invalida.
- Clave de actividad nueva `hub.act.sourcesForeign` en `hub/src/types.ts`, `ui/src/i18n/es.ts` y `ui/src/i18n/en.ts`.
- Dos frases del README y de las plantillas de redactor y artesano que describen la zona.

Queda fuera:

- M7 (red de seguridad sobre `office-docs` y `~/.claude`), M28 (baseline compartida) y el resto de la auditoría.
- Cambiar la detección de rutas en Bash (`shellPaths`), que sigue siendo parcial por diseño, y restringir por encargo las escrituras hechas desde Bash: en Bash rige la zona del departamento, como hoy.
- Migrar o borrar fotos ajenas: el hub solo avisa; limpiar a mano es decisión del usuario.
- Regenerar `~/.claude/agents` con las plantillas retocadas: eso lo hace el usuario desde la copia en vivo (`bun run setup` está prohibido en el clon por el `CLAUDE.md` de la planta).

### Carpetas y ficheros que toca

| Fichero | Qué cambia |
|---|---|
| `hub/src/guard.ts` | `zonesFor(role, ctx, name)`, `Zones.order`, `GuardInput.name`, mensaje de bloqueo por encargo |
| `hub/src/office.ts` | **Sí se toca**, en tres puntos acotados: `guard()` pasa `agent.name` a `guardDecision` (`office.ts:600-603`); `OfficeOptions` gana `hubId: string` (`office.ts:170-184`) y el constructor lo pasa a `SyncDesk` junto con `onForeign` (`office.ts:292-299`). Nada más; la exención de `GuardWatch` (`office.ts:317`) no cambia. |
| `hub/src/sync.ts` | marcador `.office`, `SyncOptions.id` y `SyncOptions.onForeign`, nuevo `cleanup`, `removeDir` que ignora entradas `.` al medir «vacío» |
| `hub/src/config.ts` | `Paths.id`, `readId`, `createIdIfMissing` |
| `hub/src/setup.ts` | crea el id junto a la key |
| `hub/src/main.ts` | crea el id si falta y pasa `hubId` a `Office` |
| `hub/src/types.ts` | clave `'hub.act.sourcesForeign': { n: number; dirs: string }` en `HubTextParams` |
| `ui/src/i18n/es.ts`, `ui/src/i18n/en.ts` | texto de `hub.act.sourcesForeign` |
| `hub/test/guard.test.ts` | tests M6 (unitarios) |
| `hub/test/units.test.ts` | test de `createIdIfMissing`, junto al de la key (`:106-117`) |
| `hub/test/sync.test.ts` | tests M8; adapta el caso `fantasma` |
| `hub/test/departments.test.ts` | caso M6 a través del hub; `hubId` en las dos construcciones manuales de `Office` (`:471`, `:537`) |
| `hub/test/office.test.ts` | `hubId` en la construcción manual de `Office` (`:522`) |
| `hub/test/helpers.ts` | `hubId: 'hub-test'` en `harness()` |
| `README.md` | línea 88 (fotos y marcador), línea 147 (guardia por encargo) y línea 158 (prueba en vivo de la guardia) |
| `plugin/templates/redactor.md.tpl:43`, `plugin/templates/artesano.md.tpl:23` | la frase «La oficina bloquea las escrituras fuera de …» pasa a nombrar el encargo |

No se toca: `hub/src/gate.ts`, `hub/src/state-machine.ts`, `hub/src/documents.ts`, `hub/src/db.ts` (no hay cambio de esquema: el marcador vive en disco), `plugin/hooks/*`, `plugin/scripts/*`, `ui/src/**` fuera de `i18n/`.

## Diseño

### M6. Zona por encargo

**Dónde se decide la zona.** Todo en `zonesFor` (`guard.ts:34-49`), que es la única función que construye `Zones`.

Firma nueva: `zonesFor(role: string | null, ctx: GuardContext, name: string | null = null): Zones | null`. El parámetro opcional mantiene compilando las llamadas existentes (`guard.ts:224`, `office.ts:317`) y, sobre todo, cumple «si el nombre no se conoce, zona del departamento»: con `name === null` el resultado es byte a byte el de hoy.

**Solo para las herramientas de edición.** `guardDecision` (`guard.ts:222-259`) calcula dos zonas: `zonesFor(g.role, ctx, g.name ?? null)` para la rama de Edit/Write/MultiEdit/NotebookEdit (`guard.ts:229-235`) y `zonesFor(g.role, ctx)` (sin nombre, zona del departamento) para la rama Bash (`guard.ts:236-258`). Motivo, verificado en el código: `shellPaths` marca como escritura todo argumento posicional de un intérprete salvo el primero (`guard.ts:207`, `write = index > 0`, con `python3` en `INTERPRETERS`, `guard.ts:27`). En el comando del flujo real del artesano, `python3 …/init_skill.py pdf --path /docs/taller/skills` (`artesano.md.tpl:14`, `guard.test.ts:62`), el `pdf` posicional se resuelve contra el cwd (`/docs/taller/pdf` con el cwd del artesano) y `--path` da `/docs/taller/skills`; ninguna de las dos está dentro de `taller/skills/pdf`, así que una zona de encargo en Bash bloquearía al artesano en `guard.ts:256` en su primer paso. La detección en Bash es parcial por diseño (`README.md:147`), el redactor no tiene Bash (`redactor.md.tpl:4`) y el daño de S5 (pisar el plan de otro) ocurre con Edit/Write, donde la regla es exacta: ahí es donde se aplica el encargo. La exención de `GuardWatch` (`office.ts:317`) sigue con la zona del departamento, coherente con Bash, y por eso `office.ts:317` no cambia.

**Qué nombre vale como encargo.** Una función `orderOf(role, name): string | null` en `guard.ts`:

- `office-redactor` + `redactor-<slug>` → `<slug>`.
- `office-artesano` + `artesano-<nombre>` → `<nombre>`.
- Cualquier otra combinación (jefes `office-lead-*`, revisores, nombre sin guion, slug no válido) → `null`, y `zonesFor` devuelve la zona del departamento actual.

El `<slug>` se valida con `SLUG_PATTERN` (`hub/src/sync.ts:11`, `/^[a-z0-9][a-z0-9_-]{0,79}$/`), importada desde `./sync` para no duplicar la regla que ya aplica `parseSyncRequest` (`sync.ts:101`). `sync.ts` no importa `guard.ts`, así que no hay ciclo. Es la misma forma que `toAuthor` espera (`office.ts:1105`: `` `${ref.kind === 'plan' ? 'redactor' : 'artesano'}-${ref.slug}` ``) y la que mandan las plantillas de los jefes (`plugin/templates/lead-redaccion.md.tpl:18`: «nombre `redactor-<slug>`»).

**Zonas resultantes.** `Zones` gana `order: string | null` (el encargo, o `null` para la zona de departamento).

- Redactor con encargo: `label: 'redactor-<slug>'`, `order: '<slug>'`, `allowed: [docsRoot/redaccion/planes/<slug>.md, docsRoot/redaccion/historial/<slug>.md]`, `forbidden: [docsRoot/redaccion/.fuentes]`. `inZone` (`guard.ts:51-53`) usa `isInside(path, a)`, y `isInside(x, x)` es `true` (`hub/src/floors.ts:62-65`: `relative` vacío), así que una ruta de fichero en `allowed` funciona como «exactamente este fichero»; `planes/<slug>.md.bak` da `relative === '../<slug>.md.bak'` y queda fuera. `forbidden` se conserva por simetría con la zona del departamento aunque en la rama de edición no cambie el resultado (`.fuentes` ya no está en `allowed`).
- Artesano con encargo: `label: 'artesano-<nombre>'`, `order: '<nombre>'`, `allowed: [docsRoot/taller/skills/<nombre>]`, `forbidden: []`. Solo rige para Edit/Write; los scripts de `skill-creator` corren por Bash con la zona del departamento, como hoy.
- Jefes y revisores: sin cambios (`orderOf` devuelve `null`).

**Mensaje de bloqueo.** En la rama de Edit/Write (`guard.ts:229-235`), cuando `zones.order` no es nulo, el motivo es:

`Guardia de Agent Office: <label> solo escribe los ficheros de su encargo: <allowed unidos por " y ">. <target> es de otro encargo o queda fuera; si de verdad hace falta tocarlo, pídeselo a tu jefe.`

Para la zona de departamento el texto no cambia, y la rama Bash no cambia en absoluto (usa la zona del departamento). Los motivos de la guardia son texto en español devuelto al hook, como hoy (`guard.ts:218-220`); `hub/test/texts.test.ts` solo vigila `detail`/`summary` de la actividad, y la actividad del bloqueo sigue usando la clave `hub.act.guardBlocked` (`office.ts:613`).

**Paso del nombre desde el hub.** `GuardInput` (`guard.ts:17`) gana `name?: string | null`. En `Office.guard()` (`office.ts:600-603`) se añade `name: this.agents.get(e.agent_id ?? e.session_id)?.name ?? null`, el mismo mapa que la línea 613 ya consulta para el `who` de la actividad. No se deriva el nombre de `e.agent_type` directamente: en las fixtures reales `agent_type` trae a veces el tipo (`office-dev-office-sandbox`) y a veces el nombre (`tester-office-sandbox`, `hub/test/fixtures/team-sandbox.json:99,116`), y `resolveSpawnType` (`office.ts:1367-1382`) ya hace esa distinción al poblar `agent.name`. Si el agente aún no está en el mapa o no tiene nombre, `name` es `null` y rige la zona del departamento: es el riesgo de la auditoría resuelto por construcción.

**Por qué no se bloquea de más.** Los casos que hoy pasan y seguirán pasando: nombre desconocido; nombre `redactor` o `redactor-login-r1` (no casa el patrón o el slug incluye un sufijo, que sí sería un slug válido: `redactor-login-r1` daría encargo `login-r1`; no hay agentes con ese nombre porque los revisores se llaman `revisor-planes-<slug>-rN`, `lead-redaccion.md.tpl:28`); escrituras del jefe en cualquier parte de `redaccion/`; cualquier comando Bash que hoy pase. El test de `departments.test.ts:653-679` (`guard through the hub`) usa `ared-1` con nombre `redactor-login` y escribe `redaccion/planes/login.md`: sigue pasando porque el slug coincide. Y el fallback «nombre desconocido → departamento» a través del hub exige un agente con rol de Redacción pero sin entrada en `this.agents`: un evento con `agent_type: 'redactor-otro'` sin `SubagentStart` previo recibe rol `office-redactor` por `roleFromName` (`office.ts:988`, `scope.ts:99`) y `name === null`. Sin `agent_type`, `roleForEvent` devolvería `null` (`office.ts:983`) y la guardia dejaría pasar por «fuera de los departamentos» (`office.ts:599`), que no probaría nada.

### M8. Marcador de propiedad

**Id del hub.** `Paths` (`config.ts:28-40`) gana `id: join(home, 'id')`. `readId(p)` y `createIdIfMissing(p): { id, created }` copian el patrón de `readKey`/`createKeyIfMissing` (`config.ts:300-316`), con `randomBytes(8).toString('hex')` (16 caracteres: no es un secreto, solo un identificador; `writeAtomic` lo deja a 600 como el resto). `setup.ts:40-41` lo crea junto a la key e imprime `Id del hub en …`. `main.ts:34-42` llama también a `createIdIfMissing(p)` antes de construir `Office`: un hub ya instalado que se actualice sin volver a pasar por `setup` no tendría id, no podría marcar sus fotos y en el siguiente arranque las vería como «sin marcador». Crear el id en `main` es idempotente y evita esa ventana. El brief dice «generado en `setup`»: se genera ahí; `main` solo lo repone si falta.

**Dónde entra el id.** `OfficeOptions` (`office.ts:170-184`) gana `hubId: string` obligatorio (que `main.ts` tenga que pasarlo evita un valor por defecto compartido entre hubs que los haría dueños de las fotos de los demás). El constructor lo pasa a `SyncDesk` como `id: opts.hubId` (`office.ts:292-299`). `SyncOptions` (`sync.ts:53-60`) gana `id: string` y `onForeign?: (dirs: string[]) => void`.

**Marcador.** `redaccion/.fuentes/<slug>/.office`, una línea con el id. Está dentro de `redaccion/.fuentes/`, que el `.gitignore` del repositorio de documentos ya ignora (`hub/src/docs-repo.ts:5`), así que no ensucia commits. `syncFloor` lo escribe justo después de `mkdirSync(dirname(target))` y antes de `git worktree add` (`sync.ts:291-292`): si el proceso muere entre el `worktree add` y el `INSERT` de `sync_worktrees` (`sync.ts:312-319`), la carpeta huérfana ya lleva nuestro id y `cleanup` la retirará como propia. Solo se escribe si no existe: si otro hub ya marcó ese slug (dos hubs sincronizando el mismo slug sobre el mismo `docsRepo`), no se le roba; nuestra foto queda en nuestra base de datos y por eso nunca la retiramos nosotros. En la rama «foto reutilizada» (`sync.ts:252-266`) también se escribe el marcador si falta: adopción al primer `office-sync` tras actualizar.

**`cleanup` nuevo** (`sync.ts:211-235`), paso a paso:

1. Igual que hoy: retira con `remove(slug)` los slugs de la base de datos que están en `finished`.
2. `known` = rutas de `sync_worktrees` (tras el paso 1). `foreign: string[] = []`, `orphans: { slug, dir }[] = []`, `emptySlugs: string[] = []`.
3. Clasificación, sin tocar disco salvo la adopción. Para cada entrada `slug` de `.fuentes/` que no empiece por `.`: `floors` = entradas de `.fuentes/<slug>/` que no empiecen por `.`; `owner = readMarker(.fuentes/<slug>/.office)` (`null` si no hay).
   - **Adopción, antes de clasificar** (una pasada previa, para que el resultado no dependa del orden de `readdir`): si `owner === null` y alguna carpeta de `floors` está en `known`, se escribe el marcador con nuestro id y `owner = id`.
   - Para cada `floor`: si `known` tiene la carpeta, nada. Si no: con `owner !== id` (otro id **o sin marcador**) → `foreign.push('<slug>/<floor>')`; con `owner === id` → `orphans.push`.
   - Si `owner === id` o `owner === null`, `emptySlugs.push(slug)` (candidata a retirar la carpeta del slug si queda sin plantas).
4. **Regla de la base de datos vacía.** Si `known.size === 0` y `foreign.length > 0`: `this.opts.onForeign(foreign)` y `return removed` sin retirar nada más (ni huérfanas con nuestro id ni carpetas de slug). Es el criterio literal de M8: un hub con base de datos nueva que encuentra fotos de otro no toca nada, porque lo más probable es que **él** sea el intruso (hub de pruebas sin `docsRepo` temporal, segundo hub por error) y sus «huérfanas propias» sean, en realidad, fotos marcadas con un id reutilizado o restaurado. `removed` en ese punto es `[]`, porque el paso 1 con base de datos vacía no retira nada.
5. En el resto de casos: cada `orphan` se retira como hoy (`git worktree remove --force` si `worktreeRepo` la reconoce, `removeDir`, `sync.ts:223-226`) y se añade a `removed`; para cada slug de `emptySlugs`, `removeDir(.fuentes/<slug>, true)`.
6. Si `foreign` no está vacío, `this.opts.onForeign?.(foreign)`.
7. `git worktree prune` por planta, como hoy (`sync.ts:230-233`).
8. Devuelve `removed`.

Con la base de datos vacía y una foto marcada por otro hub, el paso 3 la clasifica como ajena y el paso 4 corta: `removed` es `[]` y la carpeta y su worktree siguen. Con base de datos no vacía, «solo retira carpetas con su propio id» (paso 5) protege igualmente las ajenas y las sin marcador.

**Por qué las carpetas sin marcador que no están en la base de datos no se borran.** El brief pide adoptar «las que estén en su base de datos» y «avisar de las demás». Una carpeta sin marcador y fuera de la base de datos puede ser de un hub anterior a este cambio con un plan en curso: borrarla es exactamente el daño de S6. Se avisa y se deja. Coste: una huérfana antigua sin marcador no se limpia sola nunca; es el riesgo que la auditoría ya aceptó, y el aviso en la actividad nombra la carpeta para que el usuario la retire a mano.

**Aviso en la actividad.** `Office` pasa `onForeign: (dirs) => this.pushActivity({ ts: this.now(), agentKey: 'redaccion', event: 'Sync', tool: null, state: null, summary: { key: 'hub.act.sourcesForeign', params: { n: dirs.length, dirs: dirs.join(', ') } } })`, el mismo molde que `syncSources` (`office.ts:733-740`). Clave nueva en `HubTextParams` (`types.ts:75` es la vecina `hub.act.sourcesReady`), y textos:

- es: `'hub.act.sourcesForeign': 'fotos de otro hub o sin marcador en redaccion/.fuentes, sin tocar ({n}): {dirs}'`
- en: `'hub.act.sourcesForeign': 'snapshots from another hub or unmarked in redaccion/.fuentes, left alone ({n}): {dirs}'`

`ui/src/i18n/hub.ts:5-17` hace fallar el typecheck de UI si una clave de `HubTextParams` falta en `es.ts` o sus `{marcadores}` no coinciden con los parámetros, y `ui/test/i18n.test.ts:40-59` exige que `en.ts` tenga las mismas claves y marcadores y un texto distinto. Por eso `types.ts`, `es.ts` y `en.ts` cambian en el mismo paso (y `cd ui && bun run typecheck` solo se promete en verde a partir de ese paso).

**`removeDir(dir, onlyIfEmpty)`** (`sync.ts:343-348`): hoy «vacío» es `safeList(dir).length === 0`. Con el marcador dentro, `.fuentes/<slug>/` nunca estaría vacía y `remove(slug)` (`sync.ts:169`) y `removeFloor` (`sync.ts:184`) dejarían la carpeta del slug para siempre; el test `sync.test.ts:103` (`existsSync(.fuentes/login) === false`) lo detectaría. «Vacío» pasa a ser «sin entradas que no empiecen por `.`», y entonces `rmSync` recursivo se lleva el marcador con la carpeta. Solo se llama desde rutas propias (filas de la base de datos, o `owner === id`/`null` en `cleanup`), así que no borra marcadores ajenos.

**Test del id** en `hub/test/units.test.ts`, calcado del de la key (`:106-117`): `createIdIfMissing(p)` devuelve `created: true` y un id `/^[0-9a-f]{16}$/`; la segunda llamada devuelve el mismo id con `created: false`; `statSync(p.id).mode & 0o777 === 0o600`.

**Sin cambio de esquema.** El marcador va en disco, no en SQLite: la base de datos es precisamente lo que puede estar vacía o ser de otro hub.

### M24. Orden de trabajo

Los tests van en la misma rama que la corrección y se escriben antes:

1. Commit A: tests nuevos (guard, sync, departments, units) y adaptaciones mínimas que solo añaden casos. En este commit `bun run test` está en rojo a propósito. Nota: el caso `fantasma` adaptado de `sync.test.ts` pasa tanto en A como en B (es una adaptación para que siga valiendo con el marcador, no un test de M24: en A el `cleanup` actual borra `fantasma/.office`, `fantasma/mobile` y la carpeta del slug vacía, así que sus aserciones ya se cumplen).
2. Commit B: la corrección completa (incluidos `helpers.ts`, `hubId` en los tests y la clave i18n).
3. Prueba de M24 antes de cerrar B, con B aún sin commit: `git stash` → `cd hub && bun test test/guard.test.ts test/sync.test.ts test/departments.test.ts` falla → `git stash pop` → pasa → commit.

El encargo acaba con `bun run test` y `bun run typecheck` en verde, así que su `HECHO:` pasa la puerta del tester.

## Pasos

Todo en el clon `/Users/victorsanblasgomez/Projects/agent-office-dev`, en una rama propia a partir de `build/v1`. Antes de empezar, comprobar que `git rev-parse --show-toplevel` no es `~/Projects/agent-office` (regla 1 del `CLAUDE.md` de la planta).

1. **Tests M6 en `hub/test/guard.test.ts`.** Añadir al `describe('write guard')` un test `the writer of an order only writes its two files, the lead keeps the department`:
   - `guardDecision({ tool: 'Write', input: { file_path: 'planes/b.md' }, cwd: '/docs/redaccion', role: 'office-redactor', name: 'redactor-a' }, ctx)`: `pass === false`, `reason` contiene `redactor-a` y `/docs/redaccion/planes/a.md`, `target === '/docs/redaccion/planes/b.md'`.
   - Misma llamada con `planes/a.md` y con `/docs/redaccion/historial/a.md`: `pass === true`.
   - `name: 'redactor-a'` escribiendo `/docs/redaccion/planes/a.md.bak`: bloqueado.
   - `role: 'office-lead-redaccion', name: 'lead-redaccion'` escribiendo `planes/b.md`: pasa.
   - `role: 'office-redactor', name: null` escribiendo `planes/b.md`: pasa (zona del departamento).
   - `role: 'office-redactor', name: 'redactor-Mal Slug'`: pasa (nombre no válido → departamento).
   Y un test del artesano, con cwd `/docs/taller` en todas las llamadas (`departments.test.ts:674` fija ese cwd para Mantenimiento): con `name: 'artesano-pdf'`, `Write` en `/docs/taller/skills/pdf/SKILL.md` pasa, en `/docs/taller/skills/otra/SKILL.md` se bloquea con `reason` que contiene `artesano-pdf`; y por Bash, con el mismo nombre, `python3 ~/.claude/skills/synced/abc/skill-creator/scripts/init_skill.py pdf --path /docs/taller/skills` pasa (zona del departamento en Bash: `pdf` se resuelve a `/docs/taller/pdf` y `--path` a `/docs/taller/skills`, ambos dentro de `/docs/taller`), igual que `echo x > /docs/taller/skills/otra/notas.md`. Verificable: `cd hub && bun test test/guard.test.ts` falla en los casos de bloqueo nuevos y solo en esos.
2. **Test M6 a través del hub en `hub/test/departments.test.ts`.** En el test `department writes outside their folder are blocked…` (`:654`), tras la línea 667, añadir: `write(LEAD, cwd, 'ared-1', 'redactor-login', join(docs, 'redaccion', 'planes', 'otro.md'))` bloqueado con `reason` que contenga `redactor-login`; `write(LEAD, cwd, 'ared-1', 'redactor-login', join(docs, 'redaccion', 'historial', 'login.md'))` pasa; y el fallback: `write(LEAD, cwd, 'ared-9', 'redactor-otro', join(docs, 'redaccion', 'planes', 'otro.md'))` **sin** `start()` previo para `ared-9` pasa (rol `office-redactor` por `roleFromName`, nombre desconocido para el hub → zona del departamento; ver Diseño). Verificable: ese test falla en el commit A.
3. **Tests M8 en `hub/test/sync.test.ts`.** `setup()` (`:13-26`) pasa a `new SyncDesk({ …, id: 'hub-a', onForeign: (dirs) => foreign.push(...dirs) })` y devuelve `foreign`. Tests nuevos:
   - `a snapshot owned by another hub survives cleanup with an empty database`: sin ningún `sync`, `git worktree add -q --detach <fuentes/ajeno/mobile> origin/develop`, `writeFileSync(fuentes/ajeno/.office, 'hub-b\n')`; `await desk.cleanup(new Set())` devuelve `[]`; `existsSync(fuentes/ajeno/mobile)` y `existsSync(fuentes/ajeno/.office)` son `true`; `worktrees(mobile.repo)` contiene la ruta; `foreign` es `['ajeno/mobile']`. Es el criterio de aceptación.
   - `with an empty database and a foreign snapshot, own orphans are kept too`: además de `ajeno` (marcado `hub-b`), un worktree a mano en `fuentes/propio/mobile` con `fuentes/propio/.office` = `hub-a\n`, nada en la base de datos; `cleanup` devuelve `[]`, las dos carpetas siguen y `foreign` es `['ajeno/mobile']`.
   - `syncFloor marks the plan folder and cleanup adopts unmarked folders of its own database`: `sync({ slug: 'login', floors: ['mobile'] })` deja `fuentes/login/.office` con `hub-a\n`; borrar el marcador a mano, `cleanup(new Set())` lo vuelve a escribir, no retira nada y `foreign` sigue vacío.
   - `an unmarked folder outside the database is reported, not removed`: tras `sync({ slug: 'login', floors: ['mobile'] })` (base de datos no vacía), worktree a mano en `fuentes/viejo/mobile` sin marcador; `cleanup` devuelve `[]`, la carpeta sigue, `foreign` es `['viejo/mobile']`.
   - Adaptar el caso `fantasma` del test `closing a plan retires…` (`:108-112`): escribir `fuentes/fantasma/.office` con `hub-a` antes del `cleanup` (la base de datos no está vacía en ese punto: `abierto` sigue), para que siga siendo «huérfana propia» y se retire como hoy; añadir `expect(existsSync(join(docs,'redaccion','.fuentes','fantasma'))).toBe(false)`. Este caso pasa en A y en B: es una adaptación, no un test de M24.
   Verificable: en el commit A fallan los cuatro tests nuevos (el primero porque `cleanup` devuelve `['ajeno/.office', 'ajeno/mobile']` y borra la carpeta) y el caso `fantasma` adaptado pasa.
4. **Test del id en `hub/test/units.test.ts`**, junto al de la key (`:106-117`), como dice el Diseño. Verificable: falla en A porque `createIdIfMissing` no existe (el fichero no compila para `bun test`).
5. **Commit A** con los pasos 1-4: `test: zona por encargo y marcador de fotos (M6+M8, fallan a propósito)`.
6. **`hub/src/config.ts`.** `Paths.id`, `readId`, `createIdIfMissing` (Diseño, «Id del hub»). Verificable: `cd hub && bun run typecheck` en verde; `fakePaths()` de `hub/test/helpers.ts:22-27` sigue valiendo; `bun test test/units.test.ts` en verde.
7. **`hub/src/setup.ts` y `hub/src/main.ts`.** `setup` llama a `createIdIfMissing(p)` tras `createKeyIfMissing` e imprime la ruta; `main` llama a `createIdIfMissing(p)` tras `readKey` y pasa `hubId` a `new Office({...})`. Verificable: typecheck; no se ejecuta ninguno de los dos (regla 3 del `CLAUDE.md`).
8. **`hub/src/guard.ts`.** `Zones` gana `order: string | null`; `GuardInput` gana `name?: string | null`; `orderOf`; `zonesFor(role, ctx, name = null)`; `guardDecision` usa `zonesFor(g.role, ctx, g.name ?? null)` en la rama de edición y `zonesFor(g.role, ctx)` en la rama Bash; mensaje de encargo en la rama de edición. Verificable: `bun test test/guard.test.ts` en verde, incluidos los tests de hoy (`:23-50`, `:54-88`) sin cambios.
9. **`hub/src/office.ts`** (los tres puntos de la tabla): `OfficeOptions.hubId`; `SyncDesk` con `id` y `onForeign`; `guard()` con `name`. Verificable: `grep -n "guardDecision(\|hubId\|onForeign" hub/src/office.ts` muestra exactamente esas líneas y `office.ts:317` no aparece en el diff.
10. **`hub/src/types.ts`, `ui/src/i18n/es.ts`, `ui/src/i18n/en.ts`** en el mismo paso: clave `hub.act.sourcesForeign` con `{ n: number; dirs: string }` y los dos textos del Diseño. Verificable: `cd ui && bun run typecheck` y `cd ui && bun test` en verde (`hub.ts:5-17` y `i18n.test.ts:40-59`).
11. **`hub/src/sync.ts`.** `MARKER = '.office'`, `readMarker`, `writeMarker`, `SyncOptions.id`/`onForeign`, marcador en `syncFloor` (rama nueva y rama reutilizada), `cleanup` nuevo con la pasada de adopción y la regla de base de datos vacía, `removeDir` con el «vacío» que ignora entradas `.`. Verificable: `bun test test/sync.test.ts` en verde, incluidos `:97-117`, `:119-137` y `:149-156`.
12. **Tests que construyen `Office` a mano.** `hubId: 'hub-test'` en `hub/test/helpers.ts:76-87` y en `hub/test/office.test.ts:522`, `hub/test/departments.test.ts:471` y `:537`. Verificable: `cd hub && bun run typecheck` en verde; el test de reinicio `departments.test.ts:531-547` (mismo `db`, mismo `hubId`) sigue retirando las fotos del plan descartado.
13. **Documentación.** `README.md:147`: añadir «Con Edit y Write, cada redactor solo escribe `redaccion/planes/<slug>.md` y `redaccion/historial/<slug>.md` de su encargo, y cada artesano `taller/skills/<nombre>/`; los jefes conservan toda la carpeta y en Bash rige la carpeta del departamento.» `README.md:88`: añadir «El hub deja en `redaccion/.fuentes/<slug>/.office` su id (`~/.config/agent-office/id`) y al arrancar solo retira fotos con su id; las de otro hub o sin marcador las deja y lo avisa en la actividad.» `README.md:158`: «La guardia bloquea al redactor fuera de los dos ficheros de su encargo.» `redactor.md.tpl:43`: «La oficina bloquea las escrituras fuera de esos dos ficheros.» `artesano.md.tpl:23`: «La oficina bloquea con Edit y Write las escrituras fuera de esa carpeta…». Verificable: `grep -n "\.office" README.md` y `grep -n "dos ficheros" README.md plugin/templates/redactor.md.tpl`.
14. **Prueba M24** (Diseño, «Orden de trabajo»): con el commit B sin hacer, `git stash` → los cuatro ficheros de test fallan → `git stash pop` → pasan. Verificable: la salida de ambos `bun test` queda en el informe del tester.
15. **Commit B**: `fix: zona de escritura por encargo y marcador de propiedad de las fotos (M6+M8)`. Verificable: `bun run test` y `bun run typecheck` desde la raíz en verde.

## Riesgos

- **El nombre del agente llega tarde o no llega.** `guard()` lee `this.agents.get(key)?.name`; si el `SubagentStart` del redactor aún no se ha procesado o el agente se creó sin `name` (`resolveSpawnType` solo lo fija cuando `agent_type` no es un rol de oficina, `office.ts:1381`), la zona cae a la del departamento. Mitigación: es el comportamiento actual, nunca más restrictivo; el test del paso 2 (`ared-9` con `agent_type: 'redactor-otro'` y sin `start`) lo fija.
- **El encargo no rige en Bash.** Un artesano con Bash puede seguir escribiendo desde Bash en todo `taller/` (zona del departamento), incluida `taller/skills/<otra>/`, como hoy; fuera de `taller/` sigue bloqueado. Es deliberado: la detección en Bash es parcial y una zona estricta rompería `skill-creator` (Diseño, «Solo para las herramientas de edición»). El redactor no tiene Bash, así que S5 queda cerrado para Redacción; para Mantenimiento la mejora se limita a Edit/Write. Queda anotado para M7.
- **Huérfanas sin marcador no se limpian solas.** Una carpeta de un hub anterior a este cambio que no esté en la base de datos se queda y aparece en la actividad en cada arranque. Mitigación: el aviso nombra `slug/planta`; el usuario la retira a mano (`git -C <planta> worktree remove --force <ruta>` y borrar la carpeta). Si resulta ruidoso, un seguimiento puede guardar los avisos ya dados.
- **Base de datos restaurada o parcial con el mismo id: no cubierto.** El Contexto cita «restauración de `office.db`» entre los escenarios de S6. Con el mismo `id`, una base de datos restaurada de una copia antigua (no vacía) hace que las fotos propias que no figuren en ella se retiren como huérfanas (paso 5 del `cleanup`). Solo el caso «base de datos vacía» queda protegido por la regla del paso 4. El marcador distingue hubs, no versiones de la base de datos de un mismo hub; cubrirlo exigiría guardar la lista de fotos fuera de SQLite y queda fuera de este encargo.
- **Dos hubs sobre el mismo `docsRepo` y el mismo slug.** El marcador es por slug, no por planta: el segundo hub no sobreescribe el marcador y su foto queda registrada en su propia base de datos (nunca la retira: está en `known`), pero el primero la verá como propia huérfana si el slug está marcado con su id y la planta no está en su base de datos, y la retirará. Es el escenario que S6 llama «un segundo hub por error», y hoy ya acaba igual o peor; se documenta y no se diseña para él.
- **`hubId` obligatorio rompe a quien construya `Office` sin él.** Solo `main.ts` y cuatro sitios de tests lo hacen (tabla de ficheros); el typecheck los señala todos.
- **La clave i18n nueva y `ui/tsconfig.json`.** `ui` incluye `../hub/src/types.ts`; si `types.ts` cambia sin `es.ts`/`en.ts`, el typecheck de UI falla. Mitigación: paso 9 los cambia juntos.
- **Tester y la puerta de tests.** El tester ejecuta `bun run test` y `bun test …`, que `classify` reconoce como tests (`\btest\b`); el `git stash`/`git stash pop` del paso 13 no contiene «test» y no se cuenta como verde falso.

## Verificación

Todo en el clon `~/Projects/agent-office-dev`, nunca en `~/Projects/agent-office`.

1. Antes de tocar nada: `git rev-parse --show-toplevel` debe imprimir `/Users/victorsanblasgomez/Projects/agent-office-dev`.
2. Tras el commit A: `cd hub && bun test test/guard.test.ts test/sync.test.ts test/departments.test.ts test/units.test.ts` falla únicamente en los tests nuevos de los pasos 1-4 (`units.test.ts` entero, porque importa `createIdIfMissing`, que aún no existe). El caso `fantasma` adaptado pasa ya en A.
3. Tras los pasos 6-12, con el commit B sin hacer: `git stash` → el mismo comando falla igual que en el punto 2 → `git stash pop` → pasa. Es la prueba de M24.
4. Suite completa: `bun run test` (ejecuta `cd hub && bun test && cd ../ui && bun test`, `package.json:15`) y `bun run typecheck` (`package.json:16`) desde la raíz del clon, en verde.
5. Comprobaciones puntuales:
   - `grep -n "guardDecision(\|hubId\|onForeign" hub/src/office.ts`: solo las líneas de la tabla (`guard()`, `OfficeOptions`, constructor de `SyncDesk`); `git diff build/v1 -- hub/src/office.ts` no toca la línea de la exención (`zonesFor(agent.role, this.guardContext())`).
   - `grep -rn "sourcesForeign" hub/src/types.ts ui/src/i18n/es.ts ui/src/i18n/en.ts`: una línea por fichero.
   - `grep -n "\.office" README.md`: una línea; `grep -n "dos ficheros" README.md`: una línea.
6. Prueba en vivo opcional, con hub temporal (regla «Permitido» del `CLAUDE.md` de la planta): `AGENT_OFFICE_HOME=$(mktemp -d) AGENT_OFFICE_CLAUDE_HOME=$(mktemp -d)`, un `config.json` en ese `AGENT_OFFICE_HOME` con otro `port` **y `docsRepo` apuntando a un repositorio temporal creado con `ensureDocsRepo`** (sin `docsRepo` temporal, el valor por defecto es `~/Projects/office-docs`, regla 4 del `CLAUDE.md`), una key creada a mano en `$AGENT_OFFICE_HOME/key`, y una planta temporal registrada en ese config. Arrancar `bun hub/src/main.ts` desde el clon solo con esas variables; comprobar que aparece `$AGENT_OFFICE_HOME/id`; crear a mano en `<docsRepo temporal>/redaccion/.fuentes/ajeno/` un `.office` con `otro-hub` y un worktree de la planta temporal; reiniciar el hub y comprobar en `GET /api/...` o en el panel que la actividad trae `fotos de otro hub o sin marcador … ajeno/<planta>` y que la carpeta sigue. Se repite con `.office` igual al contenido de `$AGENT_OFFICE_HOME/id` y sin fila en la base de datos: la carpeta desaparece. Esta prueba es manual y no sustituye a los tests.

## Preguntas abiertas

- ¿Debe el aviso de fotos ajenas salir también por `console.warn` en el arranque, además de en la actividad? El plan lo deja solo en la actividad (persistente en `snapshot()` hasta 300 entradas, `office.ts:186`), que es lo que ve el usuario en el panel; añadir `console.warn` en `main.ts` es trivial si se prefiere.
- ¿Conviene que `hub.act.sourcesForeign` dispare aviso de escritorio como las alertas de la guardia? Fuera de alcance aquí; sería un cambio en la UI (`ui/src/**`) que este plan no toca.
