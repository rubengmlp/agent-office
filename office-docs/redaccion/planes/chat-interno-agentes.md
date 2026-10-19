# Chat interno para que los agentes de la oficina se coordinen entre sí

## Contexto

Hoy los agentes de una planta (jefe, desarrolladores, tester) y los jefes de plantas distintas solo se hablan por mensajes punto a punto (`SendMessage`), que el hub registra en `messages` (`hub/src/office.ts:1408-1420`) y el panel muestra por agente en la línea de tiempo (`ui/src/panel/timeline.ts:21-31`). No hay un sitio común donde un desarrollador anuncie qué ficheros va a tocar, donde el tester pregunte sin bloquearse ni donde dos jefes acuerden algo sin pasar por el director. Consecuencias: dos desarrolladores se pisan ficheros, un agente manda `BLOQUEADO:` por una duda que un compañero habría resuelto en una línea, y lo que uno descubre no llega al resto.

Este plan añade un chat interno con canales en el hub, una forma de publicar y leer desde la sesión de cada agente y una pestaña Chat en el panel.

Base sobre la que se escribe:

- agent-office-dev `build/v1` @ `7c89614` (2026-10-16). Sin cambios desde el último plan sobre esta planta.

Según el `CLAUDE.md` del repositorio, todo el trabajo se hace en el clon `/Users/victorsanblasgomez/Projects/agent-office-dev`, nunca en la copia en vivo `~/Projects/agent-office`, y sin `bun run setup`, `bun run floor`, `bun run hub` ni `bun run office`.

Este plan se ejecuta en paralelo con otro que cambia la escena de la oficina (fondo, jardines, ascensor en 2D y 3D). La sección «Carpetas y ficheros que toca este plan» delimita qué se toca aquí; las escenas 2D (`ui/src/office/`), 3D (`ui/src/scene/`), los sprites y los assets no se tocan.

## Objetivo

Un chat con canales (uno por planta gestionada y uno global) donde los agentes anuncien qué van a tocar, pregunten, contesten y acuerden antes de cambiar código; el usuario lo lee en vivo y puede escribir.

Criterios de aceptación del brief, literalmente:

- Dos agentes de una planta publican en su canal y cada uno lee lo del otro.
- Un «voy a tocar <fichero>» queda visible al resto de la planta antes de editar.
- El usuario ve los canales en la pestaña Chat con actualización en vivo y puede escribir.
- Los mensajes persisten entre reinicios del hub.
- `bun run test`, `bun run typecheck` y `bun run build` pasan en el clon, validados por el tester de la planta.

## Alcance

Entra:

- Hub: tabla `chat_messages` en SQLite, módulo `hub/src/chat.ts` (`ChatDesk`) con canales, publicación, lectura, lectura en espera (long-poll), anuncios de ficheros («toca»/«listo») y aviso de solapes; rutas HTTP para agentes (`/chat`) y para el panel (`/api/chat`); emisión en vivo por WebSocket; inyección de mensajes nuevos como contexto al arrancar un agente y en cada turno; recordatorio no bloqueante cuando un desarrollador edita un fichero que no anunció.
- Agentes: script `plugin/scripts/office-chat.sh` que llaman con Bash (publicar, anunciar, preguntar, leer, esperar), variable `{{chatScript}}` en las plantillas y sección «Chat de la planta» con las reglas de protocolo en `lead`, `dev` y `tester`; sección «Chat interno» en la skill `office-protocol`.
- Panel: pestaña Chat con lista de canales, mensajes en vivo, ficheros anunciados en edición por canal, cuadro para escribir; textos en `es.ts`/`en.ts`.
- Los mensajes del usuario en un canal se entregan además a la sesión del jefe de esa planta (o, en `#global`, a los jefes de las plantas gestionadas) por el mismo cauce que las órdenes pero con un prefijo propio, `[Chat de Agent Office]`, para que el equipo los lea sin esperar al siguiente turno y sin confundirlos con un encargo. El director no recibe el chat por la bandeja: lo lee por inyección en su turno.
- Una frase de `lead.md.tpl:8` cambia para permitir al jefe ejecutar el script del chat, que es lo único que ejecuta: sin ella las reglas nuevas lo contradirían.

Fuera:

- Sustituir `HECHO:`, `BLOQUEADO:`, `PLAN:`, `LECCIÓN:`, `REVISAR:` ni el resto del protocolo: siguen igual y el hub los sigue leyendo en `SendMessage`.
- Cambiar roles o plantillas más allá de añadir las reglas de uso del chat y la frase anterior. El director no escribe en el chat: no tiene Bash (`plugin/templates/director.md.tpl:6`) y el `CLAUDE.md` dice que no ejecuta nada; lee `#global` por inyección de contexto.
- Canales para los departamentos (Redacción, Mantenimiento) y escritura desde ellos: sus agentes trabajan con guardia de rutas y fuera del flujo de código. Se deja como pregunta abierta.
- Mensajes privados entre agentes dentro del chat, menciones, hilos, notificaciones de escritorio por mensaje de chat.
- Regla de permisos `allow` para el script en los lanzadores (`office-sh.ts`): se deja como pregunta abierta porque obliga a adaptar `hub/test/permissions.test.ts:173-230`.
- Las escenas 2D y 3D, sprites, assets, README.

## Carpetas y ficheros que toca este plan

Obligatorio por el brief: este plan corre en paralelo con el de la escena. Todo lo que se toca está aquí; nada más.

Ficheros nuevos (sin riesgo de conflicto):

- `hub/src/chat.ts`
- `hub/test/chat.test.ts`
- `hub/test/chat-server.test.ts`
- `plugin/scripts/office-chat.sh`
- `ui/src/chat/chat.ts`
- `ui/src/chat/chat.css`
- `ui/src/chat/claims.ts`
- `ui/src/chat/claims.test.ts`

Ficheros existentes que se editan, solo en el hub y el plugin (el otro plan no debería tocarlos):

- `hub/src/courier.ts`: constante `CHAT_PREFIX` y función `chatInboxText`, junto a `ORDER_PREFIX` y `orderText` (`hub/src/courier.ts:3-9`).

- `hub/src/types.ts`: tipos nuevos añadidos al final de bloques existentes (`HubTextParams`, `Snapshot`, `ServerMessage`) y tipos `Chat*` nuevos.
- `hub/src/db.ts`: una tabla y dos índices en `SCHEMA`.
- `hub/src/office.ts`: campo `chat`, métodos públicos nuevos, puntos de enganche en `ingest` (inyección, recordatorio y neutralización de las llamadas al script como «tests»), `snapshot`, `forgetFloor`, y una condición más en `taskLine`.
- `hub/src/server.ts`: rutas `/chat`, `/chat/:channel`, `/api/chat/:channel`.
- `hub/src/agents.ts`: constante `CHAT_SCRIPT` y variable `chatScript` en `commonVars`.
- `hub/src/prune.ts`, `hub/src/floor-data.ts`, `hub/src/floors.ts` (`RESERVED_SLUGS`): una línea cada uno.
- `hub/test/floor-admin.test.ts`: una línea en `seedFloorRows` (`:39-60`), porque su bucle `:180-183` exige una fila en cada tabla de `FLOOR_TABLES`.
- `plugin/templates/lead.md.tpl` (sección nueva y una frase en `:8`), `plugin/templates/dev.md.tpl`, `plugin/templates/tester.md.tpl`, `plugin/skills/office-protocol/SKILL.md`: una sección nueva cada uno.
- `ui/test/i18n.test.ts`: dos claves más en `SAME_KEYS` (`:11-30`).

Ficheros existentes de la UI que se editan y que el otro plan podría tocar también. Los cambios de este plan son añadidos puros en puntos concretos, para que un conflicto de merge se resuelva conservando ambos lados:

- `ui/src/main.ts`: una vista más (`chatHost`) junto a `plansHost` (`ui/src/main.ts:37`, `:61`, `:67`), su `mount` y una llamada `chat.setActive(next === 'chat')` en `showTab`.
- `ui/src/topbar.ts`: valor `'chat'` en `Tab` (`ui/src/topbar.ts:5`) y una entrada en `TABS` (`:22-27`).
- `ui/src/store.ts`: tema `'chat'`, campo `chat`, un `case` en `apply`, una línea en `applySnapshot`, `reset` y `markAll`.
- `ui/src/api.ts`: dos métodos nuevos.
- `ui/src/i18n/es.ts`, `ui/src/i18n/en.ts`: bloque `chat.*` nuevo tras `settings.notifications.*` (`es.ts:494-510`) y antes del bloque `hub.*`, lejos de `scene.*` que es lo que toca el plan de la escena; claves `hub.act.chat*`, `hub.api.chat*` al final de sus bloques.

No se toca: `ui/src/office/**`, `ui/src/scene/**`, `ui/src/sprites/**`, `ui/public/**`, `ui/src/styles.css` (los estilos del chat van en `ui/src/chat/chat.css`, importado desde `ui/src/chat/chat.ts` como hace `ui/src/scene/scene.ts:1` con `scene.css`), `ui/index.html`, `docs/**`, `README.md`, `plugin/hooks/**`, `plugin/settings/**`, `hub/src/office-sh.ts`, `hub/src/state-machine.ts`, `hub/src/guard.ts`.

## Diseño

### 1. Almacenamiento: tabla `chat_messages`

Se añade a `SCHEMA` en `hub/src/db.ts:24-197` (después de `alerts`):

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  channel TEXT NOT NULL,
  floor TEXT NOT NULL,
  author_key TEXT NOT NULL,
  author_name TEXT NOT NULL,
  role TEXT,
  origin TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  files TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_channel ON chat_messages (channel, id);
CREATE INDEX IF NOT EXISTS chat_floor ON chat_messages (floor, id);
```

- `channel`: `global` o el slug de una planta gestionada. `floor`: la planta del autor (coincide con `channel` salvo en `#global`); sirve para `purgeFloorData`.
- `origin`: `agent` o `user`. `kind`: `texto` | `toca` | `listo` | `pregunta`. `files`: JSON de rutas relativas a la raíz de la planta (vacío `[]` salvo en `toca`/`listo`).
- Por qué no se sube `SCHEMA_VERSION`: `migrate` ejecuta todo `SCHEMA` en cada apertura (`hub/src/db.ts:219-221`), y `CREATE TABLE IF NOT EXISTS` es idempotente, igual que `alerts`, `reports` o `documents`, que tampoco tienen migración. `MIGRATIONS` (`:10-20`) queda para `ALTER`. Así `hub/test/db.test.ts:59` (`SCHEMA_VERSION` es 3) no cambia.
- Persistencia entre reinicios: la tabla vive en `office.db` (WAL, `hub/src/db.ts:241`). Al arrancar, `ChatDesk` no carga nada en memoria: lee de SQLite bajo demanda (`recent`, `since`, `before`) y solo mantiene en memoria los que esperan (long-poll) y el último id visto por agente. Así el criterio «persisten entre reinicios» no depende de ningún caché.
- Retención: `hub/src/prune.ts:11-20` añade `run('DELETE FROM chat_messages WHERE ts < ?')` (mismos 14 días de `retentionDays`, como `messages`). `hub/src/floor-data.ts:13-26` añade `'chat_messages'` a `FLOOR_TABLES` para que borrar una planta desde Ajustes se lleve también su chat.

### 2. Módulo `hub/src/chat.ts`: `ChatDesk`

Un módulo propio, como `QuestionDesk` (`hub/src/questions.ts`) o `SyncDesk`, para no engordar `office.ts` (1888 líneas). Dependencias por constructor, como `SyncDesk` (`hub/src/office.ts:292-299`):

```ts
export type ChatDeps = {
  db: Database;
  now: () => number;
  channels: () => string[];                 // ['global', ...plantas gestionadas ordenadas]
  roleLabel: (role: string | null) => string | null;  // ROLE_LABELS[roleIdOf(role)]
  onMessage: (message: ChatMessageView) => void;      // office.emit({ type: 'chat', data })
};

export type ChatAuthor = { key: string; name: string; role: string | null; floor: string; origin: ChatOrigin };
export type ChatInput = { channel: string; kind: ChatKind; text: string; files: string[]; author: ChatAuthor };
export type ChatClaim = { file: string; authorKey: string; authorName: string; ts: number; id: number };

export class ChatDesk {
  channels(): string[];
  isChannel(id: string): boolean;
  post(input: ChatInput): { message: ChatMessageView; warnings: ChatClaim[] };
  since(channel: string, afterId: number, limit?: number): ChatMessageView[];
  before(channel: string, beforeId: number | null, limit?: number): ChatMessageView[];
  recent(limit?: number): ChatMessageView[];           // todos los canales, para el snapshot
  lastId(channel: string): number;                      // 0 si el canal está vacío
  wait(channel: string, afterId: number, timeoutMs: number, signal?: AbortSignal): Promise<ChatMessageView[]>;
  openClaims(channel: string): ChatClaim[];
  claimsOn(channel: string, file: string, exceptAuthor?: string): ChatClaim[];
  unreadFor(agentKey: string, channels: string[], limit?: number): ChatMessageView[];  // y marca visto
  forgetFloor(slug: string): void;                     // limpia esperas y vistos de esa planta
}
```

Decisiones:

- **Canales** = `['global', ...managedFloors(config).map(([slug]) => slug)]` (`hub/src/agents.ts:53-57`). Validar el canal evita que un agente escriba en `#direccion` o en una planta observada. Por qué un canal por planta y no por equipo: el equipo de una planta es una sesión (`teamOfSession`, `hub/src/office.ts:228-230`) y cambia al reiniciar; el slug de la planta es estable y es lo que el usuario ve en el panel. Para que ninguna planta se llame como el canal común, `global` se añade a `RESERVED_SLUGS` (`hub/src/floors.ts:11`), que ya rechaza `direccion`, `redaccion`, `mantenimiento` y `desconocida` en `floor-cli.ts:81` y en `freeSlug` (`floors.ts:183-194`); los tests que lo usan (`hub/test/floor-admin.test.ts:114,265`) prueban con `redaccion` y no cambian.
- **Límites**: `MAX_CHAT_TEXT = 2000` caracteres (como `MAX_ORDER_LENGTH = 4000` en `hub/src/server.ts:29`, pero más corto porque son líneas de chat), `MAX_FILES = 40` rutas por anuncio, `SNAPSHOT_LIMIT = 200` mensajes en el snapshot, `READ_LIMIT = 50` por lectura del script (también cuando no se pasa `--desde`: los últimos 50 del canal), `HISTORY_LIMIT = 100` por página del panel, `WAIT_MAX_MS = 90_000` de espera máxima. Por qué 90 s: la herramienta Bash de Claude Code corta el comando a los 120 s por defecto, así que una espera mayor terminaría en «timed out» del lado del agente en vez de en «Sin mensajes nuevos»; con 90 s más los 15 s de margen del `curl` del script se queda por debajo.
- **Anuncios abiertos («claims»)**: un fichero está «en edición» por un autor cuando su último mensaje `toca` que lo incluye es posterior a su último `listo` que lo incluye y tiene menos de `CLAIM_TTL_MS = 4 h`. Se calcula desde SQLite al pedirlo (`openClaims`), sin estado en memoria: una consulta de los `toca`/`listo` del canal en las últimas 4 h y un recorrido en orden. Comparación de rutas: igualdad exacta de la ruta relativa normalizada (`posix.normalize`, sin `./` inicial) o igualdad de `basename` cuando una de las dos no lleva directorio (el agente a veces anuncia solo el nombre). `post` devuelve en `warnings` los anuncios abiertos de **otros** autores sobre los mismos ficheros; el script los imprime (sección 4).
- **Lectura en espera**: cuando la petición trae `esperar > 0` sin `desde`, `afterId` es `lastId(channel)` en el momento de la petición (no 0): si fuera 0, «espera» devolvería al instante los últimos 50 con la propia pregunta y sin respuesta, y el agente acabaría en `BLOQUEADO:`. Sin `esperar` y sin `desde` se devuelven los últimos `READ_LIMIT`. `wait` devuelve al momento si hay mensajes con `id > afterId`; si no, registra un `waiter` `{ channel, afterId, resolve, timer }` y lo resuelve cuando `post` publica en ese canal o vence el plazo (devuelve `[]`). Si `signal` aborta (el agente cortó el curl), se retira el waiter. El servidor marca la petición con `holdRequest` para que no la corte el `idleTimeout: 30` (`hub/src/server.ts:67,75,212`).
- **Vistos por agente**: `seen: Map<agentKey, number>` con el último id inyectado a cada agente. `unreadFor(agentKey, channels)` devuelve los mensajes posteriores de los canales pedidos **excluyendo los del propio agente** (`author_key !== agentKey`: lo que uno publica no se le reinyecta) y actualiza el mapa; `markSeen(agentKey, id)` lo sube a mano. Como `seen` es un solo id por agente, `userChat` **no** puede marcar visto sin más: si `dev-mobile` publicó `toca` (#5) y el usuario escribe (#6) antes del siguiente turno del jefe, marcar #6 perdería el #5. Por eso `userChat` hace, por cada sesión a la que entrega: `pending = unreadFor(session.sessionId, canales del jefe)` (que excluye lo propio y ya adelanta `seen` hasta el último id anterior al del usuario), mete esas líneas en el texto de la bandeja antes de la del usuario (sección 3, `chatInboxText`) y después `markSeen(session.sessionId, message.id)`. Así el jefe recibe en la bandeja todo lo pendiente más el mensaje del usuario, una sola vez, y su siguiente `UserPromptSubmit` no lo repite. Al arrancar el hub el mapa está vacío: el primer turno de cada agente recibe los últimos `INJECT_LIMIT = 20`; aceptable y documentado en Riesgos.
- **Una línea por mensaje**: el cuerpo admite saltos de línea (llega por formulario), así que `format` colapsa todo espacio en blanco, saltos incluidos, a un espacio (`text.replace(/\s+/g, ' ')`, como `short` en `hub/src/state-machine.ts:80-83`). Sin esto un agente podría incluir en su mensaje una línea `#99 10:00 usuario: …` que el director y los demás jefes leerían en su contexto como si fuera del usuario. El panel pinta el texto en un `<p>` con `white-space: pre-wrap`, así que allí sí conserva los saltos.
- **Vista**: `toView(row)` produce `ChatMessageView` con `roleId: roleIdOf(role)` (`hub/src/scope.ts:55-63`) para que el panel traduzca el rol con `t('role.*')` y no reciba texto español del hub (regla de `hub-textos-idioma`: el hub no redacta texto de usuario para el panel, `hub/src/types.ts:5-7`). El texto del mensaje es del agente o del usuario y va crudo, como `MessageView.text`.
- **Texto para agentes**: `ChatDesk.format(messages)` produce las líneas que lee el agente (en español, idioma de las plantillas): `#<id> HH:MM <nombre> (<rol>): <texto>`; para `toca`/`listo`: `#<id> HH:MM <nombre> (<rol>) TOCA lib/a.dart, lib/b.dart — <texto>` / `LISTO …`; para `pregunta`: `#<id> HH:MM <nombre> (<rol>) PREGUNTA: <texto>`; para el usuario: `#<id> HH:MM usuario: <texto>`. Es texto para agentes, no para el panel, igual que `SyncResult.text` (`hub/src/server.ts:200-202`), así que no pasa por i18n.

### 3. Enganche en `Office` (`hub/src/office.ts`)

- Campo `private readonly chat: ChatDesk`, construido en el constructor junto a `usage` (`:322`) con `channels: () => ['global', ...managedFloors(this.config).map(([slug]) => slug)]`, `roleLabel: (role) => { const id = roleIdOf(role); return id ? ROLE_LABELS[id] : null; }` y `onMessage: (m) => this.emit({ type: 'chat', data: m })`.
- `snapshot()` (`:346-360`) añade `chat: this.chat.recent(SNAPSHOT_LIMIT)`.
- `forgetFloor` (`:781-803`) añade `this.chat.forgetFloor(slug)` antes de `purgeFloorData` (que ya borra las filas por la nueva entrada en `FLOOR_TABLES`).

Métodos públicos nuevos:

```ts
postChat(raw: ChatPostRequest, meta: HookMeta): ChatPostResult;      // agentes, desde el script
userChat(channel: string, text: string): Promise<ChatPostResult>;     // panel
readChat(channel: string, afterId: number, waitMs: number, signal?: AbortSignal): Promise<ChatMessageView[] | 'no-channel'>;
chatHistory(channel: string, beforeId: number | null): ChatMessageView[] | 'no-channel';
```

- **Identidad del autor en `postChat`.** El script no es un hook: no llega `agent_id`. El autor se resuelve así, en este orden, y si falla se devuelve `{ ok: false, status: 404, error: { key: 'hub.api.chatAuthorUnknown' } }`:
  1. Planta: con el `cwd` que manda el script (`$PWD`), `root = this.floors.rootOf(realPath(cwd))` (`hub/src/floors.ts:114-121`, solo consulta git y una caché) y `slug` = la planta gestionada cuya `realPath(floor.path) === root` (`managedFloors(this.config)`). No se usa `this.floors.resolve`, que daría de alta una planta observada en el registro si el `cwd` no es de ninguna planta (`floors.ts:105-111`): ejecutar el script desde otra carpeta no debe dejar una planta fantasma. Sin planta gestionada: `hub.api.chatFloorUnknown`.
  2. Si llega `raw.from` (nombre del compañero: `dev-mobile`, `tester-mobile`), se busca en `this.agents` un agente vivo (`endedAt === null`, no retirado: `!this.isRetired(agent)`, como `liveTeammate` en `hub/src/office.ts:1165-1172`) con `name === from` y `floor === slug`; si hay varios, el de `updatedAt` mayor. Autor = `{ key: agent.key, name: agent.name, role: agent.role, floor }`.
  3. Si no, se usa la cabecera `X-Office-Name` (`metaOf`, `hub/src/server.ts:329-337`; la exporta el lanzador, `hub/src/office-sh.ts:195-196`) y se busca una sesión viva con ese `name` en esa planta (`this.sessions`). Autor = `{ key: session.sessionId, name, role: session.role, floor }`.
  4. Canal: si `raw.channel` está vacío, es la planta del autor; si es `global`, vale para cualquier autor resuelto; si es otra planta distinta de la del autor se rechaza (`hub.api.chatChannelForbidden`): un desarrollador de `mobile` no escribe en `#backend`, para eso está `#global` y su jefe.
  Por qué así y no un token por agente: los compañeros en proceso comparten el entorno de la sesión del jefe (`AGENT_OFFICE_NAME=lead-<slug>`), así que la identidad fina solo puede venir del propio agente; se acota exigiendo que el nombre exista vivo en esa planta (la misma información con la que `recipientKey` resuelve destinatarios, `hub/src/office.ts:1463-1480`). Un agente podría firmar como otro de su planta; está en Riesgos y no es peor que lo que ya puede hacer con `SendMessage`.
- **`userChat`**: autor fijo `{ key: 'panel', name: 'usuario', role: null, floor: channel === 'global' ? 'direccion' : channel, origin: 'user' }`. Tras publicar, entrega el texto a las sesiones con socket que exista (`session.socket && existsSync(session.socket)`, como `order()` en `hub/src/office.ts:622`, para no esperar los 3 s del timeout de `deliver` con un socket muerto): si el canal es una planta, a la sesión viva cuyo `floor === channel` y `isLeadRole(role)`; si es `global`, a los jefes de plantas gestionadas (`floorKind === 'managed'` e `isLeadRole`), nunca al director (no tiene Bash para contestar en el canal y su plantilla, `director.md.tpl:30`, trata lo que no empieza por `[Agent Office]` como informes de los equipos: le basta la inyección en su turno, sección 3) ni a `lead-redaccion` o `lead-mantenimiento`, que quedan fuera del alcance. Se reutiliza `this.deliverFn(session.socket, encodeInbox(session.token, chatInboxText(channel, pending, message)))` (`hub/src/courier.ts:11-16`). `chatInboxText` vive en `courier.ts` junto a `orderText` (`:7-9`) y produce `${CHAT_PREFIX} #<canal>` seguido de una línea por mensaje pendiente (`ChatDesk.format`) y la del usuario, `usuario: <texto>`; `CHAT_PREFIX = '[Chat de Agent Office]'` es una constante nueva junto a `ORDER_PREFIX`. No empieza por `[Agent Office]` a propósito: las plantillas dicen que lo que empieza así es un encargo del usuario (`lead.md.tpl:37`, `director.md.tpl:30`), y un «¿cómo vais?» no es una orden; la sección 8 añade la frase que explica el prefijo nuevo. El mensaje de la bandeja llega a la sesión como turno de usuario y dispara `UserPromptSubmit`, donde `ingest` hace `agent.task = taskLine(e.prompt)` para la sesión principal (`hub/src/office.ts:421-424`); `taskLine` (`:1773-1784`) solo descarta `ORDER_PREFIX`, `<` y `/`, así que sin más el encargo visible del jefe (o del director en `#global`) pasaría a ser el texto del chat. Por eso `taskLine` gana una condición: si `rest.startsWith(CHAT_PREFIX)` devuelve `null`, y el encargo mostrado no cambia. Por cada entrega conseguida, el `markSeen` descrito en la sección 2 (tras haber incluido lo pendiente en la bandeja). Las entregas fallidas no hacen fallar la publicación: el mensaje ya está en el canal; `delivered` cuenta las que llegaron.
- **Actividad**: cada publicación añade una entrada con `pushActivity`. De un agente, con su `agentKey`: `{ key: 'hub.act.chatPost', params: { who, channel, text: short(text, 60) } }` para `texto`/`pregunta`, `{ key: 'hub.act.chatClaim', params: { who, channel, files } }` para `toca` y `{ key: 'hub.act.chatRelease', … }` para `listo`. Del usuario, con `agentKey: 'panel'`: `{ key: 'hub.act.chatUser', params: { channel, text: short(text, 60) } }` (sin `who`, porque siempre es el usuario). Así el chat aparece también en la línea de tiempo del agente.

**Las llamadas al script no son tests.** `classify` aplica la expresión de tests del perfil a todo comando Bash (`hub/src/state-machine.ts:203` en `PreToolUse`, `:316` en `PostToolUse`); con salida 0 marca `test: 'pass'` e `ingest` lo guarda como verdict `tests ok=1` (`hub/src/office.ts:430-434`), que es lo que lee `lastTesterGreen` (`:1867-1869`) para abrir la puerta del `HECHO:`. Un `office-chat.sh mobile di "voy con flutter test test/login_test.dart"` del tester (perfil flutter) o cualquier texto con «test» en el perfil genérico (`plugin/profiles/generic.json:4`, `\btest\b`) registraría un verde falso. Por eso `ingest`, justo después de `classify` (`:372`), llama a `neutralizeChatCommand(c, e)`: si `c.tool === 'Bash'` y el comando es una llamada al script del chat (`tokenize(command)` de `hub/src/guard.ts:64-135` devuelve un solo segmento, sin `;`, `&&`, `||` ni `|` fuera de comillas; se saltan las asignaciones `VAR=` iniciales como hace `shellPaths` en `:145`; y el primer token, ya sin comillas, es `CHAT_SCRIPT` o tiene `basename` exactamente `office-chat.sh`), pone `c.test = null`, `c.command = null`, `c.state = 'working'` y `c.summary = { key: 'hub.act.chatCommand' }` (clave nueva, «usa el chat de la planta») con `c.detail` igual. Se hace en `office.ts` para no tocar `state-machine.ts`, fuera del alcance; `classify` sigue igual para el resto de comandos.

**Inyección de mensajes nuevos como contexto.** `ingest` solo devuelve salida en `SubagentStart`/`SessionStart` (`hub/src/office.ts:458`), con `injection()` (`:945-974`). Se generaliza:

- `injection(event, agent, session)` pasa a construir dos bloques opcionales, memoria (lo que hay) y chat, y devuelve un único JSON `{ hookSpecificOutput: { hookEventName: event, additionalContext: bloques.join('\n\n') } }` o `null` si no hay nada. Claude Code admite `additionalContext` en `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `SubagentStart` y otros (documentación de hooks: https://code.claude.com/docs/en/hooks, sección «hookSpecificOutput»).
- El bloque de chat se añade cuando `session.floorKind === 'managed'` y el agente tiene rol de oficina (`roleIdOf(agent.role)` es `lead`, `dev` o `tester`), con canales `[agent.floor, 'global']`; y cuando `session.floorKind === 'direccion'` y el rol es `director`, con `['global']`. Texto: `Chat de Agent Office. Mensajes nuevos en #<canal> y #global:` seguido de `ChatDesk.format(unread)` (los últimos `INJECT_LIMIT` no vistos) y, si quedaron más fuera, una línea `Hay <n> anteriores sin mostrar: <CHAT_SCRIPT> <canal> leer` (sin `--desde`, que devuelve los últimos 50). Sin mensajes nuevos no se añade nada.
- `ingest` devuelve `this.injection(...)` también en `UserPromptSubmit` (`:458` pasa a `if (c.event === 'SubagentStart' || c.event === 'SessionStart' || c.event === 'UserPromptSubmit')`). La memoria sigue inyectándose solo en los dos primeros: `injection` recibe `event` y omite el bloque de memoria en `UserPromptSubmit`. La ruta `/events` ya devuelve cualquier salida no nula (`hub/src/server.ts:52-56`) y `emit.sh` la imprime (`plugin/hooks/emit.sh:22-24`).

**Recordatorio al editar sin anunciar.** En `ingest`, cuando `c.event === 'PreToolUse'`, `EDIT_TOOLS.has(c.tool)`, `c.filePath` no es nulo, `session.floorKind === 'managed'` y `roleKind(agent.role) === 'dev'`:

- `rel = this.fileLabel(c.filePath, session)` (`hub/src/office.ts:1443-1451`, ya calcula la ruta relativa a la raíz de la planta).
- Si `this.chat.claimsOn(agent.floor, rel, agent.key)` tiene anuncios abiertos de otros: `additionalContext = Chat de la planta: <nombre> anunció <rel> hace <n> min (#<id>). Acuérdalo con él en #<slug> antes de editar: <CHAT_SCRIPT> <slug> pregunta "…" --de <agent.name>`. El aviso de solape se repite en cada edición mientras el anuncio ajeno siga abierto, pero una sola vez por anuncio (`warned: Set` con `${agent.key}|${rel}|${claim.id}`): es el caso que previene pisarse y no debe quedar tapado por un recordatorio anterior.
- Si no, y el propio agente no tiene anuncio abierto sobre `rel`: `additionalContext = Chat de la planta: no has anunciado <rel> en #<slug>. Anúncialo antes de seguir: <CHAT_SCRIPT> <slug> toca <rel> --de <agent.name>`. Este recordatorio se da **una vez por agente y fichero** (`nudged: Set` con `${agent.key}|${rel}`), para no repetirlo en cada edición del mismo fichero. Los dos conjuntos son independientes.
- El hub conoce el nombre del agente (`agent.name`, `dev-mobile`), así que el `--de` va ya relleno; si no lo conoce, se omite la opción.
- Es solo contexto, nunca `permissionDecision`: bloquear ediciones por una regla de cortesía dejaría a los equipos parados si el hub tiene el chat vacío tras un reinicio. El `curl` de `emit.sh` corta a los **2 s** para `events` (`plugin/hooks/emit.sh:10-14`, `max=2`; los 5 s de `hooks.json:25-34` son el tope del hook, no del curl): la consulta es una lectura indexada por canal de las últimas 4 h y responde en milisegundos; si se pasara, el agente simplemente no recibe el recordatorio.
- El guard de `plugin/hooks/guard.sh` no se toca: va por `/guard` y solo afecta a departamentos.

### 4. Acceso de los agentes: script `plugin/scripts/office-chat.sh`

Se elige un script de Bash y no una skill ni una herramienta MCP porque:

- Es el mecanismo que ya usa la oficina para que un agente hable con el hub desde su sesión (`plugin/scripts/office-sync.sh`, referenciado desde la plantilla como `{{syncScript}}`, `hub/src/agents.ts:29,85` y `plugin/templates/lead-redaccion.md.tpl:26`).
- Una skill solo daría instrucciones; seguiría necesitando un comando. Un servidor MCP obligaría a tocar la configuración de cada sesión (`office-sh.ts`) y a mantener otro proceso.
- Bash lo tienen el jefe, el desarrollador y el tester (`plugin/templates/tester.md.tpl:4`; `dev` y `lead` no restringen herramientas).

Uso (todas las formas aceptan `--de <nombre>` en cualquier posición; sin él, el hub usa el nombre de la sesión, que es el jefe):

```
office-chat.sh <canal> di "<texto>"                      # mensaje normal
office-chat.sh <canal> toca <ruta> [<ruta>…] [-- "<nota>"] # anuncia ficheros antes de editar
office-chat.sh <canal> listo <ruta> [<ruta>…] [-- "<nota>"]# avisa de que terminó con ellos
office-chat.sh <canal> pregunta "<texto>"                 # pregunta al canal
office-chat.sh <canal> leer [--desde <id>] [--esperar <seg>]
```

- `<canal>` es el slug de la planta o `global`. Validación en el script como en `office-sync.sh:25` (minúsculas, números y guiones).
- Opciones: `--de <nombre>` se reconoce en cualquier posición, también después de `--`; `--` separa las rutas de la nota en `toca`/`listo`, y la nota es solo el argumento que sigue a `--`. `--esperar` admite de 0 a 90 segundos; más se recorta a 90 (el hub también lo recorta).
- Publicar: `curl -sS -m 10 -X POST "http://127.0.0.1:$port/chat?format=text"` con `application/x-www-form-urlencoded` y `--data-urlencode` por campo (`channel=`, `kind=`, `text=`, `from=`, `cwd=$PWD`, y un `files=` por ruta). Por qué formulario y no JSON: evita escapar a mano texto libre en `sh` (comillas, barras, saltos de línea), que es lo que `office-sync.sh:27,37` solo puede permitirse porque valida cada campo con un patrón. Hono lo lee con `c.req.parseBody({ all: true })`, que admite `application/x-www-form-urlencoded` y devuelve arrays para claves repetidas (https://hono.dev/docs/api/request#parsebody).
- Leer: `curl -sS -m $((esperar + 15)) "http://127.0.0.1:$port/chat/<canal>?desde=<id>&esperar=<seg>&format=text"`. Sin `--desde`, el hub devuelve los últimos `READ_LIMIT` (50) del canal. Con `--esperar N` (máximo 90) la petición se queda abierta hasta que haya mensaje nuevo o venza N.
- Cabeceras como `emit.sh:15-20`: `X-Office-Key` (leída de `$AGENT_OFFICE_HOME/key` o `~/.config/agent-office/key`), `X-Office-Role`, `X-Office-Name`. Puerto de `$dir/port` con 4747 por defecto, como `office-sync.sh:46-47`.
- Salida: lo que devuelve el hub en texto (`Publicado #<id> en #mobile.`, con el id que luego se pasa a `leer --desde <id> --esperar 90` para esperar la respuesta; y, si hay, `Aviso: dev-mobile ya anunció lib/a.dart hace 3 min (#12). Acordadlo en el chat antes de editar.`; o las líneas de `format`; o `Sin mensajes nuevos en #mobile desde #<id>.`). Errores: el hub responde `ERROR: <texto>` con su código HTTP; como `curl -sS` no falla con un 4xx, el script captura el código con `-w '%{http_code}'` (o `--fail-with-body`), imprime el cuerpo y sale con 1 si el código no es 2xx; sin key, código 69 como `office-sync.sh:43-45`; sin hub, 69 como `office-sync.sh:52-56`.
- Constante `CHAT_SCRIPT = join(SCRIPTS_DIR, 'office-chat.sh')` en `hub/src/agents.ts` junto a `SYNC_SCRIPT` (`:29`) y variable `chatScript: CHAT_SCRIPT` en `commonVars` (`:70-89`). `render` lanza si una plantilla usa una variable sin valor (`:31-37`), nunca si sobra: añadir la variable no rompe las plantillas que no la usan ni `hub/test/floor-cli.test.ts:250-251`.
- El plugin apunta a la copia en vivo (`CLAUDE_PLUGIN_ROOT`), pero `SCRIPTS_DIR` sale de `REPO_ROOT` del hub que corre (`hub/src/config.ts:19,23`), igual que `SYNC_SCRIPT`; en el clon, la receta de verificación arranca el hub del clon y las plantillas renderizadas apuntan al script del clon.

### 5. Rutas HTTP (`hub/src/server.ts`)

Todas con `requireKey` (`hub/src/server.ts:45-48`), añadidas tras `/usage` (`:92`) las de agentes y tras `/api/redaccion/sync` (`:197-203`) la del panel:

| Ruta | Quién | Cuerpo / query | Respuesta |
| --- | --- | --- | --- |
| `POST /chat` | script | formulario `channel, kind, text, files*, from, cwd`; `?format=text` | 200 texto o JSON `{ message, warnings }`; 400 `hub.api.chatFields` / `hub.api.chatTooLong` / `hub.api.chatKind`; 404 `hub.api.chatAuthorUnknown` / `hub.api.chatFloorUnknown`; 403 `hub.api.chatChannelForbidden`; 404 `hub.api.chatChannelUnknown` |
| `GET /chat/:channel` | script | `desde` (id, opcional), `esperar` (s, 0–90), `?format=text` | 200 texto o JSON `ChatMessageView[]`; 404 `hub.api.chatChannelUnknown`. Sin `desde` ni `esperar`: últimos 50. Con `esperar > 0` y sin `desde`: `afterId = lastId(channel)`. Con `esperar > 0` llama a `holdRequest(c.req.raw)` y pasa `c.req.raw.signal` |
| `GET /api/chat/:channel` | panel | `before` (id, opcional) | 200 JSON `ChatMessageView[]` (hasta 100, más antiguos primero); 404 |
| `POST /api/chat/:channel` | panel | JSON `{ text }` | 200 JSON `ChatUserResult = { message: ChatMessageView; delivered: number }`; 400 / 404 como arriba |

En modo texto los errores salen como `ERROR: <texto en español>` con el mismo código HTTP, igual que `/api/redaccion/sync?format=text` (`:201`). Los textos de error para el agente se escriben en `chat.ts` (`errorTextFor(key)`), separados de las claves `HubText` que ve el panel.

### 6. Tipos compartidos (`hub/src/types.ts`)

Se añaden (y `ui/tsconfig.json:14` los incluye en el typecheck de la UI):

```ts
export type ChatKind = 'texto' | 'toca' | 'listo' | 'pregunta';
export type ChatOrigin = 'agent' | 'user';
export type ChatMessageView = {
  id: number; ts: number; channel: string; floor: string;
  authorKey: string; authorName: string; role: string | null; roleId: RoleId | null;
  origin: ChatOrigin; kind: ChatKind; text: string; files: string[];
};
export type ChatClaimView = { file: string; authorKey: string; authorName: string; ts: number; id: number };
export type ChatPostRequest = { channel: string; kind?: ChatKind; text: string; files?: string[]; from?: string; cwd?: string };
export type ChatPostResult = { ok: true; message: ChatMessageView; warnings: ChatClaimView[] } | { ok: false; status: 400 | 403 | 404; error: HubText };
export type ChatUserResult = { message: ChatMessageView; delivered: number };
```

`postChat` devuelve `ChatPostResult`; `userChat` devuelve `ChatUserResult` o la rama `ok: false` de `ChatPostResult` (y la ruta responde con su `status`). `api.postChat` del panel tipa su respuesta como `ApiData<ChatUserResult>`.

- `Snapshot` (`:541-552`) gana `chat: ChatMessageView[]`. `ServerMessage` (`:554-568`) gana `| { type: 'chat'; data: ChatMessageView }`. `Recording` no cambia (es `ServerMessage[]`).
- `HubTextParams` (`:8-197`) gana `'hub.act.chatPost': { who: string; channel: string; text: string }`, `'hub.act.chatClaim': { who: string; channel: string; files: string }`, `'hub.act.chatRelease': { who: string; channel: string; files: string }`, `'hub.act.chatUser': { channel: string; text: string }`, `'hub.act.chatCommand': undefined` y las `hub.api.chat*` de la tabla anterior (`undefined`). **Atención al orden de ejecución**: `ui/src/i18n/hub.ts:6-7` falla el typecheck si `HubTextKey` tiene una clave que no está en `es.ts`, y `:14-17` si los marcadores no coinciden; por eso el paso que añade estas claves a `types.ts` añade a la vez sus textos a `es.ts` y `en.ts` (paso 2), y hasta ese paso no se promete `cd ui && bun run typecheck` limpio.

### 7. Panel: pestaña Chat

- `ui/src/topbar.ts`: `Tab` pasa a `'office' | 'table' | 'plans' | 'chat' | 'settings'` (`:5`); `TABS` (`:22-27`) añade `{ tab: 'chat', labelKey: 'topbar.tab.chat' }` entre Planes y Ajustes. Se añade un contador `chatCount` como `plansCount` (`:38-39`, `:76`, `:88-93`) con los mensajes no leídos (ver abajo), escuchando `['chat', 'lang']`.
- `ui/src/main.ts`: `const chatHost = el('div', 'view chat-view')` junto a `plansHost` (`:37`); `showTab` lo activa (`:61`); se monta en `main` (`:67`); `const chat = mountChat(chatHost, store, api)` tras `mountPlans` (`:74`). `mountChat` devuelve `{ setActive(active: boolean): void }` y `showTab` llama a `chat.setActive(next === 'chat')` igual que a `office?.setActive` (`:63`): es el único enganche para saber que la pestaña está visible y marcar los mensajes como vistos. Con `api === null` (replay o sin key) la pestaña es solo lectura, como Planes (`ui/src/plans/plans.ts:63-66`).
- `ui/src/store.ts`: `Topic` gana `'chat'` (`:22-39`); campo `chat: ChatMessageView[] = []` y `chatSeen = 0` (último id visto con la pestaña abierta); `apply` gana `case 'chat'` que hace `push` con tope `CHAT_LIMIT = 500` y `mark('chat')` (como `'message'`, `:170-174`); `applySnapshot` toma `snapshot.chat ?? []` (`:300-318`) y pone `chatSeen` al último id del snapshot (lo anterior a conectar no cuenta como no leído: con `chatSeen = 0` el chip saldría con hasta 200 tras cada reconexión); `reset` lo vacía; `markAll` incluye `'chat'`. Métodos `chatOf(channel)`, `unreadChat()` (mensajes con `id > chatSeen` y `origin === 'agent'`), `markChatSeen()` (sube `chatSeen` al último id y hace `mark('chat')`, para que el chip del tab baje a 0 al momento), `prependChat(messages)` para la paginación.
- `ui/src/api.ts`: `chatHistory(channel: string, before: number | null): Promise<ApiData<ChatMessageView[]>>` y `postChat(channel: string, text: string): Promise<ApiData<ChatUserResult>>`.
- `ui/src/chat/chat.ts`, `mountChat(host, store, api)`:
  - Columna izquierda: canales = `#global` + plantas con `kind === 'managed'` de `store.floorList()` (`ui/src/store.ts:267-277`), con etiqueta `floorLabel` (`ui/src/labels.ts:88-97`) y un chip con no leídos por canal. Canal activo por defecto: el primero con mensajes, si no `#global`.
  - Centro: cabecera con el canal y la lista «En edición» (anuncios abiertos calculados en cliente a partir de `store.chatOf(channel)` con la misma regla que `ChatDesk.openClaims`, en una función pura `openClaims(messages, now)` en `ui/src/chat/claims.ts`, un módulo sin DOM ni CSS para que `claims.test.ts` lo importe en `bun test` como hace `ui/src/office/layout.test.ts:3-4` con `layout.ts`); lista de mensajes con autor (`authorName`), chip de rol (las claves `role.*` de `es.ts:18-27` van por `RoleKind`, no por `RoleId`: se traduce `roleId` a `RoleKind` con una tabla local `ROLE_KIND_OF: Record<RoleId, RoleKind>` (`lead → lead`, `dev → dev`, `tester → tester`, `director → director`, `reviewer → reviewer`, `redactor → writer`, `revisor-planes → planReviewer`, `artesano → skillwright`, `revisor-skills → skillReviewer`) y se pinta `roleLabel(kind)` de `ui/src/labels.ts:56`; para `origin === 'user'`, `t('chat.you')`), planta si el canal es `#global`, hora (`clockTime` de `ui/src/time.ts`), y para `toca`/`listo`/`pregunta` una etiqueta (`chat.kind.toca`, …) y las rutas en `<code>`. El texto del mensaje va siempre por `textContent` (`el('p', 'chat-text', message.text)`, `ui/src/dom.ts:10-19`), nunca por `innerHTML`. Botón «Cargar anteriores» que llama a `api.chatHistory(channel, oldestId)` y `store.prependChat`.
  - Abajo: `textarea` + botón Enviar (Cmd/Ctrl+Enter), misma mecánica que `ui/src/panel/orders.ts:110-144`; deshabilitado sin `api`. Al enviar, `toast` con `chat.sent` y, si `delivered === 0` en un canal de planta, `chat.sentNoLead` (nadie lo recibirá hasta su siguiente turno).
  - Auto-scroll al final solo si el usuario ya estaba al final (umbral 40 px), para no robar la lectura. `setActive(true)` y cada mensaje recibido con la pestaña activa llaman a `store.markChatSeen()`; con ella inactiva, los nuevos cuentan como no leídos en el chip del tab.
  - Textos solo con `t()`; sin literales con tildes fuera de `i18n/` (`ui/test/i18n.test.ts:124-136`).
- `ui/src/chat/chat.css`: estilos de `.chat-view` (como `.plans-view`, `ui/src/styles.css:1756-1759`: `overflow: auto; padding: 16px`), `.chat` (rejilla 200px + 1fr), `.chat-channels`, `.chat-messages`, `.chat-msg`, `.chat-claims`, `.chat-compose`. Fichero propio importado desde `chat.ts` para no tocar `styles.css`, que el otro plan puede estar editando.
- Claves i18n nuevas en `es.ts` y `en.ts` (bloque `chat.*` tras `settings.notifications.*` y antes de `hub.*`). `ui/test/i18n.test.ts:56-59` exige texto distinto en los dos idiomas salvo las claves de `SAME_KEYS` (`:11-30`): la pestaña se llama «Chat» en ambos, así que `topbar.tab.chat` y `chat.title` se añaden a `SAME_KEYS`, y `chat.global` también si queda como «#global» en los dos idiomas; el resto lleva textos distintos. El `source scan` (`:124-136`) recorre todo `src/**/*.ts`, tests incluidos, así que `claims.test.ts` tampoco lleva literales con tilde. Claves: `topbar.tab.chat`, `topbar.chatUnread.one/.other`, `chat.title`, `chat.intro`, `chat.channels`, `chat.global`, `chat.empty`, `chat.loadOlder`, `chat.loading`, `chat.claims`, `chat.noClaims`, `chat.claimSince`, `chat.kind.toca`, `chat.kind.listo`, `chat.kind.pregunta`, `chat.you`, `chat.placeholder`, `chat.send`, `chat.sent`, `chat.sentNoLead`, `chat.readOnly`, más `hub.act.chatPost`, `hub.act.chatClaim`, `hub.act.chatRelease`, `hub.act.chatUser`, `hub.act.chatCommand`, `hub.api.chatFields`, `hub.api.chatTooLong`, `hub.api.chatKind`, `hub.api.chatAuthorUnknown`, `hub.api.chatFloorUnknown`, `hub.api.chatChannelUnknown`, `hub.api.chatChannelForbidden`.

### 8. Reglas de protocolo en las plantillas y la skill

Sección nueva «## Chat de la planta» en `plugin/templates/dev.md.tpl` (tras «Cómo trabajas», `:14-21`), `plugin/templates/tester.md.tpl` (tras «Tu trabajo», `:11-15`) y `plugin/templates/lead.md.tpl` (tras «Flujo de cada encargo», `:18-27`). Texto para el desarrollador (el tester y el jefe llevan la misma mecánica con sus matices):

```
## Chat de la planta

La planta tiene un canal de chat, `#{{slug}}`, y la oficina uno común, `#global`. Se usa con Bash y siempre con tu nombre:

- Al empezar una tarea, lee el canal: `{{chatScript}} {{slug}} leer --de dev-{{slug}}`.
- Antes de editar un fichero, anúncialo: `{{chatScript}} {{slug}} --de dev-{{slug}} toca <ruta> [<ruta>…]`. Si la respuesta avisa de que otro lo anunció antes, no lo edites: pregúntale en el canal y espera su respuesta (`pregunta` y después `leer --desde <id> --esperar 90`, con el id que devolvió la pregunta). La oficina te lo recuerda si editas sin anunciar.
- Al terminar con unos ficheros, libéralos: `{{chatScript}} {{slug}} --de dev-{{slug}} listo <ruta>… -- "<qué cambió en una línea>"`.
- Si te falta algo que un compañero puede saber (dónde está una función, qué comando usa, si va a tocar lo mismo), pregunta primero en el canal: `{{chatScript}} {{slug}} --de dev-{{slug}} pregunta "<duda>"`; la respuesta dice `Publicado #<id>`; espera con `{{chatScript}} {{slug}} --de dev-{{slug}} leer --desde <id> --esperar 90` (90 segundos es el máximo: la herramienta Bash corta a los 120). Si no hay respuesta, repite la espera una vez con el mismo `--desde`; solo si nadie contesta escribe `BLOQUEADO:` a tu jefe como hasta ahora.
- Si descubres algo que el resto debería saber antes de cambiar (una convención, un fichero generado, un test frágil), dilo: `{{chatScript}} {{slug}} di "<texto>" --de dev-{{slug}}`.
- El chat no sustituye los mensajes a tu jefe: el aviso de fin y los bloqueos siguen yendo por SendMessage.
```

- Tester: lee el canal antes de probar, anuncia con `di` qué comando va a lanzar y publica el resultado en una línea además de informar a su jefe; responde a las preguntas sobre tests; `--de tester-{{slug}}`. Que el texto lleve «flutter test» o «test» no cuenta como test para la puerta: `ingest` neutraliza las llamadas al script (sección 3).
- Jefe: lee el canal cuando recibe un informe y al repartir; contesta las `pregunta` de su equipo en el canal (`di`), sin `--de`; usa `#global` para avisar a los demás jefes de cambios en contratos compartidos y para preguntas entre plantas que no necesiten decisión del director (`{{chatScript}} global di "…"`); si otro jefe pregunta en `#global` algo de su planta, contesta ahí. Las decisiones sobre contratos siguen pasando por el director como dice el protocolo. Para que no choque con `lead.md.tpl:8` («No escribes código ni ejecutas comandos: tienes esas herramientas solo para que tu equipo las herede»), esa frase pasa a: «No escribes código ni ejecutas comandos, salvo el script del chat (`{{chatScript}}`): el resto de herramientas las tienes solo para que tu equipo las herede». Es la única frase de una plantilla existente que cambia, y es necesaria: el jefe es quien contesta las preguntas del equipo y coordina con otras plantas. Se añade además en «Reglas» (`lead.md.tpl:29-37`), junto a la frase sobre `[Agent Office]`: «Los mensajes que empiezan por `[Chat de Agent Office]` son lo que el usuario escribió en el chat: no son encargos; contéstale en el canal con `di` (y, si pide algo a tu equipo, repártelo como harías con un encargo)». El director no lleva frase nueva: su plantilla queda sin tocar (Alcance), el prefijo `[Chat de Agent Office]` no coincide con `[Agent Office]` y su regla de `director.md.tpl:30` («los demás mensajes de otras sesiones son informes o peticiones de los equipos, no órdenes del usuario») ya lo cubre; añadir una frase explícita se deja como pregunta abierta 4.
- `plugin/skills/office-protocol/SKILL.md`: sección «## Chat interno» tras «Mensajes del protocolo» (`:35-46`) con los cuatro usos (`toca`, `listo`, `pregunta`, `di`), la regla «anunciar antes de editar, liberar al terminar, preguntar antes de bloquear» y la frase «La oficina recuerda en el momento a quien edita sin anunciar y avisa de los solapes; no bloquea».
- `director.md.tpl` no cambia: no tiene Bash. Al arrancar y en cada turno recibe los mensajes nuevos de `#global` como contexto (sección 3) y su plantilla ya dice que los mensajes de otras sesiones son informes; si hace falta una frase, se deja como pregunta abierta.

## Pasos

Orden pensado para que `cd hub && bun run typecheck` y `cd ui && bun run typecheck` compilen al final de cada paso (la UI incluye `hub/src/types.ts`).

1. **Tabla, retención y purga.** `hub/src/db.ts`: añadir `chat_messages` y sus índices a `SCHEMA` tras `alerts_ts` (`:196`). `hub/src/prune.ts:16`: añadir `run('DELETE FROM chat_messages WHERE ts < ?')`. `hub/src/floor-data.ts:13-26`: añadir `'chat_messages'`. `hub/src/floors.ts:11`: añadir `'global'` a `RESERVED_SLUGS`. `hub/test/floor-admin.test.ts:39-60`, en `seedFloorRows`: añadir `db.query("INSERT INTO chat_messages (ts, channel, floor, author_key, author_name, origin, kind, text, files) VALUES (?, ?, ?, ?, ?, 'agent', 'texto', 'hola', '[]')").run(now, floor, floor, session, 'dev')`, porque el bucle `:180-183` exige una fila en cada tabla de `FLOOR_TABLES` para la planta `otra` y cero para la borrada. Verificable: `cd hub && bun test test/db.test.ts test/floor-admin.test.ts` en verde; `openDb(':memory:')` lista `chat_messages` en `sqlite_master`.
2. **Tipos y textos a la vez.** `hub/src/types.ts`: tipos `Chat*`, `Snapshot.chat`, `ServerMessage` `'chat'`, claves nuevas en `HubTextParams`. Como `Snapshot.chat` es obligatorio y `hub/tsconfig.json:13` incluye `src` y `test`, en este mismo paso `Office.snapshot()` (`hub/src/office.ts:346-360`) devuelve `chat: []` (el paso 4 lo sustituye por `this.chat.recent(SNAPSHOT_LIMIT)`); si no, el typecheck del hub no compila hasta el paso 4. En el mismo paso, `ui/src/i18n/es.ts` y `en.ts`: todas las claves `hub.act.chat*`, `hub.api.chat*` y el bloque `chat.*`/`topbar.tab.chat`/`topbar.chatUnread.*`; y `ui/test/i18n.test.ts:11-30`: `'topbar.tab.chat'` y `'chat.title'` en `SAME_KEYS`. Verificable: `cd hub && bun run typecheck && cd ../ui && bun run typecheck && bun test` (el test de diccionarios exige mismas claves, mismos marcadores y texto distinto).
3. **`hub/src/chat.ts` y constantes.** `ChatDesk` completo (sección 2) con `format`, `errorTextFor`, `openClaims`, `lastId`, `wait`. En el mismo paso, para que el paso 4 compile: `CHAT_PREFIX` y `chatInboxText` en `hub/src/courier.ts`, `CHAT_SCRIPT` en `hub/src/agents.ts` (la variable `chatScript` de `commonVars` puede ir también aquí o en el paso 6). `hub/test/chat.test.ts` nuevo con `openDb(':memory:')` y un reloj falso: publicar y leer en un canal; `since`/`before`/`recent` con límites; `toca` seguido de `listo` cierra el anuncio y `toca` de otro autor sobre el mismo fichero devuelve `warnings`; coincidencia por ruta exacta y por `basename`; anuncio de más de 4 h no cuenta; `format` deja cada mensaje en una línea aunque el texto traiga saltos; `lastId` devuelve 0 en un canal vacío y el último id después; `wait` se resuelve al publicar y devuelve `[]` al vencer; `wait` con `AbortSignal` abortado no deja waiter; `unreadFor` devuelve solo lo posterior, excluye lo publicado por el propio agente y la segunda llamada devuelve vacío; `markSeen` adelanta el visto; `forgetFloor` limpia; persistencia: `openDb(fichero)`, publicar, cerrar, reabrir y `recent` devuelve el mensaje. Verificable: `cd hub && bun test test/chat.test.ts`.
4. **Enganche en `Office`.** `hub/src/office.ts`: campo `chat`, `snapshot().chat`, `forgetFloor`, `postChat`, `userChat`, `readChat`, `chatHistory`, actividad `hub.act.chat*`, `injection` con bloque de chat y en `UserPromptSubmit`, recordatorio en `PreToolUse`. Añadir a `hub/test/chat.test.ts` (o a un `describe` propio) pruebas con `harness()` y una planta gestionada (`h.config.floors.mobile = floor(repo)` como `hub/test/office.test.ts:20-25`): un `SessionStart` del jefe con `leadMeta` y un `SubagentStart` de `dev-mobile`; `postChat({ channel: 'mobile', kind: 'toca', text: '', files: ['lib/a.dart'], from: 'dev-mobile', cwd: repo }, leadMeta)` publica con `authorKey` del dev; `postChat` sin `from` publica como el jefe; `from` desconocido o retirado devuelve 404; `cwd` fuera de toda planta gestionada devuelve 404 y `h.office.snapshot().floors` no gana ninguna planta observada; canal de otra planta devuelve 403; `userChat('mobile', 'hola')` entrega por `deliverFn` falso al socket del jefe (un fichero creado en `h.root` para que `existsSync` lo dé por vivo; con un socket inexistente no se llama a `deliverFn` y `delivered` es 0), el texto empieza por `[Chat de Agent Office] #mobile` y termina con la línea `usuario: hola`, y `delivered` es 1; tras ello, `ingest(UserPromptSubmit del jefe, { prompt: <ese texto> })` devuelve `null` (ya lo recibió por la bandeja) y `agent(LEAD).task` sigue valiendo lo que valía antes (`taskLine` descarta `CHAT_PREFIX`); caso de pendientes: `dev-mobile` publica `toca lib/c.dart` y acto seguido `userChat('mobile', 'seguid')`: el texto de la bandeja contiene la línea del `toca` antes de la del usuario y el siguiente `UserPromptSubmit` del jefe devuelve `null` (nada se pierde ni se repite); en cambio, si el `toca` llega **después** del `userChat`, el siguiente `UserPromptSubmit` del jefe sí lo trae; `userChat('global', …)` con sesiones de `lead-mobile`, `director` y `lead-redaccion` entrega solo a la primera; el tester ejecuta `office-chat.sh mobile di "flutter test ok"` (`PreToolUse` y `PostToolUse` de `Bash` con ese `command`) y no se inserta ningún verdict (`SELECT COUNT(*) FROM verdicts` no cambia), su estado es `working` y no `testing`, y un `gateMessage` de `HECHO:` del jefe con una edición previa del dev sigue bloqueando; y en cambio `ingest(SubagentStart de dev-mobile)` sí lo trae en `additionalContext`, una sola vez; lo que publica `dev-mobile` no se le reinyecta a él; el director recibe lo de `#global` en `additionalContext` de su `UserPromptSubmit`; `PreToolUse Edit` de `dev-mobile` sobre `lib/b.dart` sin anuncio devuelve `additionalContext` con `no has anunciado lib/b.dart` y `--de dev-mobile`, y la segunda edición del mismo fichero devuelve `null`; con anuncio abierto de otro autor devuelve el aviso con su nombre en la primera edición y no en la segunda, y vuelve a avisar si el otro autor publica un `toca` nuevo (otro `id`); `h.messages` contiene `{ type: 'chat' }`. Verificable: `cd hub && bun test test/chat.test.ts test/office.test.ts test/departments.test.ts` (los dos últimos comprueban que la inyección de memoria sigue igual: `hub/test/departments.test.ts:695-706`).
5. **Rutas.** `hub/src/server.ts`: `/chat`, `/chat/:channel`, `/api/chat/:channel` (GET y POST) según la tabla de la sección 5. `hub/test/chat-server.test.ts` nuevo, copiando la cabecera de `hub/test/server-v2.test.ts:12-72` (`freePort`, `startServer`, `KEY`): `POST /chat` en formulario con `--data-urlencode` simulado (`new URLSearchParams(...)`) publica y en `?format=text` responde `Publicado #1 en #mobile.`; sin key 401; `GET /chat/mobile?desde=0&format=text` lista la línea; `GET /chat/mobile?desde=1&esperar=2` queda abierta y se resuelve al publicar desde otra petición en menos de 2 s; `GET /chat/mobile?esperar=2` sin `desde` con mensajes ya en el canal **no** devuelve al instante: queda abierta y trae solo el que se publique después; `GET /chat/mobile` sin `desde` ni `esperar` devuelve los últimos 50 al momento; `esperar=500` se recorta a 90 (se comprueba que la respuesta vacía llega con un reloj falso o se comprueba el valor con una función pura `clampWait`); `GET /chat/nada` 404 con `hub.api.chatChannelUnknown`; `POST /api/chat/mobile` con `{ text }` responde `{ message, delivered: 0 }`; texto de 2001 caracteres 400. Verificable: `cd hub && bun test test/chat-server.test.ts test/server-v2.test.ts`.
6. **Script y plantillas.** Crear `plugin/scripts/office-chat.sh` (sección 4) con `chmod +x`. `hub/src/agents.ts`: `chatScript` en `commonVars` si no se hizo en el paso 3. Secciones nuevas en `dev.md.tpl`, `tester.md.tpl`, `lead.md.tpl` (más la frase de `:8` y la regla sobre `[Chat de Agent Office]`) y `SKILL.md`. Verificable: `cd hub && bun test test/floor-cli.test.ts test/units.test.ts` (renderizan plantillas); `sh -n plugin/scripts/office-chat.sh`; con el hub de la receta manual (planta `demo`), `plugin/scripts/office-chat.sh demo leer` responde y `plugin/scripts/office-chat.sh nada leer` imprime `ERROR: …` y sale con 1.
7. **Store y API del panel.** `ui/src/store.ts`, `ui/src/api.ts` (sección 7). Verificable: `cd ui && bun run typecheck`.
8. **Pestaña Chat.** `ui/src/chat/chat.ts`, `ui/src/chat/chat.css`, `ui/src/topbar.ts`, `ui/src/main.ts`. Se añade `ui/src/chat/claims.test.ts` para la función pura `openClaims(messages, now)` (anuncio abierto, cerrado por `listo`, caducado): `ui/tsconfig.json:15` excluye `src/**/*.test.ts` del typecheck, pero `bun test` en `ui` sí los ejecuta, como `ui/src/office/layout.test.ts` y `ui/src/time.test.ts`. Verificable: `cd ui && bun test && bun run typecheck && bun run build`; el test `source scan` de `ui/test/i18n.test.ts` no encuentra literales con tilde en `ui/src/chat/`.
9. **Receta manual y entrega.** Seguir «Verificación». El jefe de la planta pide al tester `bun run test`, `bun run typecheck` y `bun run build` en el clon y manda `HECHO:` con el resultado del tester.

## Riesgos

- **Identidad de los compañeros.** El autor se declara con `--de` y se valida contra los agentes vivos de la planta; un agente podría firmar como otro de su planta. Mitigación: el aviso del hub nombra al autor y el panel lo muestra; no es peor que `SendMessage` hoy. Un agente de otra planta no puede escribir en un canal ajeno (403).
- **Nombres duplicados.** Si el jefe lanza dos agentes con el mismo nombre (`lead.md.tpl:16` pide nombres fijos `dev-<slug>`), `postChat` toma el más reciente (`updatedAt` mayor). El informe de la planta lo dice.
- **Compañeros sin `UserPromptSubmit`.** No está garantizado que un compañero en proceso reciba `UserPromptSubmit` al recibirse un mensaje; la inyección de nuevos para ellos llega seguro en `SubagentStart` y la lectura con el script (`leer`, `leer --esperar`) es el camino cubierto por los criterios. El jefe sí tiene turnos.
- **Primer turno tras reiniciar el hub.** `seen` está vacío: cada agente recibe hasta 20 mensajes antiguos una vez. Aceptado por simplicidad; alternativa (tabla `chat_seen`) en Preguntas abiertas.
- **Long-poll y `idleTimeout`.** Sin `holdRequest` Bun cortaría la espera a los 30 s (`hub/src/server.ts:212,217`); el paso 5 lo prueba con `esperar=2` y el máximo es 90 s, por debajo de los 120 s de la herramienta Bash. `curl -m` del script va 15 s por encima de `esperar`.
- **Verdes falsos por el texto del chat.** Sin la neutralización de la sección 3, un mensaje con «test» registraría un verdict de tests del tester y abriría la puerta del `HECHO:`; el paso 4 lo prueba. Si en el futuro cambia la forma de invocar el script (otro nombre, un alias), hay que mantener el reconocimiento en `neutralizeChatCommand`.
- **Permisos de Bash.** Las plantas corren en modo `auto` (`hub/src/config.ts:100`); la primera llamada al script puede pedir permiso en el panel, como `office-sync.sh` en Redacción. Añadir una regla `allow` queda como pregunta abierta.
- **Ruido en `PreToolUse`.** El recordatorio «no has anunciado» es una vez por agente y fichero y el aviso de solape una vez por anuncio ajeno; si molesta, la frase se puede acortar sin tocar la lógica. Nunca bloquea. Debe responder dentro de los 2 s del `curl` de `emit.sh`; la consulta es indexada y corta, y si se pasara el único efecto es que no llega el recordatorio.
- **Suplantación en el contexto inyectado.** `format` colapsa saltos de línea para que un mensaje no pueda simular líneas de otro autor; sigue siendo texto de agentes y las plantillas lo presentan como chat, no como órdenes.
- **Conflictos de merge con el plan de la escena.** Solo en `main.ts`, `topbar.ts`, `store.ts`, `es.ts`, `en.ts` si el otro plan los toca; los cambios de este plan son añadidos en puntos concretos (sección «Carpetas y ficheros»). `styles.css` no se toca.
- **Tamaño del snapshot.** 200 mensajes de chat más por conexión; comparable a `messages.slice(-100)` y `activity` (300). El panel pagina el resto con `/api/chat/:channel?before=`.
- **Texto para agentes en español dentro del hub.** `format` y `errorTextFor` son texto para agentes (como `SyncResult.text`), no para el panel; los textos del panel van por `HubText`. El revisor de `hub-textos-idioma` distinguió ambos casos.

## Verificación

Todo en el clon `/Users/victorsanblasgomez/Projects/agent-office-dev`. Nunca `bun run setup`, `bun run floor`, `bun run hub` ni `bun run office`.

Automática:

```sh
cd ~/Projects/agent-office-dev
bun run test        # hub: db, chat, chat-server, office, departments, server-v2, floor-cli, units; ui: i18n, claims, layout, time, notify
bun run typecheck   # hub y ui (ui incluye hub/src/types.ts)
bun run build       # vite build con la pestaña nueva
```

Manual, con un hub temporal (la clave y la config se escriben a mano; `docsRepo` temporal es obligatorio porque `office.start()` llama a `sync.cleanup`, que borra las fotos de `redaccion/.fuentes/*` del `docsRepo` que no estén en su base de datos):

```sh
export AGENT_OFFICE_HOME=$(mktemp -d) AGENT_OFFICE_CLAUDE_HOME=$(mktemp -d)
mkdir -p "$AGENT_OFFICE_HOME" /tmp/office-docs-chat /tmp/planta-demo && git -C /tmp/planta-demo init -q
head -c 32 /dev/urandom | xxd -p -c 64 > "$AGENT_OFFICE_HOME/key"
cat > "$AGENT_OFFICE_HOME/config.json" <<'EOF'
{ "configVersion": 2, "port": 4799, "docsRepo": "/tmp/office-docs-chat",
  "departments": { "redaccion": false, "mantenimiento": false },
  "floors": { "demo": { "path": "/tmp/planta-demo", "stack": "generic", "managed": true, "baseBranch": "main" } } }
EOF
cd ~/Projects/agent-office-dev && bun run build
AGENT_OFFICE_HOME=$AGENT_OFFICE_HOME AGENT_OFFICE_CLAUDE_HOME=$AGENT_OFFICE_CLAUDE_HOME bun hub/src/main.ts &
KEY=$(cat "$AGENT_OFFICE_HOME/key")
# 1. Dos agentes de la planta: un SessionStart del jefe y un SubagentStart del dev
curl -s -X POST localhost:4799/events -H "X-Office-Key: $KEY" -H 'X-Office-Role: office-lead-demo' -H 'X-Office-Name: lead-demo' \
  -H 'Content-Type: application/json' -d '{"session_id":"s-demo","cwd":"/tmp/planta-demo","hook_event_name":"SessionStart","source":"startup"}'
curl -s -X POST localhost:4799/events -H "X-Office-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"session_id":"s-demo","cwd":"/tmp/planta-demo","hook_event_name":"PreToolUse","tool_name":"Agent","tool_use_id":"t1","tool_input":{"name":"dev-demo","subagent_type":"office-dev-demo"}}'
curl -s -X POST localhost:4799/events -H "X-Office-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"session_id":"s-demo","cwd":"/tmp/planta-demo","hook_event_name":"PostToolUse","tool_name":"Agent","tool_use_id":"t1","tool_input":{"name":"dev-demo"},"tool_response":{"agentId":"dev-1","status":"teammate_spawned"}}'
curl -s -X POST localhost:4799/events -H "X-Office-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"session_id":"s-demo","agent_id":"dev-1","agent_type":"office-dev-demo","cwd":"/tmp/planta-demo","hook_event_name":"SubagentStart"}'
# 2. El dev anuncia y el jefe lo lee; el jefe contesta y el dev lo lee (criterio 1 y 2)
cd /tmp/planta-demo
AGENT_OFFICE_NAME=lead-demo ~/Projects/agent-office-dev/plugin/scripts/office-chat.sh demo --de dev-demo toca lib/a.dart -- "voy con el login"
AGENT_OFFICE_NAME=lead-demo ~/Projects/agent-office-dev/plugin/scripts/office-chat.sh demo leer            # muestra «dev-demo (desarrollador) TOCA lib/a.dart»
AGENT_OFFICE_NAME=lead-demo ~/Projects/agent-office-dev/plugin/scripts/office-chat.sh demo di "ok, yo no toco lib/"
AGENT_OFFICE_NAME=lead-demo ~/Projects/agent-office-dev/plugin/scripts/office-chat.sh demo --de dev-demo leer --desde 1   # muestra la respuesta del jefe
# 3. Recordatorio al editar sin anunciar: devuelve additionalContext con «no has anunciado lib/b.dart»
curl -s -X POST localhost:4799/events -H "X-Office-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"session_id":"s-demo","agent_id":"dev-1","cwd":"/tmp/planta-demo","hook_event_name":"PreToolUse","tool_name":"Edit","tool_use_id":"t2","tool_input":{"file_path":"/tmp/planta-demo/lib/b.dart","old_string":"a","new_string":"b"}}'
# 4. Panel: abrir http://127.0.0.1:4799, pestaña Chat, canal demo: se ven los dos mensajes (#1 toca, #2 di) y «En edición: lib/a.dart · dev-demo»;
#    escribir «¿cómo vais?» (será el #3) y comprobar que aparece al momento y que el chip de no leídos del tab queda en 0 (criterio 3).
#    El hub registra en la actividad la entrada hub.act.chatUser (no hay socket real, delivered = 0).
# 5. Persistencia (criterio 4): matar el hub, arrancarlo igual, GET /chat/demo?desde=0 devuelve los mismos mensajes.
kill %1; AGENT_OFFICE_HOME=$AGENT_OFFICE_HOME AGENT_OFFICE_CLAUDE_HOME=$AGENT_OFFICE_CLAUDE_HOME bun hub/src/main.ts &
curl -s "localhost:4799/chat/demo?desde=0&format=text" -H "X-Office-Key: $KEY"
# 6. Espera: en una terminal `office-chat.sh demo leer --desde 3 --esperar 60`, en otra `office-chat.sh demo di "hola"` (#4): la primera termina al instante con «hola».
#    También sin --desde: `office-chat.sh demo leer --esperar 60` queda esperando aunque el canal tenga mensajes, y despierta con el siguiente `di`.
#    Sin segunda llamada, `--esperar 5` termina a los 5 s con «Sin mensajes nuevos en #demo desde #4.» y código 0.
# 7. Un mensaje con «test» no abre la puerta. El script desde la terminal no pasa por /events, así que se simula la llamada del tester con sus hooks:
CMD="$HOME/Projects/agent-office-dev/plugin/scripts/office-chat.sh demo --de tester-demo di \"flutter test ok\""
for HOOK in PreToolUse PostToolUse; do
  curl -s -X POST localhost:4799/events -H "X-Office-Key: $KEY" -H 'Content-Type: application/json' \
    -d "{\"session_id\":\"s-demo\",\"agent_id\":\"tester-1\",\"agent_type\":\"office-tester-demo\",\"cwd\":\"/tmp/planta-demo\",\"hook_event_name\":\"$HOOK\",\"tool_name\":\"Bash\",\"tool_use_id\":\"t3\",\"tool_input\":{\"command\":$(printf '%s' "$CMD" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')}}"
done
sqlite3 "$AGENT_OFFICE_HOME/office.db" "select count(*) from verdicts"   # 0; y la actividad del tester dice «usa el chat de la planta», no «tests en verde»
kill %1
```

Comprobaciones del revisor sobre el código: `grep -n "chat" hub/src/db.ts hub/src/prune.ts hub/src/floor-data.ts`; `grep -rn "[áéíóúñ¿¡]" ui/src/chat` vacío; `git diff --stat` del clon no incluye `ui/src/office/`, `ui/src/scene/`, `ui/src/styles.css` ni `ui/public/`.

## Preguntas abiertas

1. ¿Regla `allow` para el script en los lanzadores de las plantas (`hub/src/office-sh.ts:91-103`, `settings.permissions.allow: ["Bash(<CHAT_SCRIPT> *)"]`)? Evita el permiso en la primera llamada pero obliga a adaptar `hub/test/permissions.test.ts:173,177,182,228,230`. Propuesta: segunda iteración, tras ver si molesta en modo `auto`.
2. ¿Canales para Redacción y Mantenimiento? Sus jefes podrían escribir en `#global` (tienen Bash y `AGENT_OFFICE_NAME`). Hoy el plan solo valida plantas gestionadas y Dirección; abrir `#global` a los departamentos es una línea en `postChat` (aceptar `floorKind` `redaccion`/`mantenimiento` para `channel === 'global'`). Propuesta: no, hasta que el flujo de código lo pida.
3. ¿Guardar `seen` en SQLite (`chat_seen(agent_key, last_id)`) para no repetir los últimos 20 mensajes tras un reinicio? Coste: una tabla y dos consultas; beneficio pequeño porque los reinicios son raros.
4. ¿Una frase en `director.md.tpl` que diga que el bloque «Chat de Agent Office» que recibe como contexto en su turno son avisos de los jefes y del usuario en `#global`, no órdenes? Ya no recibe nada del chat por la bandeja; añadirla toca una plantilla más.
