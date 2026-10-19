# Textos del hub en el idioma del panel

## Contexto

El hub redacta en español todo lo que el panel muestra como dato: resúmenes de actividad (`hub/src/state-machine.ts:114-329`, `hub/src/office.ts:473-1277`), el `detail` de cada agente, la pregunta de permiso (`office.ts:421`), el resumen de los informes (`hub/src/reports.ts:25-38`), las notas y errores de Ajustes (`hub/src/settings.ts:21-138`), los errores de la API (`hub/src/server.ts:27-163`) y el aviso de documento demasiado grande (`hub/src/documents.ts:172`). `panel-i18n-ayuda` los dejó fuera a propósito (su Alcance `:28` y Preguntas abiertas `:211`): con el panel en inglés quedan en español.

- agent-office-dev `build/v1` @ `1e17234` (2026-10-16)

Este plan se ejecuta **después** de `panel-i18n-ayuda`, `ajustes-gestion-proyectos-2` y `avisos-escritorio`, en ese orden (`panel-i18n-ayuda.md:147`). Las citas `ruta:línea` sin más son de la foto `1e17234`; lo que existirá por los otros planes se cita como `<plan>:línea` y se atribuye solo lo que ese plan dice. Las líneas de `ui/src` estarán desplazadas por los tres planes.

## Objetivo

Que todo texto de usuario que genera el hub y pinta el panel (Tabla, Detalle, actividad, pregunta de permiso, informes, notas de Ajustes, errores de API y avisos del visor) salga en el idioma elegido en el selector del panel, cambie al instante al cambiar de idioma y no exija reiniciar el hub.

## Alcance

Entra:

- Inventario de textos del hub que llegan al panel (D1), por canal (websocket/snapshot, REST, base de datos).
- Mecanismo: el hub emite claves con parámetros tipados y el panel las pinta con `t()` (D2, D3).
- Cambios del hub (D4), textos ya guardados en `reports` (D5), cambios de UI (D6), tests (D7), README (D8).
- Los textos que añade `ajustes-gestion-proyectos-2` en `floor-admin.ts` y `floor-cli.ts` (ese plan los deja en castellano, `ajustes-gestion-proyectos-2.md:79`).

Queda fuera:

- Mensajes entre agentes (`MessageView.text`, `BLOQUEADO:`/`HECHO:`), títulos de documentos (`hub/src/documents.ts:47-60`), plantillas, documentos de office-docs.
- Texto que el hub manda a los agentes o a la terminal: `memoryContext` (`hub/src/memory.ts:113-137`; `ROLE_LABELS` y `floorLabel` de `office.ts:165-191` se quedan para él), razones de `gate.ts` y `guard.ts` y el `message` de la denegación (`hub/src/questions.ts:131`), que van al hook; `sync.ts:74-107` (lo lee `office-sync.sh`); `hub/src/main.ts`, `setup.ts`, `floor-cli.ts` CLI (`:173-226`), `office-sh.ts`, `agents.ts`, `profiles.ts` (consola, lanzadores y plantillas); `MISSING_UI` (`server.ts:29-31`: página sin UI compilada, no es el panel); `courier.ts:29` (el panel recibe `hub.api.orderFailed`, no ese texto).
- `avisos-escritorio`: `notify.ts` usa `question.detail` (comando crudo) y `MessageView.text` (`avisos-escritorio.md:66-69`); no cambia.
- La grabación `ui/public/replays/demo.json`: sus textos quedan como se grabaron (D2, cadena cruda).

## Diseño

### D1. Inventario

| # | Texto | Dónde nace (foto) | Persiste | Quién lo pinta (foto) |
|---|---|---|---|---|
| 1 | `ActivityView.summary` | `state-machine.ts:114-171` (`classify`), `:185-254` (`preTool`), `:263-297` (`postTool`), `:307-317` (`failedTool`), `:325-329` (`notification`); `office.ts:473` (tarea cerrada/bloqueada), `:504` (aviso de fin), `:528` (guardia, con `un agente` y la razón), `:549` (orden), `:609` (plan descartado), `:623` (fuentes), `:725` (alerta), `:814` (memoria), `:853-854` (entrega), `:886` (pide revisión), `:904-912` (veredicto), `:944` (commit fallido), `:962-967` (lección), `:1277` (permiso/pregunta); observadas `privacy.ts:23-27` | No: anillo en memoria (`office.ts:208`, `:1339-1343`) | `ui/src/panel/timeline.ts:35` |
| 2 | `AgentView.detail` | `state-machine.ts:114`, `:116`, `:127`, `:133`, `:139`, `:143`, `:150`, `:161`, `:185-254`, `:263`, `:294`, `:307-314`, `:325-327`; `office.ts:341` (`esperando`), `:344` (`bloqueado`), `:1299` (`sin respuesta:`), `:1385`; observadas `privacy.ts:15-21` (`tests`, `revisión`) | No (`AgentRuntime`, `office.ts:87`) | `ui/src/table/table.ts:82-83`, `ui/src/panel/header.ts:31` |
| 3 | Pregunta de permiso: `¿Permites a {who} {verbo}?`, `una herramienta`, `un agente de la oficina`, `header: 'Permiso'`, ` en ` | `office.ts:405`, `:408`, `:421-422`, `:1430-1446` | `questions.payload` (`office.ts:1268`), solo se cuenta (`reports.ts:67`), no se relee | `ui/src/panel/question-form.ts:58` (`:59` es el `detail` crudo; el `header` no se pinta, `:53-63`) |
| 4 | `FloorView.label` (`Dirección`…) | `floors.ts:142`, `:147` | No | Resuelto por `kind` en `panel-i18n-ayuda.md:106` (`floorLabel`). Sin cambio |
| 5 | `ReportView.summary` (`N fichero(s) cambiado(s) · N ejecución(es) de tests`, `Último mensaje a …`, `Todavía sin ficheros…`) | `reports.ts:25-38` | **Sí**: `reports.summary` y `reports.data` (`reports.ts:90-98`), releído en `:116-128`; también lo leen los agentes vía `memoryContext` (`office.ts:795-806`) | `ui/src/panel/report.ts:58`, `ui/src/panel/memory.ts:30` |
| 6 | `SettingsResult.note` y `error` | `settings.ts:21-22`, `:58-111`, `:129`, `:137-138` (`f.error` viene de `regenerateAgents`, `floor-cli.ts:136-141`) | No | `ui/src/settings/settings.ts:441` (rama real: `OfficeApi.send` devuelve todo 4xx como `message`, `ui/src/api.ts:108`, y `POST /api/settings` responde 400 si `!result.ok`, `server.ts:123`); `:443` no se alcanza hoy; `:445` la nota |
| 7 | Errores de la API (`{ error }`) | `server.ts:27`, `:100`, `:107-108`, `:111-112`, `:116`, `:121`, `:129`, `:141-142`, `:147`, `:154`, `:159`, `:162-163`; `office.ts:563-576` (lecciones) | No | `ui/src/api.ts:21-43` → `actions.ts:19`, `panel/orders.ts:121`, `panel/question-form.ts:190`, `panel/memory.ts:134`, `:156`, `:172`, `panel/report.ts:219`, `panel/deliverables.ts:98`, `:197`, `settings/settings.ts:169` |
| 8 | Plan 2: errores 400/404/409 y `note` de `floor-admin.ts` (`ajustes-gestion-proyectos-2.md:54-55`), actividad `planta borrada desde el panel` (`:52`), y los `FloorError` de `floor-cli.ts:59`, `:61`, `:71`, `:73`, `:87`, `:94`, `:97` que `POST /api/floors` reutiliza (`:47`), más `:155` (`purgeFloor` lo hereda, `:46`) | No | `ui/src/settings/projects.ts` vía `readError` (`ajustes-gestion-proyectos-2.md:65`, `:67`) |
| 9 | `DocumentContent.markdown` = `El documento es demasiado grande para mostrarlo en el panel.` (sin tilde) | `documents.ts:172` (límite `MAX_CONTENT_BYTES`, `:9`) | No | `ui/src/panel/deliverables.ts:197` lo pasa por `renderMarkdown` como si fuera el documento |

Lo que llega por websocket (1-3) va en un solo `payload` a todos los clientes (`server.ts:229-232`) y el snapshot repite el anillo de actividad (`office.ts:307`).

### D2. El hub emite claves con parámetros tipados; el panel traduce

Nuevos tipos en `hub/src/types.ts` (el único fichero que comparten hub y UI, `ui/src/types.ts:1`, `ui/tsconfig.json:14`):

```ts
export type HubTextParams = {                      // una entrada por clave: sus parámetros o undefined
  'hub.detail.waiting': undefined;
  'hub.act.edit': { name: string };
  'hub.act.lessonSaved': { role: HubText; floor: HubText };
  …
};
export type HubTextKey = keyof HubTextParams;
type HubTextOf<K extends HubTextKey> = HubTextParams[K] extends undefined ? { key: K; params?: undefined } : { key: K; params: HubTextParams[K] };
export type HubText = string | { [K in HubTextKey]: HubTextOf<K> }[HubTextKey];
```

Una **cadena** es texto crudo que se muestra tal cual (comandos, rutas, nombres, texto de agentes, grabaciones antiguas); un **objeto** es una clave del diccionario del panel con sus parámetros, que pueden ser a su vez `HubText` (`{role}`, `{floor}`, `{level}`, `{error}`). Los parámetros van tipados por clave: un `{ key: 'hub.act.edit', params: { file } }` no compila en el hub, así que un `edita {name}` sin rellenar nunca llega a pantalla. Cambian de tipo:

- `ActivityView.summary: HubText`, `AgentView.detail: HubText`, `Classified.detail`/`summary` (`state-machine.ts:28`, `:44`).
- `QuestionView.prompt?: HubText` (nuevo; `questions[0].question` sigue siendo la clave de respuesta que valida `questions.ts:113-123`).
- `ReportView.summaryText: HubText | null` (nuevo; `summary` sigue siendo `string` para los agentes y para la columna `reports.summary`).
- `SettingsResult` → `{ ok: true; regenerated: number; note: HubText[] } | { ok: false; error: HubText[] }`.
- `DocumentContent.notice?: HubText` (nuevo; con aviso, `markdown` va vacío).
- Cuerpos de error de la API → `{ error: HubText }`; `POST /api/settings` sin servicio (`server.ts:121`) → `{ ok: false, error: [{ key: 'hub.api.settingsUnavailable' }] }` para respetar `SettingsResult`.
- `RegenerateResult` (`floor-cli.ts:37`) gana `text?: HubText` (`error` sigue siendo `string`: `floor-cli.test.ts:166` lo afirma).
- Plan 2: `FloorAddResult`/`FloorRemoveResult` (`ajustes-gestion-proyectos-2.md:61`) pasan de `error: string` a `error: HubText`, y `FloorAddResult` lleva `note: HubText`.
- `hub/src/guard.ts`: `type GuardDecision = GateDecision & { target?: string }`, devuelto por `guardDecision` y rellenado en cada `block` (`:216-218`); `gate.ts` no cambia.

Por qué esta opción y no que el hub traduzca:

- El websocket y el snapshot son un payload para todos los clientes; el idioma es por navegador (`localStorage['agent-office.lang']`, `panel-i18n-ayuda.md:44`). Traducir en el hub exigiría idioma por socket, dos copias del anillo de actividad o guardar claves igualmente.
- Cambiar de idioma repinta la actividad ya recibida (incluidos los 300 asientos del snapshot) sin tocar el hub: criterio «sin reiniciar» cumplido por construcción.
- Un solo diccionario (`ui/src/i18n/es.ts`/`en.ts`), tipado y cubierto por `ui/test/i18n.test.ts` (`panel-i18n-ayuda.md:34-37`, `:128-133`); el hub no gana estado ni ajuste nuevo.
- Coste: formato de cable nuevo (los tests del hub que afirman sobre texto cambian, D7) y la grabación `demo.json` sigue en español (cadenas crudas).

### D3. Claves `hub.*` y comprobación en compilación

Todas las claves nuevas llevan prefijo `hub.` y van a `es.ts`/`en.ts` (regla `panel-i18n-ayuda.md:57`). `HubTextParams` es la lista exacta; esto es el resumen por grupo:

- `hub.detail.*`: `waiting`, `thinking`, `permission {tool}`, `starting`, `finished`, `end`, `testsGreen`, `testsRed`, `testsInterrupted`, `questionCancelled`, `awaitingAnswer`, `delegates {what}`, `createsTask {subject}`, `updatesTask {id}`, `noAnswer {detail}`, `blocked`, `checking`, `tests`, `question`. `→ {to}` (`state-machine.ts:221`) queda como cadena cruda (símbolo más nombre).
- `hub.act.*`: uno por `summary` de `state-machine.ts` (`sessionStart {source}`, `newTurn`, `permission {tool}`, `subagentStart {who}`, `done`, `turnEnd`, `sessionEnd {reason}`, `teammateIdle {who}`, `taskCreated {subject}` (`:171`), `tests|check|run {command}`, `edit {name}`, `read {what}`, `question {text}`, `message|blockedMessage {to,text}`, `delegate {who}`, `taskCreate {subject}`, `taskUpdate {id}`, `ok {what}`, `testsGreen {command}`, `edited {name}`, `subagentRunning`, `taskCreatedId {id}` y `taskCreatedPlain` (`:289`), `questionAnswered`, `testsInterrupted|testsRed {command}`, `toolFailed {tool,error}`, `awaits {message}`, `awaitingUser`, `notice {message}`) y uno por `pushActivity` de `office.ts` (`taskClosed|taskBlocked {subject}`, `doneAccepted {text}`, `doneBlocked`, `guardBlocked {who,target}`, `order {text}`, `planDiscarded {path}`, `sourcesReady {slug,floors}`, `guardAlert.one|other {level,n,floor,who}`, `memoryDelivered {lessons,reports}`, `deliveryAccepted {path}`, `deliveryBlockedStale {path}`, `deliveryBlockedNoPath`, `reviewRequested {path,round}`, `verdictApproved|verdictImprove|verdictNoAgreement {path,round,score}`, `commitFailed {path,root}`, `lessonSaved {role,floor}`, `lessonDuplicate`, `lessonCap {max}`, `lessonEmpty`, `permissionWaiting {detail}`, `questionWaiting`, `floorRemoved {slug}` (plan 2)). Los sufijos opcionales van como parámetro anidado o cadena vacía: `round: round ? { key: 'hub.round', params: { n } } : ''` con `hub.round` = ` (ronda {n})`, `hub.score` = ` · nota {n}/10`.
- `hub.who.subagent`, `hub.who.teammate`; `hub.role.<RoleId>` (nueve, en minúsculas como `office.ts:165-175`); `hub.floor.direccion|redaccion|mantenimiento|other {slug}`; `hub.alertLevel.alerta|posible`.
- `hub.permission.bash|edit|read|web` `{who}` y `other {who,tool}` (`¿Permites a {who} ejecutar este comando?`…); `{who}` es nombre, título de sesión o `key.slice(0, 8)`, como `agentName` en `ui/src/labels.ts:111`: desaparece `un agente de la oficina`.
- `hub.report.counts {files,tests}` (`{files} · {tests}`), `hub.report.files.one|other {n}`, `hub.report.tests.one|other {n}`, `hub.report.lastMessage {to,text}`, `hub.report.empty`.
- `hub.settings.saved`, `noChanges`, `regenerateFailed {slug,error}` (`error` anidado: `HubText` de `FloorError` o cadena de `TemplateError`), `unknownRole {id}`, `badModel {id}`, `badEffort {id}`, `badDepartment {key}`, `badRange {key,min,max}`, `noFloor {slug}`, `badBranch {branch,slug}`, `noTarget {slug}`, `badPermissionMode {slug}` (el mensaje de `settings.ts:111` no incluye el valor).
- `hub.api.*`: `questionClosed`, `answerMissing`, `orderFields`, `orderTooLong`, `sessionNotFound`, `orderFailed`, `settingsUnavailable`, `badMemoryTarget`, `badId`, `lessonNotFound`, `noReport`, `documentNotFound`, `pathRequired`, `planClosed`, `planNotFound`, y de `office.ts:563-576` `floorRequired`, `roleInvalid`, `lessonEmpty`, `lessonDuplicate`, `lessonSaveFailed`.
- `hub.doc.tooLarge` (fila 9).
- `hub.floors.*` (plan 2): `pathRequired`, `badSlug`, `notFound {slug}` (también `floor-cli.ts:155`), `conflictManaged {path,slug}`, `inUse {sessions}`, `added {slug,startCommand}` (la `note` del alta, `ajustes-gestion-proyectos-2.md:54`, que ese plan no detalla: propuesta de este plan), y los `FloorError` de `floor-cli.ts`: `slugInvalid {slug}`, `slugReserved {slug}`, `missing {path}` (`:71` y `:136`), `notDir {path}`, `liveCopy {path}`, `slugTaken {slug,path}`, `pathTaken {path,other}`.

Plurales: el hub elige `.one`/`.other` (español e inglés comparten la regla, `panel-i18n-ayuda.md:59`) con `plural(base, n, params)` en un `hub/src/texts.ts` nuevo: `type PluralBase = HubTextKey extends `${infer B}.one` ? B : never` (distribuye sobre la unión) tipa `base`, y `params` son los de `${base}.one` sin `n` (con un cast interno al componer la clave). El mismo fichero da `roleText(roleId)` y `floorText(slug)` (los `HubText` anidados que sustituyen a `ROLE_LABELS`/`floorLabel` en la actividad).

Literales ingleses que fijan lo que ve la receta: `hub.role.*` sigue los nombres de `role.*` de `panel-i18n-ayuda.md:94` en minúsculas (`redactor` → `writer`, `artesano` → `skill crafter`…), y `hub.floor.direccion|redaccion|mantenimiento` usan en inglés el mismo literal que `floor.*` de ese plan, para que Tabla y actividad coincidan. Claves iguales en ambos idiomas (`hub.detail.tests`, `hub.act.ok`, `hub.act.tests`, `hub.report.counts`, `hub.role.director`, `hub.role.tester`) se añaden a `SAME_KEYS` (`panel-i18n-ayuda.md:61`); el test 2 de ese plan dirá si falta alguna de `hub.who.*` o `hub.floors.*`.

Comprobación en compilación y renderizado, en `ui/src/i18n/hub.ts` (nuevo, dentro de `i18n/` para que el rastreo lo ignore):

```ts
import type { HubText, HubTextKey, HubTextParams } from '../types';
type HubKeysCovered = HubTextKey extends MessageKey ? true : never;
const hubKeysCovered: HubKeysCovered = true;          // typecheck falla si el hub emite una clave que es.ts no tiene
type Markers<S extends string> = S extends `${string}{${infer M}}${infer R}` ? M | Markers<R> : never;   // {marcadores} del literal de es.ts (as const, panel-i18n-ayuda.md:36)
type ParamNames<K extends HubTextKey> = HubTextParams[K] extends undefined ? never : keyof HubTextParams[K] & string;
type BadMarkers = { [K in HubTextKey]: [Markers<(typeof es)[K]>] extends [ParamNames<K>] ? ([ParamNames<K>] extends [Markers<(typeof es)[K]>] ? never : K) : K }[HubTextKey];
const markersMatch: [BadMarkers] extends [never] ? true : BadMarkers = true;   // si una clave hub.* de es.ts no tiene exactamente los params de HubTextParams, el error nombra la clave; en.ts lo cubre el test 1 de panel-i18n-ayuda.md:130
type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;
export function renderHubText(tr: Translate, value: HubText | null | undefined): string;   // puro: cadena tal cual, null → '', objeto → traduce primero los params anidados
export function errorText(tr: Translate, parsed: unknown): string | null;                  // puro: acepta string | HubText | HubText[] (Array.isArray → une con ' '); otra cosa → null
export function hubText(value: HubText | null | undefined): string;                        // renderHubText(t, value)
export function hubTexts(values: readonly HubText[]): string;                              // join(' ')
```

### D4. Cambios del hub

- `hub/src/state-machine.ts`: cada `detail`/`summary` de `classify`, `preTool`, `postTool`, `failedTool` y `notification` pasa a `HubText`; lo crudo (`short(command)`, `basename`, `short(first)`, `→ ${to}`, `short(last_assistant_message)`, `text(e.reason)`, `tool`) sigue siendo cadena. `BLOCK_PREFIX`/`DONE_PREFIX` no cambian.
- `hub/src/privacy.ts:15-27`: `publicDetail` devuelve `{ key: 'hub.detail.tests' }`/`{ key: 'hub.detail.checking' }` o la cadena cruda; `publicSummary` pasa a `HubText` (devuelve `c.summary` en plantas no observadas, `:24`, y la cadena `tool + fichero` en las observadas).
- `hub/src/office.ts`: `AgentRuntime.detail: HubText` y `blockedReason: HubText | null` (`:87-89`); `:341`, `:344`, `:1385` a claves; `:1299` `{ key: 'hub.detail.noAnswer', params: { detail: agent.detail } }`; los catorce `pushActivity` de D1 a claves, con `roleText`/`floorText` en `:962` y `who = name ?? role ?? key.slice(0, 8)` en `:528` (adiós `un agente`); `:528` usa `decision.target` en vez de la razón; `permission()` (`:405-429`) añade `prompt` al `QuestionView` con `permissionPrompt(tool, who)` (exportada, sustituye a `permissionVerb`), cambia `?? 'una herramienta'` (`:405`) por `?? '?'` como `state-machine.ts:127`, deja `question: 'permiso'` como clave de respuesta y quita `header: 'Permiso'` (`:422`, no se pinta); `permissionDetail` (`:1445`) compone `${pattern} (${path})`. `ROLE_LABELS` y `floorLabel` quedan solo para `injection` (`:801-802`).
- `hub/src/guard.ts:216-218`: `block(reason, target): GuardDecision`; los cinco `block` (`:232`, `:239`, `:245`, `:250`, `:253`) pasan `target`.
- `hub/src/reports.ts`: `summarize` (`:25-38`) devuelve `{ summary: string; summaryText: HubText | null }` (`null` cuando el resumen es texto de agente: `HECHO:`, `BLOQUEADO:` o primera línea de `closing`); `buildReport` guarda ambos; `parse` (`:107-114`) aplica D5 a filas sin `summaryText`.
- `hub/src/documents.ts:172`: `{ path, kind, markdown: '', notice: { key: 'hub.doc.tooLarge' } }`.
- `hub/src/settings.ts`: `applySettings` acumula `HubText[]` y devuelve `{ error: HubText[] }` (mismo nombre que hoy, `:113`); `createSettings.update` devuelve `note: [{ key: 'hub.settings.saved' }, ...failed.map((f) => ({ key: 'hub.settings.regenerateFailed', params: { slug: f.slug, error: f.text ?? f.error } }))]` y `[{ key: 'hub.settings.noChanges' }]`; `SETTINGS_NOTE` desaparece (su texto pasa a `es.ts`).
- `hub/src/server.ts`: cada `c.json({ error: '…' })` pasa a `{ error: { key: 'hub.api.…' } }` (`:121` con array, D2); `PENDING_MESSAGE` (`:27`) pasa a `{ key: 'hub.api.questionClosed' }`. `/guard`, `/gate`, `/gate-message` y `/api/redaccion/sync` no cambian (van al agente).
- `hub/src/floor-cli.ts:26`: `class FloorError extends Error { constructor(message: string, readonly text?: HubText) }`. Lo pasan los siete `throw` de D1-8, `:136` (`hub.floors.missing`) y `:155` (`hub.floors.notFound`); `:221` es solo CLI y no lo necesita. `regenerateAgents` (`:139-141`) guarda `text: error instanceof FloorError ? error.text : undefined`; los `TemplateError` (`agents.ts:34`, `:87`) quedan crudos, declarado. Plan 2, `floor-admin.ts` (`ajustes-gestion-proyectos-2.md:54-55`): sus 400/404/409 van como `hub.floors.*`, `FloorError` → `error.text ?? error.message`, `TemplateError` → `error.message` crudo; `note` del alta → `hub.floors.added`; `forgetFloor` (`:52`) emite `{ key: 'hub.act.floorRemoved', params: { slug } }`.

### D5. Informes ya guardados en español

No hay migración: `db.ts:189-199` prohíbe `UPDATE` desde el esquema v2, y los informes se conservan sin poda (`prune.ts:5-21` no toca `reports`; `README.md:128`). Render legado determinista en `parse` (`reports.ts:107-114`): si la fila no trae `summaryText`, se recalcula con `summarize` sobre los datos guardados (`sent` con `{to, text}`, `closing`, `files.length`, `tests.length`: son los mismos recortes que usó `buildReport`, `:41-57`) y **solo** se adopta si el `summary` recalculado coincide exactamente con el guardado; si no (por ejemplo un `HECHO:` fuera de los últimos 30 mensajes), `summaryText = null` y el panel muestra `summary` tal cual. Resultado: los tres textos del hub se traducen también en informes viejos; el texto de agentes queda como estaba. `memoryContext` sigue leyendo `summary` (español).

### D6. Cambios de UI (sobre la base que dejan los tres planes)

| Fichero (foto) | Cambio |
|---|---|
| `ui/src/i18n/es.ts`, `en.ts` | claves `hub.*` de D3; `ui/src/i18n/hub.ts` nuevo |
| `ui/src/i18n/index.ts` | `interpolate` (`panel-i18n-ayuda.md:45`) tiene que sustituir en una sola pasada (`text.replace(/\{(\w+)\}/g, (m, name) => …)`): ahora recibe comandos y texto de agentes como parámetro y un `{text}` dentro de un `{to}` no debe expandirse. Si la implementación de ese plan fuera secuencial, este plan la cambia |
| `ui/src/api.ts:21-43` | `readError` sigue leyendo `error`/`message` del JSON, pero los pasa por `errorText(t, value)` (`string | HubText | HubText[]`); si devuelve `null`, cae a `raw` como hoy. `fixed` (`:50-58`) se mantiene |
| `ui/src/panel/timeline.ts:35` | `hubText(entry.summary)`; ya repinta en `watch(['lang'])` (`panel-i18n-ayuda.md:92`) |
| `ui/src/table/table.ts:82-83` | `hubText(agent.detail)` en celda y `title`; la Tabla ya escucha `'lang'` (`panel-i18n-ayuda.md:86`) |
| `ui/src/panel/header.ts:31` | `hubText(agent.detail)`; ya escucha `'lang'` (`panel-i18n-ayuda.md:87`) |
| `ui/src/panel/question-form.ts:58` | `question.prompt ? hubText(question.prompt) : ask.question`; `QuestionForm.relabel()` (`panel-i18n-ayuda.md:93`) repone también este párrafo |
| `ui/src/panel/report.ts:58`, `ui/src/panel/memory.ts:30` | `report.summaryText ? hubText(report.summaryText) : report.summary`; ambos ya repintan con `'lang'` (`panel-i18n-ayuda.md:88`, `:91`) |
| `ui/src/panel/deliverables.ts:197` | `result.data.notice ? el('p', 'doc-notice hint', hubText(result.data.notice)) : renderMarkdown(result.data.markdown)`; el visor guarda el `DocumentContent` y su `relabel()` (`panel-i18n-ayuda.md:90`) repone el aviso en el idioma nuevo (solo alcanzable por teclado: `.modal-backdrop` tapa la cabecera, `styles.css:1478-1481`, y el clic en el fondo cierra el visor, `deliverables.ts:142-144`) |
| `ui/src/settings/settings.ts:441`, `:443`, `:445` | `:441` ya recibe el texto traducido por `readError` (rama real, D1-6); `:443` pasa a `hubTexts(response.data.error)` por tipo aunque hoy no se alcance; `:445` `outcomeText(hubTexts(response.data.note), regenerated)`; `outcome` ya se limpia al cambiar idioma (`panel-i18n-ayuda.md:96`) |
| `ui/src/settings/projects.ts` (plan 2) | errores: nada, llegan traducidos por `readError`; `note` del alta se pinta con `hubText` |

Mensajes de error y notas se traducen en el momento de recibirse (son transitorios); actividad, detalle, pregunta, informes y aviso del visor se repintan al cambiar de idioma porque guardan el `HubText`.

### D7. Tests

Hub (`bun test` en `hub/`; `hub/tsconfig.json:13` incluye `test`, así que los tests también pasan por `typecheck`):

- `hub/test/state-machine.test.ts`: nuevo test «summaries and details are keys and raw text stays raw»: `SessionStart` → `summary` `{ key: 'hub.act.sessionStart', params: { source: 'startup' } }` y `detail` `{ key: 'hub.detail.waiting' }`; `PreToolUse` Bash → `detail` igual al comando (cadena). `:126` y `:134` siguen valiendo.
- `hub/test/helpers.ts`: `export function keyOf(value: HubText): string` (`typeof value === 'string' ? value : value.key`) para las aserciones de todos los tests siguientes (`HubText` incluye `string`, así que `.key` a secas no compila).
- `hub/test/texts.test.ts` (nuevo): «every detail and summary the hub emits is a key or raw text without Spanish». Las fixtures solo traen Bash `true`/`false`, Agent, SendMessage, SubagentStart/Stop, TeammateIdle, Stop, UserPromptSubmit y Session* (`hub/test/fixtures/*.json`), y en un repo observado `privacy.ts:15-27` devolvería cadenas crudas, así que: (a) `harness()` y una planta **gestionada** `h.config.floors.mobile = floor(repo)` como `managedRepo` de `office.test.ts:20-25` (stack flutter: matcher de tests `\bflutter\s+test\b` y de check `\bflutter\s+analyze\b`, `plugin/profiles/flutter.json:4-5`); (b) `loadFixture('session-basic.json', repo)` y `team-sandbox.json` por `office.ingest`, más eventos sintéticos con `ev()` que recorren cada rama de `classify` que las fixtures no traen: `PreToolUse`/`PostToolUse`/`PostToolUseFailure` de Edit (`file_path`), Read (con `file_path` y con `pattern`), AskUserQuestion (`questions` y sin ellas), TaskCreate/TaskUpdate (con y sin id en `tool_response`), Bash `flutter test` (Post → pass; Failure → fail; Failure con `is_interrupt: true`), Bash `flutter analyze` (check), Bash `ls` (run y `ok:`), Agent con `description`, SendMessage normal y `BLOQUEADO:`; `Notification` con `permission_prompt`, `idle_prompt` y otro tipo; `PermissionRequest` por `ingest` (`state-machine.ts:123-129`); `TaskCreated`; `SubagentStart` sin `agent_type`; `TeammateIdle` sin `teammate_name`; `SessionEnd` sin `reason`; y por `office`: `gate()` con `TaskCompleted` y `gateMessage()` con un `HECHO:` del jefe (`office.ts:473`, `:504`), `heartbeat(true)` + `permission()` (`:1277`); (c) aserción 1: de `h.messages` (`agent.detail`, `activity.summary`) y del `snapshot()`, cada valor es objeto con `key` que empieza por `hub.` o cadena que no cumple `/[áéíóúñ¿¡]|\b(esperando|pensando|empieza|termina|terminado|sesión|permiso|pregunta|tarea|lección|fichero|tests en|delega|edita|lee|ejecuta|revisa|escribe|avisa|espera|aviso|orden|entrega|guardia|alerta|memoria|fuentes|nuevo turno|queda libre|fin de turno|plan descartado)\b/i` (las palabras que hoy escriben `state-machine.ts` y `office.ts`; un falso positivo se resuelve quitando la palabra); (d) aserción 2, cobertura: el conjunto de `keyOf` vistos contiene la lista explícita de las claves `hub.act.*`/`hub.detail.*` que produce `classify` (D3, primer y segundo grupo, salvo `hub.detail.blocked`, `checking` y `tests`, que son de `office.ts:344` y `privacy.ts`), de modo que una rama que vuelva a emitir una cadena (`summary: 'edita x'` en `state-machine.ts:196`) hace fallar el test aunque la cadena no esté en la lista de palabras. Sustituye al grep de la ronda 1.
- `hub/test/floor-admin.test.ts` (plan 2, `ajustes-gestion-proyectos-2.md:89-91`): sus aserciones sobre texto (`No existe`, `ya es la planta gestionada`, `ya es la planta`, `copia de la que corre la oficina`, `reservado`, el 409 que nombra la sesión y `activity` con `planta borrada`) pasan a `keyOf(error)` igual a `hub.floors.missing`, `conflictManaged`, `pathTaken`, `liveCopy`, `slugReserved`, `inUse` (con `params.sessions` que contiene `lead-mobile`) y `keyOf(summary) === 'hub.act.floorRemoved'`.
- `hub/test/permissions.test.ts:37` → `question?.prompt` `toEqual({ key: 'hub.permission.bash', params: { who: 'lead-mobile' } })`; `:41` → `activity.some((a) => keyOf(a.summary) === 'hub.act.permissionWaiting')`; `:134` → `throw new Error(JSON.stringify(ok.error))`; `:137-138` → `bad.error` `toEqual([{ key: 'hub.settings.badPermissionMode', params: { slug: 'mobile' } }, { key: 'hub.settings.noTarget', params: { slug: 'nada' } }])` (el test manda `mobile: 'bypassPermissions'` y `nada: 'auto'`, `:136`).
- `hub/test/settings.test.ts:25` → `JSON.stringify(result.error)`; `:48` → `const error = 'error' in result ? result.error : []`; `:49-51` → `error.map(keyOf)` igual a `['hub.settings.badModel', 'hub.settings.badEffort', 'hub.settings.unknownRole', 'hub.settings.badDepartment', 'hub.settings.badRange', 'hub.settings.badRange', 'hub.settings.badBranch', 'hub.settings.noFloor']` (orden de `applySettings`); `:73` añade `note: [{ key: 'hub.settings.saved' }]`; `:83` añade `note: [{ key: 'hub.settings.noChanges' }]`; caso nuevo tras `:83`: `rmSync` del repo `mobile` y `update({ roles: { dev: { effort: 'high' } } })` → `note` contiene `{ key: 'hub.settings.regenerateFailed', params: { slug: 'mobile', error: { key: 'hub.floors.missing', params: { path } } } }` (es un guardado con éxito: `:85` pasa a `toHaveLength(2)`).
- `hub/test/server-v2.test.ts:33` → `{ ok: true, regenerated: 11, note: [{ key: 'hub.settings.saved' }] }` / `{ ok: false, error: [{ key: 'hub.settings.noChanges' }] }`; `:103` igual; `:124` añade `expect((await (await call('GET', '/api/reports/nadie')).json()).error).toEqual({ key: 'hub.api.noReport' })`.
- `hub/test/departments.test.ts:354` conserva el `summary` español y añade `summaryText` `toEqual({ key: 'hub.report.empty' })`; `:376` → `toMatchObject({ key: 'hub.act.guardBlocked' })`; test nuevo «a document over MAX_CONTENT_BYTES answers with a notice»: plan de `'x'.repeat(1_000_001)` bytes → `office.documentContent(path)` `toEqual({ path, kind: 'plan', markdown: '', notice: { key: 'hub.doc.tooLarge' } })`.
- `hub/test/guard.test.ts:28` añade `expect(outside.target).toBe(…)`.
- `hub/test/memory.test.ts` (`describe('reports')`, `:80-113`): «a report saved before summaryText is rendered from its data»: `saveReport` de un `ReportView` completo con `files: ['a']`, `tests: [{ ok: true, ts, command: 'x' }]`, `sent: []`, `closing: null`, `summary: '1 fichero cambiado · 1 ejecución de tests'` y su `summaryText`; después `db.query("UPDATE reports SET data = json_remove(data, '$.summaryText') WHERE agent_key = ?").run(key)` (simula la fila legada sin tocar los tipos) → `savedReport(db, key)?.summaryText` `toEqual({ key: 'hub.report.counts', params: { files: { key: 'hub.report.files.one', params: { n: 1 } }, tests: { key: 'hub.report.tests.one', params: { n: 1 } } } })`; segundo informe con `summary: 'HECHO: x'`, `sent: [{ ts, to: 'lead', text: 'HECHO: x' }]` y el mismo `json_remove` → `null`.

UI (`cd ui && bun test`, `ui/test/i18n.test.ts` de `panel-i18n-ayuda.md:128-133`): los tests 1-4 siguen pasando (las claves nuevas van en ambos diccionarios, sin tildes fuera de `i18n/`); test 5 nuevo con `createTranslator(es)` y `createTranslator(en)`: `renderHubText` con cadena cruda tal cual, `null` → `''`, `{ key: 'hub.act.sessionStart', params: { source: 'startup' } }` → `sesión iniciada (startup)` / `session started (startup)`, anidado `{ key: 'hub.act.lessonSaved', params: { role: { key: 'hub.role.redactor' }, floor: { key: 'hub.floor.redaccion' } } }` → `lección guardada para redactor en Redacción`; una sola pasada de `interpolate`: `{ key: 'hub.act.message', params: { to: '{text}', text: 'hola' } }` → `escribe a {text}: hola`; `errorText` con cadena (`'x'` → `'x'`), objeto (`{ key: 'hub.api.noReport' }` → su texto), array (`[{ key: 'hub.settings.saved' }, { key: 'hub.settings.noChanges' }]` → los dos textos unidos por espacio) y `42` → `null`. Es lo que cubre la rama de Ajustes del panel (la prueba manual 4 solo usa curl).

### D8. README y ficheros

`README.md:94-104` (`## Uso`): la línea que `panel-i18n-ayuda.md:139` añade («los textos de los agentes y del hub siguen en español») pasa a «los textos del hub siguen el idioma del panel; los mensajes de los agentes, no».

Ficheros que toca: `hub/src/types.ts`, `texts.ts` (nuevo), `state-machine.ts`, `privacy.ts`, `office.ts`, `guard.ts`, `reports.ts`, `documents.ts`, `settings.ts`, `server.ts`, `floor-cli.ts`, `floor-admin.ts` (plan 2); `hub/test/texts.test.ts` (nuevo), `hub/test/helpers.ts`, `hub/test/{state-machine,permissions,settings,server-v2,departments,guard,memory}.test.ts`, `hub/test/floor-admin.test.ts` (plan 2); `ui/src/i18n/{es,en}.ts`, `ui/src/i18n/hub.ts` (nuevo), `ui/src/i18n/index.ts` (solo si `interpolate` no es de una pasada), `ui/src/api.ts`, `panel/{timeline,header,question-form,report,memory,deliverables}.ts`, `table/table.ts`, `settings/settings.ts`, `settings/projects.ts` (plan 2); `ui/test/i18n.test.ts`; `README.md`. No toca `config.json`, `db.ts`, `questions.ts`, `gate.ts`, `sync.ts`, `memory.ts`, `agents.ts` ni `notify.ts` (plan 3).

## Pasos

1. `hub/src/types.ts` solo con `HubTextParams`, `HubTextKey`, `HubText`, `ActivityView.summary` y `AgentView.detail`; `hub/src/texts.ts`; `state-machine.ts` y `privacy.ts` a `HubText`; `keyOf` en `hub/test/helpers.ts`. Verificable: `cd hub && bun run typecheck` señala `office.ts` y los tests que leen `detail`/`summary` (`permissions.test.ts:41`, `departments.test.ts:376`), nada más; el test nuevo de `state-machine.test.ts` pasa.
2. `types.ts` (`QuestionView.prompt`, `ReportView.summaryText`, `DocumentContent.notice`), `office.ts` (runtime, `pushActivity`, `permission`, `view`), `guard.ts` (`GuardDecision`), `reports.ts` (`summaryText` y D5), `documents.ts` (`notice`). Verificable: `bun run typecheck` del hub limpio; `departments.test.ts`, `permissions.test.ts`, `guard.test.ts` y `memory.test.ts` adaptados en verde.
3. `types.ts` (`SettingsResult`, cuerpos de error, `RegenerateResult.text`, tipos de plan 2), `settings.ts`, `server.ts`, `floor-cli.ts` (`FloorError.text`, `RegenerateResult.text`) y `floor-admin.ts`. Verificable: `settings.test.ts`, `server-v2.test.ts`, `floor-cli.test.ts` y `floor-admin.test.ts` (plan 2) en verde.
4. `hub/test/texts.test.ts`. Verificable: `cd hub && bun test` completo en verde; meter a propósito `summary: 'edita x'` como cadena en `state-machine.ts:196` lo hace fallar por la aserción de cobertura (D7), y `detail: 'editando'` en la misma línea, por la lista de palabras.
5. `ui/src/i18n/{es,en}.ts` con todas las claves `hub.*`, `ui/src/i18n/hub.ts`, `SAME_KEYS`, test 5. Verificable: `cd ui && bun run typecheck` pasa (si falta una clave de `HubTextKey`, falla en `hubKeysCovered`); `cd ui && bun test` pasa.
6. Consumidores de UI de D6 (`api.ts`, `timeline`, `table`, `header`, `question-form`, `report`, `memory`, `deliverables`, `settings`, `projects`). Verificable: `bun run typecheck` de raíz; `bun run build`.
7. README. Verificable: lectura.
8. `bun run typecheck && bun run test && bun run build` en el clon y la receta manual de Verificación.

## Riesgos

- Clave emitida por el hub sin entrada en `es.ts`, parámetros que no cuadran con `HubTextParams` en el hub o `{marcadores}` de `es.ts` que no cuadran con `HubTextParams`: lo para `typecheck` (`hubKeysCovered`, `markersMatch`, D2, D3), no llega a producción. Lo que el tipo **no** impide es emitir una cadena española, porque `HubText` incluye `string` para el texto crudo: eso lo vigila `hub/test/texts.test.ts` (cobertura de claves para las ramas de `classify`, lista de palabras para el resto) y la receta manual.
- Textos del hub que escapen al inventario: el rastreo de `ui/test/i18n.test.ts` no mira `hub/src`; `texts.test.ts` cubre `classify` entera y las rutas de `office.ts` que recorre, y la revisión manual (Verificación 1-8) el resto. Los literales que quedan en `hub/src` son de agentes, terminal o `MISSING_UI` (Alcance).
- Grabaciones antiguas (`demo.json`) y clientes con la UI vieja en caché tras actualizar el hub: la cadena cruda se muestra tal cual y un objeto se vería como `[object Object]` hasta recargar; el hub sirve la UI con `Cache-Control: no-store` (`server.ts:285`), así que basta recargar.
- `reports.data` crece una clave por informe; sin migración ni índice. Los informes legados se recalculan en cada lectura (`parse`), coste de unas comparaciones por fila, 50 filas por rol como máximo (`reports.ts:6`).
- `applySettings` cambia la forma de `error` (array): `permissions.test.ts` y `settings.test.ts` lo cubren; la UI solo lo pinta.
- `floor-admin.ts` no existe en la foto: si plan 2 cambia el nombre de sus resultados, lo que se atribuye aquí (`error`, `note`, 409/404) se ajusta al ejecutar; el principio es el mismo (`FloorError.text`).
- La lista de palabras de `texts.test.ts` no ve un literal español que no esté en ella ni rutas de `office.ts` que el test no recorra (`order`, `discardDocument`, `syncSources`, `recordAlert`, `handleProtocol`, `commitRound`): para esas vale la receta manual y la revisión del diff de `office.ts` contra los catorce `pushActivity` de D1.

## Verificación

Automática, en el clon (`CLAUDE.md:17`):

```sh
bun run typecheck          # hub y ui; ui/src/i18n/hub.ts comprueba HubTextKey ⊆ MessageKey
bun run test               # hub (incluido texts.test.ts) + ui/test/i18n.test.ts
bun run build
```

Manual, con hub aislado (`CLAUDE.md:18`): sin `bun run setup` ni `bun run floor` (`CLAUDE.md:11`); key a mano (`readKey` solo lee, `hub/src/config.ts:246`); `docsRepo` temporal obligatorio porque `office.start()` (`hub/src/main.ts:73`) lanza `sync.cleanup` (`office.ts:282`, `sync.ts:200-211`), que con la base de datos vacía borraría las fotos de `~/Projects/office-docs` (valor por defecto, `config.ts:103`); `bun hub/src/main.ts` es regla `ask` (`plugin/settings/clone-permissions.json:15`). Departamentos encendidos para tener Redacción (seguro con `docsRepo` en `$H/docs`).

```sh
H=$(mktemp -d); C=$(mktemp -d); D=$(mktemp -d)
openssl rand -hex 32 > $H/key
echo '{"port":4799,"docsRepo":"'$H'/docs","departments":{"redaccion":true,"mantenimiento":false},"floors":{"demo":{"path":"'$D'","stack":"node","managed":true,"baseBranch":"main"}}}' > $H/config.json
mkdir -p "$H/docs/redaccion/planes"
bun run build
AGENT_OFFICE_HOME=$H AGENT_OFFICE_CLAUDE_HOME=$C bun hub/src/main.ts &
KEY=$(cat $H/key); U='http://127.0.0.1:4799'
until curl -sf "$U/health" >/dev/null; do sleep 0.2; done
post() { curl -s -X POST "$U/$1" -H "X-Office-Key: $KEY" -H "X-Office-Role: ${ROLE:-office-lead-demo}" -H "X-Office-Name: ${NAME:-lead-demo}" -H 'Content-Type: application/json' -d "$2"; }
ev() { post events '{"session_id":"'$1'","cwd":"'$2'","hook_event_name":"'$3'"'"${4:+,$4}"'}'; }
ev demo-1 $D SessionStart
ev demo-1 $D PreToolUse '"tool_name":"Edit","tool_input":{"file_path":"'$D'/a.ts"}'
ev demo-1 $D PostToolUse '"tool_name":"Edit","tool_input":{"file_path":"'$D'/a.ts"}'
ev demo-1 $D PreToolUse '"tool_name":"Bash","tool_input":{"command":"bun test"}'
ev demo-1 $D PostToolUse '"tool_name":"Bash","tool_input":{"command":"bun test"}'      # último evento: detail = tests en verde (state-machine.ts:263)
ROLE=office-redactor NAME=redactor-demo ev demo-2 $H/docs/redaccion SessionStart
ROLE=office-redactor NAME=redactor-demo ev demo-2 $H/docs/redaccion PreToolUse '"tool_name":"SendMessage","tool_input":{"to":"team-lead","message":"LECCIÓN: cita siempre la rama base"}'
ROLE=office-redactor NAME=redactor-demo ev demo-2 $H/docs/redaccion UserPromptSubmit     # detail = pensando (state-machine.ts:116)
ROLE=office-redactor NAME=redactor-old ev demo-3 $H/docs/redaccion SessionStart
ROLE=office-redactor NAME=redactor-old ev demo-3 $H/docs/redaccion SessionEnd '"reason":"exit"'
# … pruebas 1-8 …
kill %1; rm -rf "$H" "$C" "$D"
```

1. Abrir `$U`, poner `English`. Tabla: `lead-demo` con detalle `tests green` (el `PostToolUse` de Edit no trae `detail`, `state-machine.ts:270`, y `office.ts:342` solo asigna si lo hay: el último que lo fija es el de `bun test`) y `redactor-demo` con `thinking`. Seleccionar `lead-demo`: la cronología dice `session started (startup)`, `edit a.ts`, `edited a.ts`, `tests: bun test`, `tests green: bun test`; ningún texto en español. Seleccionar `redactor-demo`: `writes to team-lead: LECCIÓN: …` (el texto del agente, crudo), `lesson saved for writer in …` (D3: `hub.role.redactor` en inglés es `writer`; la planta lleva la misma etiqueta inglesa que pone la Tabla a Redacción), `new turn`.
2. Cambiar a `Español` sin reiniciar el hub: Tabla (`tests en verde`, `pensando`) y cronología (`sesión iniciada (startup)`, `tests en verde: bun test`, `lección guardada para redactor en Redacción`) se repintan. Volver a `English` y recargar: el snapshot trae las mismas entradas y salen en inglés.
3. Permiso: en inglés y con `lead-demo` seleccionado, en segundo plano o en otra terminal: `post permission '{"session_id":"demo-1","cwd":"'$D'","hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"rm -rf build"}}' &` (el curl espera a la respuesta; `/permission` no pasa por `ingest`, así que el detalle de `lead-demo` sigue en `tests green`). La tarjeta pregunta `Do you allow lead-demo to run this command?` con `rm -rf build` debajo; cambiar a español con la tarjeta abierta la traduce; `Allow` → el curl imprime `"behavior":"allow"`.
4. Ajustes en inglés: cambiar el esfuerzo de un rol y guardar → la nota sale en inglés (`Saved. Agents and launchers…`) y los agentes se escriben en `$C/agents`. Por curl: `curl -s -X POST $U/api/settings -H "X-Office-Key: $KEY" -H 'Content-Type: application/json' -d '{"roles":{"dev":{"model":"x y"}}}'` → `{"ok":false,"error":[{"key":"hub.settings.badModel","params":{"id":"dev"}}]}` (la rama del panel que pinta este array está cubierta por el test 5 de UI).
5. Error de API en el panel: con `redactor-demo` seleccionado, en Memoria añadir la lección `prueba` dos veces → la segunda muestra `That lesson is already saved` (409, `hub.api.lessonDuplicate`); en español, `Esa lección ya está guardada`.
6. Informe: con `lead-demo` seleccionado, Informe muestra `1 file changed · 1 test run` en inglés y `1 fichero cambiado · 1 ejecución de tests` en español. Con `redactor-demo` seleccionado, `Informes anteriores del rol` lista a `redactor-old` con `No files, tests or messages yet` / `Todavía sin ficheros, tests ni mensajes`.
7. Legado: `sqlite3 $H/office.db "update reports set data = json_remove(data, '$.summaryText')"` y `sqlite3 $H/office.db "select summary from reports"` (español, para los agentes); recargar el panel en inglés y repetir el punto 6 para `redactor-old`: sigue en inglés (D5).
8. Visor: `head -c 1100000 /dev/zero | tr '\0' x > "$H/docs/redaccion/planes/grande.md"` (el hub lo detecta por `watch`, `documents.ts:86-99`); en la Tabla, clic en `grande` → el visor muestra `This document is too large to show here`; cerrar el visor (un clic en el fondo lo cierra, `deliverables.ts:142-144`, y el fondo tapa el selector, `styles.css:1478-1481`), poner `Español` y volver a abrirlo → `El documento es demasiado grande…`. Con teclado (Tab desde el visor hasta `select.lang-select` y flechas) el aviso cambia sin cerrar el visor; es opcional. `?replay=/replays/demo.json` reproduce sin errores con sus textos en español (cadenas crudas).

## Preguntas abiertas

- `hub.role.*` duplica los nueve nombres de rol de `office.ts:165-175` (que siguen sirviendo al `memoryContext` de los agentes). Alternativa: que `memoryContext` también use claves y un diccionario español mínimo en el hub; no compensa mientras los agentes trabajen en español.
- Los `FloorError` de la terminal siguen en español (`message`); si algún día el CLI también se traduce, `text` ya está.
- `hub.floors.added` es propuesta de este plan para la `note` del alta de plan 2, que no la detalla; quien ejecute plan 2 puede fijar otra clave.

## Historial de revisión

- Ronda 1: versión inicial.
- Ronda 2 (nota 6/10, 3 bloqueantes y 9 menores, todos aplicados):
  - Bloqueantes: (1) la rama real de los errores de Ajustes es `settings.ts:441` vía `api.ts:108`; `readError` pasa por `errorText` puro (`string | HubText | HubText[]`), `server.ts:121` devuelve array, y el test 5 de UI cubre cadena, objeto y array (D1-6, D3, D6, D7). (2) `documents.ts:172` entra como fila 9 con `DocumentContent.notice` y `hub.doc.tooLarge`, test en `departments.test.ts`, `deliverables.ts:197` y prueba manual 8; repasado `hub/src` con el grep de literales sin tilde y lo que queda se declara en Alcance (D1, D4, D6, D8). (3) Receta reordenada (Edit antes, `bun test` al final, `UserPromptSubmit` para `redactor-demo`) con la explicación de `office.ts:342`/`state-machine.ts:270` y el detalle esperado (Verificación 1-2).
  - Menores: (4) `GuardDecision` en `guard.ts` sin tocar `gate.ts`; `FloorAddResult`/`FloorRemoveResult` de plan 2 a `HubText` (D2, D8). (5) `FloorError.text` opcional, `:136` y `:155` con clave, `RegenerateResult.text`, `regenerateFailed {slug,error}` con `error` anidado, `TemplateError` crudo declarado (D2, D3, D4). (6) `settings.test.ts:25`, `permissions.test.ts:134` y `server-v2.test.ts:33` tipados; expectativa de `:137-138` con `badPermissionMode {slug}` y `noTarget {slug}`, sin `value`; test legado con `summaryText: undefined` y datos que cuadran (D7). (7) El grep de Verificación se sustituye por `hub/test/texts.test.ts` (fixtures por `ingest`, lista de palabras) y Riesgos lo dice (D7, Riesgos). (8) Parámetros tipados por clave con `HubTextParams` (D2). (9) `hub.role.director` y `hub.role.tester` en `SAME_KEYS` (D3). (10) Cifras retiradas, `taskCreatedPlain`, `hub.floors.added` y `header: 'Permiso'` eliminado (D3, D4). (11) Aserciones del 404 de `/api/reports` y de `note` en `settings.test.ts` (D7). (12) `post permission … &` y nota de que `/permission` no toca el detalle (Verificación 3).
- Ronda 3 (nota 7/10, 1 bloqueante y 11 menores, todos aplicados):
  - Bloqueante: `texts.test.ts` rehecho sobre una planta gestionada con eventos sintéticos que recorren cada rama de `classify` (más `gate`, `gateMessage` y `permission`) y una aserción de cobertura de claves, de modo que la mutación del Paso 4 sí falla; Riesgos deja claro que el tipo garantiza claves y parámetros, no la ausencia de cadenas (D7, Pasos, Riesgos).
  - Menores: (2) prueba 8 con el visor cerrado y reabierto por idioma, teclado opcional (Verificación, D6). (3) `floor-admin.test.ts` de plan 2 en D7 y D8. (4) `keyOf` en `helpers.ts`, `settings.test.ts:48`, `permissions.test.ts:41` y el caso legado por `json_remove` sin tocar el tipo de `summaryText` (D7). (5) `applySettings` devuelve `{ error: HubText[] }` (D4). (6) Tipos de `types.ts` repartidos por paso (Pasos 1-3). (7) `publicSummary` pasa a `HubText` (D4). (8) `markersMatch` compara los `{marcadores}` de `es.ts` con `HubTextParams` en compilación y `plural` tipa `base` como `PluralBase` (D3, Riesgos). (9) `hub.role.redactor` en inglés es `writer`, `hub.floor.*` usa el literal de `floor.*`; prueba 1 y 2 corregidas (D3, Verificación). (10) `FloorAddResult.note: HubText` (D2). (11) `interpolate` de una pasada, con caso en el test 5 (D6, D7). (12) `?? '?'` en `office.ts:405` (D4).
