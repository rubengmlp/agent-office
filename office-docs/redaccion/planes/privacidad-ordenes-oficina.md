# Privacidad y órdenes por pertenencia a la oficina (M3 + M9), con la corrección del README que acompaña

## Contexto

Agent Office distingue las sesiones de la oficina de las personales del usuario con `inOfficeScope` (`hub/src/scope.ts:109-116`: falso en plantas observadas; en el resto, verdadero solo si la sesión o el jefe de su equipo llevan un rol `office-*`). Hoy esa función solo protege las preguntas y los permisos (`hub/src/office.ts:466,484`), la memoria inyectada (`hub/src/office.ts:948`) y la puerta de tests. La privacidad no la usa: `hub/src/privacy.ts:5-7` decide por el tipo de planta, así que una sesión normal del usuario abierta en `~/Projects/mobile` (planta gestionada) guarda el evento completo con `tool_input` y `tool_response` (`hub/src/office.ts:438-448`), enseña el primer renglón de cada prompt como «encargo» (`hub/src/office.ts:421-424`), guarda sus mensajes (`hub/src/office.ts:1408-1411`) y, en cada `Stop`, un informe con el último mensaje del asistente (`hub/src/office.ts:455,923-926`) en la tabla `reports`, que no se poda nunca y cuyo tope de 50 por puesto no se aplica a las sesiones sin rol (`hub/src/reports.ts:115`). Por el otro lado, el cuadro de órdenes del panel lista toda sesión con socket (`ui/src/panel/orders.ts:45-46`) y `order()` entrega a cualquiera (`hub/src/office.ts:619-644`), también a sesiones de Claude ajenas a la oficina.

Son los hallazgos S2 y S7 de la auditoría (`redaccion/planes/auditoria-agent-office.md`, sección 1), las mejoras M3 y M9 de su sección 2, la regla M24 (cada test se escribe antes de su corrección, en la misma rama) y la parte de M29 que corrige el README (D1, D2). La pregunta abierta de la auditoría sobre qué hacer con las sesiones personales en plantas gestionadas está decidida en el brief: por defecto se tratan como observadas y se añade el ajuste `privacy.managedPersonalSessions: 'observe' | 'ignore'`.

Base sobre la que se escribe:

- agent-office-dev build/v1 @ 7c89614 (2026-10-16)

Las rutas son relativas a la raíz de la planta; en la foto están en `redaccion/.fuentes/privacidad-ordenes-oficina/agent-office-dev/`. Todo el trabajo se hace en el clon `~/Projects/agent-office-dev`, nunca en la copia en vivo, y cualquier hub de pruebas se arranca solo con `AGENT_OFFICE_HOME`, `AGENT_OFFICE_CLAUDE_HOME` y `docsRepo` temporales (`CLAUDE.md`, reglas 1 y 3 y «Permitido»).

## Objetivo

Criterios de aceptación del brief, literales:

- M3. `storedPayload`, `publicText`, la línea de encargo y `storeReport` usan `inOfficeScope` (hub/src/scope.ts) además de `isPrivate`: una sesión que no es de la oficina se trata como observada aunque esté en una planta gestionada, y no genera informe.
- M9. `order()` rechaza con 403 (`'not-office'`) las sesiones que no pasen `inOfficeScope`; el selector del panel (ui/src/panel/orders.ts) las oculta.
- Docs: corregir README.md:149-151 (privacidad en plantas gestionadas) y README.md:187 (frase «no está hecho» sobre PermissionRequest).
- Decisión sobre la pregunta abierta: por defecto las sesiones personales en plantas gestionadas se tratan como observadas (solo estado y rutas). Añadir el ajuste `privacy.managedPersonalSessions: 'observe' | 'ignore'` con `observe` por defecto.
- Test: sesión sin rol `office-*` en planta gestionada guarda payload = NULL, no muestra task, no aparece en /api/reports y no deja fila en reports.
- Test en hub/test/server-v2.test.ts: /api/orders a una sesión del usuario en planta observada devuelve 403.
- README actualizado en las dos líneas, sin la frase «no está hecho» sobre permisos.
- Regla M24: cada test se escribe antes del cambio, misma rama; falla con `git stash` de la corrección y pasa con ella.
- `bun run test` y `bun run typecheck` en verde, validados por el tester de la planta.

## Alcance

Entra:

- Pertenencia a la oficina como criterio de privacidad en el hub: eventos, encargo, mensajes, etiqueta de fichero, informe y respuesta de `/api/reports/:agentKey` de las sesiones que no son de la oficina.
- El ajuste `privacy.managedPersonalSessions` en `config.json`, `normalizeConfig`, `settingsView`/`applySettings` y la pestaña Ajustes del panel.
- `order()` y `/api/orders` rechazando sesiones ajenas con 403, el campo `office` en `SessionView` y el filtro del selector del panel.
- Los tests de M24 de estos dos hallazgos (hub) y un test puro del filtro del selector (ui).
- `README.md:120,149-151,187`.

Queda fuera:

- El resto de la auditoría (M1, M2, M4-M8, M10-M32 y las features).
- `docs/api.md` y `docs/db.md` (la otra parte de M29).
- Borrar las filas de `reports` que las sesiones personales ya dejaron antes de este cambio (ver Preguntas abiertas): no hay poda de `reports` y añadirla es otra decisión.
- Cambiar qué se pinta en la oficina 2D/3D para una sesión observada: una sesión personal en planta gestionada pasa a verse exactamente como hoy se ve una sesión en planta observada.
- Los hooks del plugin (`plugin/hooks/*.sh`) y las cabeceras `X-Office-Role`/`X-Office-Name`: el rol ya llega con cada evento (`plugin/hooks/emit.sh:19-20`, `hub/src/server.ts:329-337`).

## Diseño

### Qué es «sesión de la oficina» y dónde se decide

`inOfficeScope` ya existe y es la definición: planta no observada y rol `office-*` en la sesión o en el jefe de su equipo (`hub/src/scope.ts:109-116`, con `isOfficeRole` en `28-30`). El hub ya la aplica en `inScope` (`hub/src/office.ts:1503-1511`) con dos fuentes para el rol de la sesión: la cabecera (`session.role`, que `touchSession` toma de `meta.role` en `1258-1264`) y, si no, el rol del agente principal (`this.agents.get(session.sessionId)?.role`), que `touchAgent` fija en `1358` a partir de `agent_type`/spawn. Esa segunda fuente importa: la fixture real `hub/test/fixtures/team-sandbox.json:3-9` trae `agent_type: "office-lead-office-sandbox"` en los eventos de la sesión principal y ningún header, y `roleForEvent` (`976-990`) ya acepta `e.agent_type` como rol de la oficina.

Decisión en dos partes.

**(a) El rol de la sesión principal se fija en `touchSession`, no solo en `touchAgent`.** Hoy `touchSession` emite la vista de la sesión (`hub/src/office.ts:1280-1283`) antes de que `touchAgent` fije el rol del agente principal (`1358`), y `sessions.role` solo se rellena desde la cabecera (`1258-1264`). Para un jefe lanzado con `claude --agent office-lead-mobile` sin lanzador (la fixture) eso dejaría `office: false` en la vista emitida y, tras reiniciar el hub, `restoreSessions` (`1700,1731`) lo repondría sin rol: sus subagentes se tratarían como personales hasta el siguiente evento de la sesión principal. Por eso `touchSession` toma el rol también de `agent_type` cuando el evento es de la sesión principal, antes de persistir y emitir:

```ts
// hub/src/office.ts, en touchSession tras el bucle de meta (1258-1264) y antes de `if (changed)` (1280)
const mainType = e.agent_id ? null : text(e.agent_type);
if (!session.role && isOfficeRole(mainType)) {
  session.role = canonicalRole(mainType);
  changed = true;
}
```

Así el rol se persiste en `sessions` (`persistSession`, `1679-1681`), `restoreSessions` lo repone, y la vista sale con `office: true` desde el primer evento. Es el mismo criterio que ya aplica `roleForEvent` (`980-981`: `agent_type` con prefijo `office-` vale como rol).

Como `office` es derivado y `touchSession` solo emite la vista cuando cambia un campo de la sesión (`1280-1283`), hay un segundo momento en que la pertenencia puede cambiar sin que cambie la sesión: cuando `touchAgent` fija por primera vez el rol del agente principal (`1358`) a partir de spawn o configuración del equipo. En ese punto, si `isMain` y el rol pasa de nulo a uno de la oficina, se vuelve a emitir `{ type: 'session', data: this.sessionView(session) }`. Queda un caso sin re-emisión, anotado en Riesgos: el compañero con sesión propia cuyo jefe llega después.

**(b) Una sola función privada, `sessionInOffice`, sustituye el cuerpo de `inScope`** y resuelve el rol del jefe del equipo como ya hace `gate()` (`535`: cabecera y, si no, rol del agente principal de esa sesión), para que un compañero en sesión propia cuyo jefe se identificó por `agent_type` no quede fuera:

```ts
// hub/src/office.ts, sustituye a inScope (1503-1511); inScope(e, session) pasa a ser sessionInOffice(session, text(e.team_name))
private sessionInOffice(session: SessionRuntime, team: string | null = null): boolean {
  const lead = this.leadSession(team ?? session.team);
  return inOfficeScope({
    floorKind: session.floorKind,
    sessionRole: session.role ?? this.agents.get(session.sessionId)?.role ?? null,
    leadRole: lead ? (lead.role ?? this.agents.get(lead.sessionId)?.role ?? null) : null,
  });
}
```

No se persiste ningún flag nuevo ni cambia el esquema: la pertenencia se deriva de `sessions.role` (ahora también desde `agent_type`) y de `agents`.

### Cómo se aplica a la privacidad: tipo de planta efectivo

Las funciones de `hub/src/privacy.ts` reciben un `FloorKind` y recortan cuando es `observed` (`isPrivate`, `5-7`). En vez de cambiar su firma en todos los puntos, el hub les pasa un **tipo efectivo**: el de la planta si la sesión es de la oficina y `observed` si no. Un ayudante puro en `privacy.ts` deja la regla escrita junto a `isPrivate`:

```ts
// hub/src/privacy.ts
export function visibleKind(kind: FloorKind, inOffice: boolean): FloorKind {
  return inOffice ? kind : 'observed';
}
```

y en `Office` un atajo `private privacyKind(session: SessionRuntime, team: string | null = null): FloorKind { return visibleKind(session.floorKind, this.sessionInOffice(session, team)); }`.

Por qué así y no `storedPayload(e, kind, inOffice)`: `kind` ya alimenta `publicDetail`, `publicSummary`, `publicText`, `storedPayload`, `remembers` y la comparación `kind === 'observed'` de `blockedReason` (`hub/src/office.ts:412,415,422,426,429,432,447,452`); con el tipo efectivo todas quedan cubiertas con un solo cambio en `ingest`, y `privacy.ts` sigue siendo una función pura del tipo de planta, probada como hasta ahora. `classify` sigue usando `session.floorKind` real (`372`: `isDepartmentFloor` decide el perfil de tests), porque la clasificación del evento no es privacidad.

Puntos que pasan a usar el tipo efectivo (todos en `hub/src/office.ts`):

| Punto | Hoy | Cambio |
|---|---|---|
| `ingest`, `371` | `const kind = session.floorKind` | Se separa: `const floorKind = session.floorKind` para `classify` (`372`); `const inOffice = this.sessionInOffice(session, text(e.team_name))` y `const kind = visibleKind(floorKind, inOffice)` justo después de `touchSession` (`370`), antes del camino corto de `376-379`. Con `kind` efectivo quedan cubiertos `377` (payload del agente desconocido), `412`, `415`, `422` (línea de encargo del prompt), `426` (`remembers(kind)` deja de guardar `closing`), `429`, `432`, `447` y `452`. |
| `storeReport`, `923-926` | `if (!remembers(agent.floorKind) \|\| contextFree(...)) return` | La firma no cambia, porque tiene tres llamadores: `ingest` (`455`), `retire` (`1126`) y `endSession` (`1582`, que guarda el informe de todos los agentes de la sesión en cada `SessionEnd`). Dentro: `const session = this.sessions.get(agent.sessionId); if (session && !this.sessionInOffice(session)) return;` antes de `saveReport`. Cubre los tres caminos; sin informe no hay fila en `reports` ni `closing` guardado. |
| `report`, `678-682` | Para un agente vivo construye el informe siempre | Si `this.sessions.get(agent.sessionId)` existe y no es de la oficina, devuelve `null` → `/api/reports/:agentKey` responde 404 (`hub/src/server.ts:163-166`, sin cambios). |
| `ingestRetired`, `1145-1146` | `storedPayload(e, session.floorKind)` | `this.privacyKind(session, text(e.team_name))`. |
| `restoreSessions`, `1687-1741` | Crea agente y sesión por cada fila abierta con socket | En modo `ignore`, para filas de planta `managed` sin rol de la oficina, repone solo la sesión (ver el ajuste). |
| `decidePlan`, `713-715` | `if (sent !== 'ok') return sent;` devuelve el `OrderResult` como `DecideResult` (`160`) | Con `'not-office'` en `OrderResult` deja de compilar. Se trata explícito: `if (sent === 'not-found' \|\| sent === 'not-office') return 'no-director';` antes del `if (sent !== 'ok') return sent;`. En la práctica no se da, porque `directorSession` (`1482-1490`) ya exige `office-director`. |
| `applySpawn`, `1386` | `publicText(call.description, agent.floorKind)` | `publicText(call.description, this.privacyKindOf(agent))`, con `privacyKindOf(agent)` = `privacyKind(this.sessions.get(agent.sessionId))` y `agent.floorKind` si la sesión no está. Oculta la descripción del `Agent` con que el usuario lanza sus propios subagentes. |
| `recordMessage`, `1410` | `publicText(message.text, session.floorKind)` | `this.privacyKind(session)`. Con `body` nulo tampoco entra en `handleProtocol` (`1419`), así que un `LECCIÓN:` o `HECHO:` de una sesión personal deja de contar como protocolo. |
| `fileLabel`, `1445` | `isPrivate(session.floorKind)` | `isPrivate(this.privacyKind(session))`: solo el nombre del fichero, como en observadas. |
| `order`, `637` | `publicText(body, session.floorKind)` | Se mantiene para la sesión aceptada; las ajenas ya se rechazaron antes (ver M9). |

`injection` (`945-950`) ya usa `inOfficeScope` y no cambia. `ask` y `permission` (`466,484`) siguen llamando a `inScope`, que ahora delega en `sessionInOffice`.

Qué sigue guardándose de una sesión que no es de la oficina, igual que hoy en las plantas observadas y fuera de este plan: el título de la sesión (`session_title` → `sessions.name`, `hub/src/office.ts:1265-1268`), el asunto de las tareas (`recordTask`, `1401-1406`, y `gate()` en `547-559`, con sus filas en `tasks` y `gate_decisions` y la actividad con el asunto). El README lo dice tal cual; cambiarlo sería otra decisión sobre las observadas.

### El ajuste `privacy.managedPersonalSessions`

- Tipo: `export type PrivacyMode = 'observe' | 'ignore'; export type PrivacyConfig = { managedPersonalSessions: PrivacyMode };` y `privacy: PrivacyConfig` en `OfficeConfig` (`hub/src/types.ts:238-252`), en `SettingsView` (`494-506`) y como `privacy?: Partial<PrivacyConfig>` en `SettingsUpdate` (`508-518`).
- Valor por defecto `{ managedPersonalSessions: 'observe' }` en `DEFAULT_CONFIG` (`hub/src/config.ts:110-124`), `PRIVACY_MODES` y `validPrivacyMode` junto a `PERMISSION_MODES`/`validPermissionMode` (`98,149-151`), y normalización en `normalizeConfig` (`236-275`) con el patrón de `permissionModes`: valor inválido → por defecto.
- `settingsView` lo expone (`hub/src/settings.ts:46-64`) y `applySettings` lo acepta con el patrón de `leaveAfterMinutes` (`177-180`): inválido → `{ key: 'hub.settings.badPrivacyMode' }`.
- Semántica en `ingest`: con `observe` (defecto) la sesión personal se trata como observada (todo lo anterior; vale para cualquier planta no observada, también `direccion`, `redaccion` y `mantenimiento`, porque ahí `inOfficeScope` es falso sin rol). Con `ignore`, **solo en plantas `managed`** (es lo que nombra la clave; en Dirección y los departamentos una sesión personal sigue tratándose como observada), si `!inOffice && floorKind === 'managed'`, `ingest` sale justo después de `classify` (`372`) y antes del camino corto de `376` y de `touchAgent`: `if (c.sessionEnded) this.endSession(session, now); return null;`. No crea agente, no inserta en `events`, no hay actividad ni informe por `ingest`; el `SessionEnd` sí cierra la sesión (`endedAt`), porque si no `restoreSessions` la repondría mientras exista el socket (`1688-1692`). `endSession` (`1570-1586`) no encuentra agentes de esa sesión, así que no guarda nada. Un ayudante `private ignored(session: SessionRuntime, inOffice: boolean): boolean` concentra la condición para `ingest` y `restoreSessions`.
- `restoreSessions` (`1687-1741`) crea hoy un `AgentRuntime` por cada fila abierta de `sessions` con socket vivo (`1695`, con `name: row.name`, que es el `session_title` de `1265-1268`). Sin cambio, una sesión personal ignorada reaparecería tras cada reinicio como agente parado con su título, y se quedaría hasta que `tick()` viera morir el socket, porque sus eventos siguientes salen antes de `touchAgent`. Cambio: con `managedPersonalSessions === 'ignore'`, `floor.kind === 'managed'` y `!isOfficeRole(row.role)`, se repone la sesión (`1725-1739`, la liveness la necesita) y **no** el agente (`1695-1724`). La fila de `sessions` sí existe (id, `cwd`, planta, socket y el título de la sesión si llega), porque `touchSession` la crea antes de saber nada más y porque la necesita la liveness; no lleva rol y el selector de órdenes la oculta igual por `office: false`. `ask`/`permission` ya devuelven `null` para ella (`inScope`). Las plantas observadas no cambian con el ajuste: ya guardan solo estado y rutas.
- Por qué el ajuste es global y no por planta: el brief lo fija así; la auditoría lo propuso como una opción de Ajustes y una por planta se añadiría después sin cambiar el esquema (`permissionModes` es el modelo).
- Panel: nueva sección «Privacidad» en Ajustes con un `<select>` de dos opciones, construida como las filas de modo de permisos (`ui/src/settings/settings.ts:369-386`) e insertada tras la sección Oficina (`402`). `ui/src/settings/options.ts` gana `PRIVACY_MODE_OPTIONS` junto a `PERMISSION_MODE_OPTIONS` (`56-62`); `ui/src/settings/draft.ts` gana `privacy: PrivacyMode` en `SettingsDraft` (`29-36`), `draftFrom` (`117-136`), `reconcileDraft` (`138-144`, conserva el valor del borrador), `diffDraft` (`187-261`: `update.privacy = { managedPersonalSessions }` si cambia) y `applyUpdate` (`267-299`: `privacy: { ...view.privacy, ...update.privacy }`); `settings.ts` añade el `<select>` a `Controls` y lo sincroniza en `syncControls` (`470-493`) con `setValue`. La `signature` de `render` (`259`) no necesita el valor: solo decide cuándo se reconstruyen los controles.
- Textos solo en `ui/src/i18n/es.ts` y `en.ts` (pintados con `t()`): `settings.section.privacy`, `settings.section.hint.privacy`, `settings.field.managedPersonalSessions`, `settings.field.hint.managedPersonalSessions`, `settings.privacyMode.observe`, `settings.privacyMode.ignore`, `settings.aria.privacyMode`, `hub.settings.badPrivacyMode` y `hub.api.sessionNotOffice`. La ayuda (`settings.field.hint.managedPersonalSessions`) dice que `ignore` solo afecta a las plantas gestionadas y que el registro de la sesión (id, carpeta, título) se conserva. Las dos claves `hub.*` tienen además que entrar en el mapa `HubTextParams` de `hub/src/types.ts:8-197`, que es lo que tipa `HubText`: `'hub.settings.badPrivacyMode': undefined` junto a `'hub.settings.badPermissionMode'` (`148`) y `'hub.api.sessionNotOffice': undefined` junto a `'hub.api.sessionNotFound'` (`158`); sin ellas, empujar `{ key: 'hub.settings.badPrivacyMode' }` en `errors: HubText[]` (`hub/src/settings.ts:69`) no compila, y `ui/src/i18n/hub.ts:6` exige que toda `HubTextKey` esté en `MessageKey`, de ahí la paridad con los diccionarios. `ui/test/i18n.test.ts:40-47` exige las mismas claves en ambos idiomas y `56-59` que ningún texto sea idéntico en los dos salvo los listados en `SAME_KEYS`; `124-135` prohíbe literales con tilde fuera de `i18n/`.

### M9: órdenes solo a sesiones de la oficina

- `OrderResult` (`hub/src/office.ts:154`) gana `'not-office'`. En `order()` (`619-644`), tras el `not-found` (`621`) y antes del `unreachable` (`622`): `if (!this.sessionInOffice(session)) return 'not-office';`. Va antes de mirar el socket para que la respuesta no dependa de si el socket existe.
- `/api/orders` (`hub/src/server.ts:108-118`): `if (result === 'not-office') return c.json({ error: { key: 'hub.api.sessionNotOffice' } }, 403);` antes del 502 genérico. El panel ya convierte las claves `hub.api.*` en texto por `readError` (`ui/src/api.ts:25-30,146`), así que no hace falta tocar el mapa `fixed` de `order` (`60-65`).
- `SessionView` (`hub/src/types.ts:390-398`) gana `office: boolean`, calculado en `sessionView` (`hub/src/office.ts:1645-1655`) con `this.sessionInOffice(session)`. Es derivado, no se guarda. Añadir el campo no rompe `cd ui && bun run typecheck`: ningún código de la UI construye un `SessionView` (`ui/src/store.ts:64` solo los guarda; `ui/src/panel/orders.ts` solo los lee).
- Selector: el filtro de `eligible` (`ui/src/panel/orders.ts:45-46`) y la preselección del bloqueado (`99`) pasan a exigir `session.office`. Para poder probarlo sin DOM (`ui/src/dom.ts:15` usa `document` al crear nodos), el filtro se extrae a un módulo puro nuevo `ui/src/panel/orderable.ts`:

```ts
import type { SessionView } from '../types';
export function orderable(session: SessionView): boolean {
  return session.office && session.canReceive && session.endedAt === null;
}
export function orderableSessions(sessions: Iterable<SessionView>): SessionView[] {
  return [...sessions].filter(orderable);
}
```

  y `orders.ts` lo usa en `45-46` y `99`. Grabaciones `?replay=` anteriores a este cambio no traen `office` y sus sesiones no saldrán en el selector; en reproducción las órdenes están deshabilitadas de todos modos (`actions.ordersEnabled`), así que no se pierde nada.

### Tests (M24: antes del cambio, misma rama)

Todos nuevos salvo la adaptación indicada. Fallan en `7c89614` y pasan con la corrección.

1. `hub/test/office.test.ts`, `describe('privacy by floor kind')` (`52-71`), con los ayudantes `managedRepo` (`20-25`), `ev` (`hub/test/helpers.ts:93-95`) y `agent` (`18`):

```ts
test('a personal session in a managed floor is observed: no payload, no task, no report', () => {
  h = harness();
  const repo = managedRepo();
  h.office.ingest(ev('me-1', repo, 'SessionStart', { source: 'startup' }));
  h.office.ingest(ev('me-1', repo, 'UserPromptSubmit', { prompt: 'Arregla el pago con la clave secreta' }));
  h.office.ingest(ev('me-1', repo, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'cat secreto.txt' } }));
  expect(agent('me-1')?.task).toBeNull();
  expect(agent('me-1')?.detail).toBe('Bash');
  h.office.ingest(ev('me-1', repo, 'Stop', { last_assistant_message: 'Pago arreglado con la clave secreta' }));
  h.office.ingest(ev('me-1', repo, 'SessionEnd', { reason: 'other' }));
  const payloads = h.db.query<{ payload: string | null }, []>('SELECT payload FROM events').all();
  expect(payloads).toHaveLength(5);
  expect(payloads.every((row) => row.payload === null)).toBe(true);
  expect(h.office.report('me-1')).toBeNull();
  expect(h.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM reports').get()?.n).toBe(0);
  expect(JSON.stringify(h.messages)).not.toContain('secret');
  expect(h.office.snapshot().sessions.find((s) => s.sessionId === 'me-1')?.office).toBe(false);
});

test('with managedPersonalSessions = ignore the personal session leaves no agent and no event, also after a restart', () => {
  h = harness({ configure: (config) => { config.privacy.managedPersonalSessions = 'ignore'; } });
  const repo = managedRepo();
  const socket = join(h.root, 'me.sock');
  writeFileSync(socket, '');
  h.office.ingest(ev('me-2', repo, 'SessionStart', { source: 'startup', session_title: 'Arregla el pago' }), { socket, token: null, role: null, name: null });
  h.office.ingest(ev('me-2', repo, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'cat secreto.txt' } }));
  expect(agent('me-2')).toBeUndefined();
  expect(h.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM events').get()?.n).toBe(0);
  expect(h.office.snapshot().sessions.find((s) => s.sessionId === 'me-2')?.office).toBe(false);
  h.office.ingest(ev(LEAD, repo, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'flutter analyze' } }), leadMeta);
  expect(agent(LEAD)?.state).toBe('checking');
  const restarted = new Office({
    db: h.db,
    config: h.config,
    profiles: loadProfiles(PROFILES_DIR),
    workspaceDir: h.workspace,
    claudeHome: join(h.root, 'claude-home'),
    gitRoot: (cwd) => cwd,
    now: () => h.clock.now,
  });
  expect(restarted.snapshot().agents.find((a) => a.key === 'me-2')).toBeUndefined();
  expect(restarted.snapshot().sessions.find((s) => s.sessionId === 'me-2')).toMatchObject({ office: false, endedAt: null });
});
```

   El socket es necesario para que `restoreSessions` reponga la fila (`1689`); el título de sesión muestra que, aun guardado en `sessions.name`, no reaparece como agente. En el commit base falla en `agent('me-2')` (se crea) y tras el reinicio (el agente se repone).

   En el commit base el primero falla en `task` (hoy muestra «Arregla el pago…»), en `payload` (guardado), en `report` (se construye) y en `reports` (fila tras el `Stop` por `ingest:455` y tras el `SessionEnd` por `endSession:1582`; la aserción de 0 filas cubre los dos caminos); el segundo falla porque `config.privacy` no existe y porque el agente se crea.

   Tercer test del mismo bloque, para la decisión (a) de Diseño (el jefe reconocido solo por `agent_type` es de la oficina desde su primer evento y tras reiniciar el hub de verdad). `hub/tsconfig.json:13` incluye `test`, así que el `filter` lleva predicado de tipo: sin él `emitted` sería `ServerMessage | undefined` y `.data` no existe en `agent-gone`, `question-closed` ni `memory` (`hub/src/types.ts:554-568`). Importa `type { ServerMessage }` de `../src/types` y reutiliza el patrón de segundo `Office` de `office.test.ts:522-530`:

```ts
test('a lead identified only by agent_type is an office session from its first event and after a restart', () => {
  h = harness();
  const repo = managedRepo();
  const socket = join(h.root, 'lead.sock');
  writeFileSync(socket, '');
  h.office.ingest(ev(LEAD, repo, 'SessionStart', { source: 'startup', agent_type: 'office-lead-mobile' }), { socket, token: null, role: null, name: null });
  const emitted = h.messages
    .filter((m): m is Extract<ServerMessage, { type: 'session' }> => m.type === 'session' && m.data.sessionId === LEAD)
    .at(-1);
  expect(emitted?.data.office).toBe(true);
  h.office.ingest(ev(LEAD, repo, 'PreToolUse', { agent_id: 'dev-1', agent_type: 'office-dev-mobile', tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'flutter analyze' } }));
  expect(h.db.query<{ payload: string | null }, []>('SELECT payload FROM events ORDER BY id DESC LIMIT 1').get()?.payload).toContain('flutter analyze');
  const restarted = new Office({
    db: h.db,
    config: h.config,
    profiles: loadProfiles(PROFILES_DIR),
    workspaceDir: h.workspace,
    claudeHome: join(h.root, 'claude-home'),
    gitRoot: (cwd) => cwd,
    now: () => h.clock.now,
  });
  expect(restarted.snapshot().sessions.find((s) => s.sessionId === LEAD)).toMatchObject({ role: 'office-lead-mobile', office: true });
});
```

   En el commit base falla en `office` (el campo no existe) y, tras el reinicio, en `role` (nulo: hoy `sessions.role` solo lo rellena la cabecera y `restoreSessions` lo repone desde ahí, `1700,1731`). El socket tiene que existir porque `restoreSessions` descarta las filas sin socket (`1689`).

   Adaptación, no debilitamiento: el test `a managed floor keeps the full event` (`63-70`) ingiere `man-1` sin meta; documenta que una planta gestionada guarda el evento completo, y eso sigue siendo cierto **para una sesión de la oficina**, así que pasa a ingerir con `leadMeta` (`13`) y se renombra `a managed floor keeps the full event of an office session`. Pasa igual en el commit base.

2. `hub/test/office.test.ts`, `describe('orders from the panel')` (`343-381`):

```ts
test('a session outside the office is refused before delivery', async () => {
  const sent: string[] = [];
  h = harness({ deliverFn: async (socket) => { sent.push(socket); } });
  const repo = managedRepo();
  const socket = join(h.root, 'me.sock');
  writeFileSync(socket, '');
  h.office.ingest(ev('me-3', repo, 'SessionStart', {}), { socket, token: 'tok-3', role: null, name: null });
  expect(h.office.snapshot().sessions.find((s) => s.sessionId === 'me-3')).toMatchObject({ canReceive: true, office: false });
  expect(await h.office.order('me-3', 'hola')).toBe('not-office');
  expect(sent).toEqual([]);
});
```

3. `hub/test/server-v2.test.ts` (criterio del brief): el `harness` del `describe` (`22-26`) añade `deliverFn: async () => {}` para que la orden aceptada responda 200 en vez de fallar contra un socket falso; ningún test del fichero entrega órdenes hoy. Nuevo test, con `call` (`55-56`) y `headers` (`54`):

```ts
test('orders reach only sessions of the office', async () => {
  const personal = join(h.root, 'personal');
  mkdirSync(personal, { recursive: true });
  const socket = join(h.root, 'me.sock');
  writeFileSync(socket, '');
  const start = (sessionId: string, cwd: string, extra: Record<string, string> = {}) =>
    fetch(`${base}/events`, {
      method: 'POST',
      headers: { ...headers, 'X-Office-Socket': socket, 'X-Office-Token': 'tok', ...extra },
      body: JSON.stringify({ session_id: sessionId, cwd, hook_event_name: 'SessionStart', source: 'startup' }),
    });
  await start('me-1', personal);
  const refused = await call('POST', '/api/orders', { sessionId: 'me-1', text: 'hola' });
  expect(refused.status).toBe(403);
  expect(await refused.json()).toEqual({ error: { key: 'hub.api.sessionNotOffice' } });
  await start('me-2', repo);
  expect((await call('POST', '/api/orders', { sessionId: 'me-2', text: 'hola' })).status).toBe(403);
  await start('lead-2', repo, { 'X-Office-Role': 'office-lead-mobile', 'X-Office-Name': 'lead-mobile' });
  expect((await call('POST', '/api/orders', { sessionId: 'lead-2', text: 'hola' })).status).toBe(200);
});
```

   `me-1` está en planta observada (carpeta fuera de `config.floors`, `hub/src/floors.ts:92-112`), `me-2` en la gestionada sin rol. En el commit base ambas órdenes se entregan (200 con el `deliverFn` nuevo; 502 sin él): el test falla.

4. `hub/test/settings.test.ts`, con el patrón de `leaveAfterMinutes` (`38-51`):

```ts
test('privacy.managedPersonalSessions is observe by default, accepts ignore and rejects the rest', () => {
  const config = testConfig();
  expect(config.privacy).toEqual({ managedPersonalSessions: 'observe' });
  expect(settingsView(config).privacy).toEqual({ managedPersonalSessions: 'observe' });
  const result = applySettings(config, { privacy: { managedPersonalSessions: 'ignore' } });
  if ('error' in result) throw new Error(JSON.stringify(result.error));
  expect(result.config.privacy.managedPersonalSessions).toBe('ignore');
  expect(config.privacy.managedPersonalSessions).toBe('observe');
  const rejected = applySettings(config, { privacy: { managedPersonalSessions: 'hide' } });
  expect('error' in rejected ? rejected.error : []).toEqual([{ key: 'hub.settings.badPrivacyMode' }]);
  expect(normalizeConfig({ privacy: { managedPersonalSessions: 'hide' } }).privacy.managedPersonalSessions).toBe('observe');
  expect(normalizeConfig({ privacy: { managedPersonalSessions: 'ignore' } }).privacy.managedPersonalSessions).toBe('ignore');
});
```

5. `ui/test/orderable.test.ts` (nuevo; `cd ui && bun test` lo recoge como a `ui/test/notify.test.ts`):

```ts
import { describe, expect, test } from 'bun:test';
import { orderableSessions } from '../src/panel/orderable';
import type { SessionView } from '../src/types';

describe('orderable sessions', () => {
  test('only live, reachable sessions of the office receive orders', () => {
    const base = { agentKey: 'x', name: null, role: null, floor: 'mobile' };
    const sessions: SessionView[] = [
      { ...base, sessionId: 'a', canReceive: true, endedAt: null, office: true },
      { ...base, sessionId: 'b', canReceive: true, endedAt: null, office: false },
      { ...base, sessionId: 'c', canReceive: false, endedAt: null, office: true },
      { ...base, sessionId: 'd', canReceive: true, endedAt: 1, office: true },
    ];
    expect(orderableSessions(sessions).map((s) => s.sessionId)).toEqual(['a']);
  });
});
```

   En el commit base falla porque el módulo no existe.

Mientras los tests están escritos y la corrección no, `cd hub && bun run typecheck` falla en `config.privacy` y `s.office`: es el estado intermedio esperado de M24; lo que tiene que estar en verde es el final de la rama.

### README

- `README.md:151` (sección «Privacidad», `149-151`), texto nuevo: «En plantas observadas, y en tus sesiones que no son de la oficina dentro de una planta gestionada (sin rol `office-*` y sin un jefe de la oficina en su equipo), el hub guarda solo estado, herramienta, ruta, el título de la sesión y el asunto de las tareas; no guarda el contenido de las herramientas, los prompts ni los mensajes, y no hay informe ni memoria. Con `privacy.managedPersonalSessions: "ignore"` (Ajustes → Privacidad) tus sesiones personales en plantas gestionadas no crean agente ni eventos, tampoco al reiniciar el hub: solo queda el registro de la sesión (id, carpeta y título). En Dirección y los departamentos se siguen tratando como observadas. Los eventos se borran a los 14 días (`retentionDays` en `config.json`). Las lecciones, los informes y los veredictos de los documentos se conservan: desde el esquema v2 las migraciones de la base de datos solo añaden tablas o columnas.»
- `README.md:187`: «**Preguntas de permisos.** El plan dejaba como opcional retener también `PermissionRequest`; está hecho, ver la entrada «Permisos» de la lista de arriba.» Desaparece «no está hecho» y no se cita ningún número de línea del propio fichero.
- `README.md:120` («Órdenes»): se añade «Solo llegan a sesiones de la oficina; las tuyas no salen en el selector.» Es la frase que documenta M9; está fuera de las dos líneas del brief pero es el mismo cambio de comportamiento.

### Ficheros y carpetas que toca

| Carpeta | Fichero | Qué |
|---|---|---|
| `hub/src/` | `office.ts` | `sessionInOffice` (sustituye `inScope`, `1503-1511`), `privacyKind`/`privacyKindOf`, `touchSession` (rol desde `agent_type`, entre `1264` y `1280`), `touchAgent` (re-emisión de la sesión tras `1358`), `restoreSessions` (`1687-1741`, sin agente para las ignoradas), `ignored`, `ingest` (`366-380,412-455`), `storeReport` (`923-926`, misma firma; llamadores `455`, `1126`, `1582` sin cambios), `report` (`678-682`), `decidePlan` (`713-715`), `ingestRetired` (`1145-1146`), `applySpawn` (`1386`), `recordMessage` (`1410`), `fileLabel` (`1445`), `order` (`619-644`), `OrderResult` (`154`), `sessionView` (`1645-1655`), import de `visibleKind` (`26`). |
| `hub/src/` | `privacy.ts` | `visibleKind` (añadido; nada más cambia). |
| `hub/src/` | `types.ts` | `PrivacyMode`, `PrivacyConfig`, `OfficeConfig.privacy`, `SettingsView.privacy`, `SettingsUpdate.privacy`, `SessionView.office`; en `HubTextParams` las entradas `'hub.settings.badPrivacyMode': undefined` (junto a `148`) y `'hub.api.sessionNotOffice': undefined` (junto a `158`). |
| `hub/src/` | `config.ts` | `PRIVACY_MODES`, `validPrivacyMode`, `DEFAULT_CONFIG.privacy`, `normalizeConfig`. |
| `hub/src/` | `settings.ts` | `settingsView`, `applySettings`. |
| `hub/src/` | `server.ts` | 403 `hub.api.sessionNotOffice` en `/api/orders` (`108-118`). |
| `hub/test/` | `office.test.ts`, `server-v2.test.ts`, `settings.test.ts` | Tests de arriba y la adaptación de `office.test.ts:63-70`. |
| `ui/src/panel/` | `orders.ts`, `orderable.ts` (nuevo) | Filtro por `office`. |
| `ui/src/settings/` | `options.ts`, `draft.ts`, `settings.ts` | Selector de privacidad. |
| `ui/src/i18n/` | `es.ts`, `en.ts` | Las nueve claves listadas. |
| `ui/test/` | `orderable.test.ts` (nuevo) | Test del filtro. |
| raíz | `README.md` | Líneas 120, 151 y 187. |

No se tocan: `plugin/`, `docs/`, `hub/src/db.ts` (sin esquema nuevo), `hub/src/prune.ts`, `hub/src/reports.ts`, `hub/src/scope.ts`, `hub/src/state-machine.ts`, `hub/src/gate.ts`, `hub/src/guard.ts`.

### Convivencia con otros planes

La auditoría (Paso 3) secuencia los encargos que tocan `hub/src/office.ts`: M1 (+M2), M3+M9 (este), M13, M14, M31. Lo que declaran los otros dos planes, a fecha de esta ronda:

- `redaccion/planes/puerta-tests-cambios-reales.md` (M1+M2), tabla de su sección «5. Convivencia»: en `office.ts` toca los campos `changes: GuardWatch` y `pendingWrites` junto a `watch` (`309-321`), `ingest` «junto a `:429`» (candidatas en `PreToolUse` de Bash y cambios en `PostToolUse`/`PostToolUseFailure`), `trackChanges` junto a `trackDepartment` (`453`, `899-910`), `recordBashChanges`, `ownerEdits` en lugar de `lastEdit` (`1560-1567`), `gate` (`540-546`) y `gateMessage` (`575-581`); y dice expresamente «Nada en `handleProtocol`, `privacy`, `order` ni `prepare`». Fuera del hub toca `state-machine.ts`, `profiles.ts`, `guard.ts`, `gate.ts`, `plugin/profiles/generic.json`, `README.md:121` y tests: en `office.test.ts` un bloque nuevo `test gate on real changes` y sube `team()` (`147-160`), `done()` y `teamWithEdit()` (`449-465`) al ámbito del módulo; `units.test.ts`, `guard.test.ts`, `state-machine.test.ts`. Su sección de riesgos pide que los otros planes «se ejecuten después y rebasen sobre esta rama».
- `redaccion/planes/tope-rondas-oficina.md` (M13), su tabla de ficheros: en `office.ts` toca el import de `decideReviewGate` (`22`), la opción `maxRounds` del `DocumentDesk` (`300-308`), `gateMessage` (`563-592`) con un `gateReview` nuevo y `handleProtocol` (`1057-1070` y `1085`); además `documents.ts`, `gate.ts`, `state-machine.ts` y `departments.test.ts`.

Este plan toca `ingest` en `366-380` y `412-455`, `order` (`619-644`), `report` (`678-682`), `decidePlan` (`713-715`), `storeReport` (`923-926`), `ingestRetired` (`1145-1146`), `touchSession` (`1264-1280`), `touchAgent` (`1358`), `applySpawn` (`1386`), `recordMessage` (`1410`), `fileLabel` (`1445`), `inScope` (`1503-1511`), `sessionView` (`1645-1655`) y `restoreSessions` (`1687-1741`), y no toca `gate`, `gateMessage`, `handleProtocol`, `trackDepartment`, `lastEdit` ni `prepare`. Solapes:

- Con M1+M2: dentro de `ingest`, porque ambos editan el tramo `412-455` (este plan cambia `kind` en `429,432,447,452,455`; aquel inserta las escrituras por Bash junto a `429` y añade `trackChanges` junto a `453`). Es un conflicto textual de líneas vecinas, no de lógica: al rebasar se conserva `publicText(c.edit, kind)` con el `kind` efectivo y las escrituras por Bash nuevas usan el mismo `kind`. En `hub/test/office.test.ts` los dos añaden bloques distintos (aquel un `describe` nuevo y mueve `team()`/`done()`/`teamWithEdit()` al ámbito del módulo; este tres tests en `privacy by floor kind` y uno en `orders from the panel`): sin solape de líneas, salvo que el movimiento de `team()` desplace los números citados aquí. En `README.md` aquel toca la línea 121 y este la 120: líneas contiguas, sin conflicto de contenido.
- Con M13: ninguno en `office.ts` (zonas disjuntas); los dos tocan `ui/src/i18n/es.ts`/`en.ts` si M13 añade claves, lo que se resuelve añadiendo ambas.

Orden: en serie, cada uno sobre la rama que deje el anterior, M1+M2 → M3+M9 → M13 como sugiere la auditoría. Si este plan se ejecutara antes que M1+M2, el rebase es el mismo tramo de `ingest` y se resuelve igual.

## Pasos

Todos en `~/Projects/agent-office-dev`, en una rama nueva desde `build/v1 @ 7c89614`. Los tests de los pasos 2-5 van antes que el código de los pasos 6-9 (M24).

1. `git checkout -b feat/privacidad-ordenes-oficina 7c89614`. Verificable: `git log -1 --format=%h` da `7c89614`.
2. Tests M3 en `hub/test/office.test.ts`: los tres de «Tests» 1 más la adaptación de `63-70` (`leadMeta`). Verificable: `cd hub && bun test test/office.test.ts` falla exactamente en los tres nuevos; el adaptado pasa.
3. Tests M9: «Tests» 2 en `office.test.ts` y «Tests» 3 en `server-v2.test.ts` (incluido el `deliverFn` del harness). Verificable: `cd hub && bun test test/office.test.ts test/server-v2.test.ts` falla en ambos nuevos: el de `office.test.ts` en `toMatchObject({ canReceive: true, office: false })` (el campo `office` no existe aún) y el de `server-v2` con 200 en vez de 403.
4. Test del ajuste («Tests» 4) en `hub/test/settings.test.ts`. Verificable: falla en `config.privacy`.
5. Test de UI («Tests» 5) en `ui/test/orderable.test.ts`. Verificable: `cd ui && bun test test/orderable.test.ts` falla por módulo inexistente. Commit de los pasos 2-5 (solo tests): `test: M3+M9 fallan en el commit base`. A partir de aquí la corrección queda **sin commitear hasta el paso 11**, para que la prueba de `git stash` tenga algo que apartar.
6. Configuración: `types.ts` (`PrivacyMode`, `PrivacyConfig`, `OfficeConfig.privacy`, `SettingsView.privacy`, `SettingsUpdate.privacy`, y en `HubTextParams` `'hub.settings.badPrivacyMode': undefined` y `'hub.api.sessionNotOffice': undefined`), `config.ts` (`PRIVACY_MODES`, `validPrivacyMode`, `DEFAULT_CONFIG.privacy`, `normalizeConfig`), `settings.ts` (`settingsView`, `applySettings` con `hub.settings.badPrivacyMode`) y las claves `hub.settings.badPrivacyMode` y `hub.api.sessionNotOffice` en `ui/src/i18n/es.ts` y `en.ts`. Verificable: `cd hub && bun test test/settings.test.ts` en verde; `cd ui && bun test test/i18n.test.ts` en verde (paridad de claves, textos distintos).
7. Hub: `visibleKind` en `privacy.ts`; en `office.ts` el rol desde `agent_type` en `touchSession`, la re-emisión de la sesión en `touchAgent`, `sessionInOffice`, `privacyKind`, `privacyKindOf`, los cambios de la tabla de Diseño en `ingest` (incluido el `endSession` del modo `ignore`), la comprobación de sesión dentro de `storeReport`, `report`, `ingestRetired`, `applySpawn`, `recordMessage`, `fileLabel`, el modo `ignore`, `'not-office'` en `OrderResult`, `order` y `decidePlan`, `office` en `sessionView`; `SessionView.office` en `types.ts`; el 403 en `server.ts`. Verificable: `cd hub && bun test` en verde, incluidos los tests de los pasos 2-4; `cd hub && bun run typecheck` en verde; `cd ui && bun run typecheck` sigue en verde (la UI solo lee `SessionView`/`SettingsView`).
8. Si en el paso 7 falla algún test que ingiere en planta gestionada sin rol y afirma sobre texto, la corrección es darle su rol (`leadMeta` o `agent_type`), nunca relajar la aserción: la sesión que representa es de la oficina. Candidatos revisados en la foto: `office.test.ts:63-70` (ya adaptado en el paso 2); `texts.test.ts:193` pasa `leadMeta` a los eventos de `LEAD`, pero los de `session-basic.json` (`texts.test.ts:151`) entran en `mobile` sin meta ni `agent_type` y pasarán a ser privados (resumen `${tool} ${basename}` y detalle con la herramienta): el test comprueba que no haya español, así que debe seguir pasando, y si no, se le da rol a esa sesión; `floor-admin.test.ts:140-142` (`MOBILE_SESSION` sin rol, con `SendMessage` y `SessionEnd`) afirma `messages.some(floor === 'mobile')` y filas > 0, que aguantan porque `recordMessage` sigue insertando la fila con cuerpo nulo; `server.test.ts:70` ya envía `X-Office-Role`; `departments.test.ts:315,371,610` ya usan `leadMeta`; `team-sandbox.json` lleva `agent_type` de la oficina. Verificable: los tests tocados se listan en el mensaje del commit del paso 11, cada uno con el rol añadido.
9. UI: `ui/src/panel/orderable.ts` y su uso en `orders.ts:45-46,99`; `PRIVACY_MODE_OPTIONS` en `options.ts`; `privacy` en `draft.ts` (`SettingsDraft`, `draftFrom`, `reconcileDraft`, `diffDraft`, `applyUpdate`); sección Privacidad y `select` en `settings.ts` (`buildControls`, `Controls`, `syncControls`); las siete claves `settings.*` restantes en `es.ts`/`en.ts`. Verificable: `cd ui && bun test && bun run typecheck` en verde; en el panel (paso 11) la sección aparece con «Observar» seleccionado y cambiarla a «Ignorar» habilita Guardar y persiste `privacy.managedPersonalSessions: "ignore"` en el `config.json` temporal.
10. `README.md:120,151,187` como en Diseño. Verificable: `grep -n "no está hecho" README.md` vacío; `sed -n '149,151p' README.md` menciona las sesiones que no son de la oficina y `privacy.managedPersonalSessions`.
11. Comprobación M24 y cierre: `bun run test` y `bun run typecheck` desde la raíz en verde; después, con la corrección todavía sin commitear, la prueba de `git stash` de Verificación (los tests nuevos fallan sin la corrección y vuelven a pasar con ella); solo entonces el commit de la corrección (`feat: privacidad y órdenes por pertenencia a la oficina (M3+M9)`). El tester de la planta ejecuta `bun run test` y `bun run typecheck` y da el verde; el jefe entrega con `HECHO:` solo entonces.

## Riesgos

- **Una sesión de la oficina sin rol conocido se trataría como personal.** El rol llega en cada evento por `X-Office-Role` (lanzadores, `plugin/hooks/emit.sh:19`) o por `agent_type` en la sesión principal (`claude --agent office-…`), y con la decisión (a) ambos acaban en `sessions.role`, así que la vista se emite bien desde el primer evento y sobrevive al reinicio. Si faltan los dos, el jefe se vería como observado: sin encargo, sin informe y fuera del selector de órdenes. Es el mismo criterio con que hoy ya se deciden preguntas, permisos y memoria (`inScope`, `injection`), así que no introduce un caso nuevo; en el panel una sesión de jefe sin «encargo» se nota de inmediato.
- **`office` en el selector puede ir con retraso en un caso.** La vista de sesión se emite cuando cambia la sesión (`touchSession`) o cuando `touchAgent` fija el rol del agente principal (re-emisión añadida). Si la pertenencia cambia sin ninguna de las dos cosas (un compañero con sesión propia, modo tmux, cuyo jefe se identifica después), el selector no la muestra hasta el siguiente cambio de esa sesión o la siguiente instantánea al recargar. `order()` recalcula la pertenencia en el momento, así que el panel puede ocultar de más, nunca entregar de más.
- **Lo que sigue guardándose de una sesión personal.** Título de la sesión, asunto de las tareas y sus filas en `tasks`/`gate_decisions`, igual que hoy en las observadas (ver Diseño). El README lo dice; cambiarlo afectaría a las observadas y queda fuera.
- **Tests existentes que suponían «gestionada = todo visible».** Identificado y adaptado `office.test.ts:63-70`; el paso 8 fija cómo tratar cualquier otro que aparezca.
- **Las filas de `reports` de sesiones personales ya guardadas no se borran.** Este plan evita que se creen más; las anteriores quedan hasta que alguien las borre (ver Preguntas abiertas).
- **El usuario que quería observar su propio trabajo pierde detalle.** Es la decisión del brief: solo estado y rutas, como en observadas. Si quiere detalle, puede abrir esa sesión con un rol de la oficina (lanzador del jefe) o esperar a un ajuste por planta (fuera de este plan).
- **Modo `ignore` deja la fila de `sessions`.** Sin rol, solo id, `cwd`, planta, socket y título; la poda la limpia como a las demás. Se documenta en el README y en la ayuda del ajuste.
- **Modo `ignore` no corta `gate()`.** `gate()` (`hub/src/office.ts:529-561`) no pasa por `ingest`: llama a `touchSession`, escribe `tasks` y `gate_decisions` y hace `pushActivity` con el asunto de la tarea también para una sesión personal. En la práctica no ocurre, porque `TaskCompleted` no llega en Claude Code 2.1.292 (`README.md:184`); si volviera, habría que aplicar ahí la misma salida temprana. «No hay actividad» en el Diseño se refiere a `ingest`.
- **`AGENT_OFFICE_RAW=1` sigue volcando el evento crudo.** `dumpRaw` (`hub/src/office.ts:369,1743-1749`) escribe el evento completo en `hub/test/fixtures/raw/` antes de cualquier decisión de privacidad, también en `ignore`. Es una opción de desarrollo que no está activa en la oficina real; se deja como está.
- **Grabaciones `?replay=` antiguas.** Sus sesiones no traen `office` y no salen en el selector; en reproducción las órdenes están deshabilitadas, así que no cambia nada visible.
- **Convivencia con M1 en `ingest`.** Solape textual probable alrededor de `hub/src/office.ts:429`; se resuelve en serie como dice la auditoría.
- **`git stash` para M24.** Solo aparta cambios sin commitear: si la corrección ya está en un commit, imprime «No local changes to save» y la comprobación no vale. Por eso los pasos 5 y 11 fijan que los tests se commitean primero y la corrección después de la prueba. `orderable.ts` es nuevo, de ahí `git stash push -u` con pathspec para que el fichero nuevo también se aparte y los tests queden en el árbol.

## Verificación

Desde `~/Projects/agent-office-dev`, en la rama del encargo:

- Suite completa: `bun run test` (`package.json:15`: hub y ui) y `bun run typecheck` (`package.json:16`) en verde.
- Tests del encargo por separado: `cd hub && bun test test/office.test.ts test/server-v2.test.ts test/settings.test.ts` y `cd ui && bun test test/orderable.test.ts test/i18n.test.ts`.
- Regla M24 (falla sin la corrección, pasa con ella), con los tests ya commiteados (paso 5) y la corrección aún sin commitear (paso 11); `git status --short` debe listar los ficheros de `hub/src`, `ui/src` y `README.md` antes de empezar:

```sh
git stash push -u -m m3m9 -- hub/src ui/src README.md   # si dice "No local changes to save", la corrección ya está commiteada: repetir desde un `git reset --soft HEAD~1`
(cd hub && bun test test/office.test.ts test/server-v2.test.ts test/settings.test.ts) ; echo "hub sin corrección: exit $?"   # debe fallar
(cd ui && bun test test/orderable.test.ts) ; echo "ui sin corrección: exit $?"                                                # debe fallar
git stash pop
(cd hub && bun test) && (cd ui && bun test) && echo "con corrección: verde"
```

- Criterios del brief, uno a uno: payload NULL, `task` nulo, `/api/reports` 404 y 0 filas en `reports` → primer test de «Tests» 1; jefe por `agent_type` con `office: true` en la vista emitida y rol persistido → tercer test de «Tests» 1; 403 en `/api/orders` a sesión del usuario en planta observada → test «Tests» 3 (`me-1`); README → `grep -n "no está hecho" README.md` vacío y `sed -n '120p;149,151p;187p' README.md`.
- Comprobación visual opcional del panel (no sustituye a los tests), con un hub de pruebas que **nunca** use la configuración real. `hub/src/main.ts:35-39` sale con «No hay key» si falta el fichero `key`, así que hay que crearlo a mano; la planta tiene que estar en `floors` (con `floors: {}` el `cwd` sería una planta observada y la sesión no saldría en el selector ni antes del cambio); y la sesión necesita un socket que exista para que `canReceive` sea verdadero (`hub/src/office.ts:1652`):

```sh
cd ~/Projects/agent-office-dev
TMP=$(mktemp -d); mkdir -p $TMP/home $TMP/claude $TMP/docs; git -C $TMP/docs init -q
openssl rand -hex 32 > $TMP/home/key && chmod 600 $TMP/home/key
touch $TMP/me.sock
cat > $TMP/home/config.json <<EOF
{"docsRepo": "$TMP/docs", "departments": {"redaccion": false, "mantenimiento": false}, "port": 4799,
 "floors": {"dev": {"path": "$PWD", "stack": "node", "managed": true, "baseBranch": "build/v1"}}}
EOF
bun run build
AGENT_OFFICE_HOME=$TMP/home AGENT_OFFICE_CLAUDE_HOME=$TMP/claude bun hub/src/main.ts &
K="X-Office-Key: $(cat $TMP/home/key)"
# sesión personal con socket en la planta gestionada: no debe salir en el selector de órdenes
curl -s -X POST -H "$K" -H "X-Office-Socket: $TMP/me.sock" -H 'Content-Type: application/json' \
  -d '{"session_id":"me","cwd":"'$PWD'","hook_event_name":"SessionStart","source":"startup"}' http://127.0.0.1:4799/events
curl -s -X POST -H "$K" -H 'Content-Type: application/json' -d '{"sessionId":"me","text":"hola"}' http://127.0.0.1:4799/api/orders   # 403 sessionNotOffice
# la misma sesión con rol de la oficina sí sale y acepta la orden (fallará al entregar: el socket es un fichero vacío → 502)
curl -s -X POST -H "$K" -H "X-Office-Role: office-lead-dev" -H "X-Office-Socket: $TMP/me.sock" -H 'Content-Type: application/json' \
  -d '{"session_id":"lead","cwd":"'$PWD'","hook_event_name":"SessionStart","source":"startup"}' http://127.0.0.1:4799/events
```

  Abrir `http://127.0.0.1:4799`: en Órdenes aparece `lead · dev` y no `me`; en Ajustes aparece la sección Privacidad con «Observar» y, al cambiar a «Ignorar» y guardar, `$TMP/home/config.json` contiene `"managedPersonalSessions": "ignore"`. El `docsRepo` temporal es obligatorio: sin él `sync.cleanup` apuntaría a `~/Projects/office-docs`. Al terminar, parar el hub (`kill %1`) y borrar `$TMP`.

## Preguntas abiertas

- ¿Se quiere borrar de una vez las filas de `reports` que las sesiones personales dejaron antes de este cambio? Un `DELETE FROM reports WHERE role_id IS NULL` al arrancar las quitaría, pero también los informes de subagentes genéricos (`roleId` nulo, `roleKind` `intern`) lanzados desde sesiones de la oficina, que `savedReports` no muestra en memoria pero `/api/reports/:agentKey` sí. Propuesta: dejarlo para la mejora que añada poda a `reports`, y mientras tanto el usuario puede ejecutar esa sentencia a mano si le molesta.
- ¿Conviene un ajuste por planta (`privacy.floors.<slug>`) además del global? Fuera de este plan; el esquema de `permissionModes` serviría de modelo.
