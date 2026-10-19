# Avisos de escritorio

## Contexto

Cuando un agente necesita al usuario (permiso, pregunta, `BLOQUEADO:`, entrega, plan o skill que aprobar), hoy solo se entera si está mirando el panel. Peor: el hub solo retiene permisos y preguntas en el panel si alguien lo ha tenido visible en los últimos 30 s (`desk.someoneWatching()`, `hub/src/office.ts:387` y `:403`; `VISIBLE_WINDOW_MS`, `hub/src/questions.ts:4`), y `sweep()` devuelve al terminal todo lo pendiente cuando nadie mira (`hub/src/questions.ts:69-72`). La UI solo manda latido con la pestaña visible (`ui/src/heartbeat.ts:22-25`). Con el panel en segundo plano, un permiso ni siquiera llega al panel.

Base sobre la que se escribe:

- agent-office-dev `build/v1` @ `7480a64` (2026-10-16)

Desde el último plan sobre esta planta (`61f915e..7480a64`): permisos desde el panel y modos de permisos por sesión (`ba59f6a`), fuentes conservadas y jefes restaurados al reiniciar el hub (`f59facc`, `7480a64`). Este plan se apoya en el primero: `QuestionDesk` con `kind: 'permission'` y `permissionHolds`.

Orden de ejecución acordado: 1º `panel-i18n-ayuda`, 2º `ajustes-gestion-proyectos-2`, 3º este plan. Las referencias `ruta:línea` son de la foto `7480a64`; quien lo ejecute las encontrará desplazadas por los dos anteriores.

## Objetivo

Que macOS avise al usuario cuando la oficina tiene algo pendiente para él aunque el panel esté oculto, en otra pantalla o en otro escritorio; que un clic en el aviso lleve al elemento pendiente; que cada evento avise una sola vez; y que se active, desactive y filtre por tipo de evento desde Ajustes.

## Alcance

Entra:

- Inventario de eventos del hub que avisan (D4) y tests del hub de que se emiten.
- Avisos con la Notification API del navegador del panel, con su permiso pedido desde Ajustes (D1, D6).
- El hub retiene permisos y preguntas en el panel cuando hay un panel capaz de avisar de ellos aunque esté oculto (D2).
- Sección "Avisos de escritorio" en Ajustes: interruptor general, uno por evento y botón "Probar" (D6).
- Clic en el aviso: trae el panel al frente y selecciona al agente o abre el documento (D5).
- README.

Queda fuera:

- Notificación nativa desde el hub (osascript, terminal-notifier): ver Preguntas abiertas.
- Móvil, correo, otras plantas, gestión de plantas (`redaccion/planes/ajustes-gestion-proyectos-2.md`), idioma y textos de ayuda (`redaccion/planes/panel-i18n-ayuda.md`).
- Botones de acción dentro del aviso (Permitir/Denegar): la Notification API de página no los tiene; solo los service workers.
- Avisar de permisos que ya se resolvieron en el terminal porque no había panel capaz de avisar.

## Diseño

### D1. Notification API del navegador, no notificación nativa desde el hub

El aviso lo crea el panel con `new Notification(...)`: el clic enfoca por defecto la pestaña que lo creó y el manejador selecciona el elemento ([MDN: click](https://developer.mozilla.org/en-US/docs/Web/API/Notification/click_event)), `tag` sustituye avisos iguales ([MDN: tag](https://developer.mozilla.org/en-US/docs/Web/API/Notification/tag)), el navegador los entrega al Centro de notificaciones, y `http://127.0.0.1` es contexto seguro ([MDN: Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)). Una `display notification` de osascript no enlaza a nada y terminal-notifier sería una dependencia externa. Coste: el permiso hay que pedirlo desde un gesto del usuario ([MDN: requestPermission](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static)); de ahí el interruptor de Ajustes (D6).

### D2. El hub retiene la pregunta si hay un panel que avisará de ella

Sin esto el criterio 1 es imposible: con el panel oculto, `permission()` devuelve `null` y el diálogo sale solo en el terminal. Cambio mínimo:

- `hub/src/types.ts:322`: `{ type: 'heartbeat'; visible: boolean; notify?: boolean }`.
- `ui/src/heartbeat.ts`: `new Heartbeat(send, notify: () => boolean = () => false)`; `pulse()` envía siempre `{ visible: document.visibilityState === 'visible', notify }` (hoy calla si está oculto, `:23`). Además, en `freeze` (Page Lifecycle, Chrome) envía `{ visible: false, notify: false }` y en `resume` vuelve a `pulse()`: una pestaña congelada no puede avisar.
- `notify` = `notifier.active()`: general activado, `Notification.permission === 'granted'` **y los eventos `permiso` y `pregunta` activos**. Si el usuario apaga uno de los dos, el panel oculto deja de retener ambos: una `AskUserQuestion` retenida sin aviso quedaría parada hasta `HOLD_MS` sin diálogo en el terminal (el hook `PreToolUse` la bloquea, `plugin/hooks/hooks.json:36-45`), mientras que el permiso sí sigue viéndose en el terminal (`hub/src/office.ts:753-762`). Se descarta `notify?: QuestionKind[]` con `someoneWatching(kind)`: más código y tests para un ajuste que casi nadie separará.
- `hub/src/server.ts`: `WsData` (`:12`) gana `notify: boolean` (también en el `upgrade`, `:193`); en `message` (`:219`) `ws.data.notify = msg.notify === true` y `office.heartbeat(msg.visible, notifiers())`, con `notifiers = [...clients].filter((c) => c.data.notify).length`; en `close` (`:221-224`) se vuelve a llamar con el recuento sin ese socket; `parseClientMessage` (`:311`) lee `notify`.
- `hub/src/office.ts:439-441`: `heartbeat(visible: boolean, notifiers = 0)`.
- `hub/src/questions.ts:31-37`: `heartbeat(visible, notifiers = 0)` guarda `this.notifiers`; `someoneWatching()` = visible reciente `||` `this.notifiers > 0`. `sweep()`, `ask()` y `permission()` no cambian.

Recuento por socket y no otra ventana de tiempo: Chrome ejecuta los temporizadores de una pestaña oculta más de 5 minutos una vez por minuto ([Chrome: timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)); el socket, en cambio, lo mantiene vivo Bun con pings automáticos que el navegador contesta sin JavaScript (`idleTimeout` 120 s, `sendPings` por defecto, [Bun: WebSockets](https://bun.com/docs/api/websockets)). Si la pestaña se cierra o Chrome la descarta, el socket cae, `notifiers` baja a 0 y el siguiente `tick` devuelve lo pendiente al terminal como hoy. `HOLD_MS` (`hub/src/questions.ts:7`) no cambia: sin reacción en ~15 min, caduca y sale en el terminal.

### D3. Preferencias en el navegador, no en `config.json`

`localStorage['agent-office.notify']` → `{ enabled: boolean; events: Record<NotifyEvent, boolean> }`, validado al leer; por defecto `enabled: false` y todos los eventos activos. Motivos: el permiso del navegador es por origen y perfil, así que la preferencia vive en el mismo ámbito; un interruptor no debe regenerar agentes ni decir "agentes regenerados" (`createSettings.update` siempre llama a `regenerateAgents`, `hub/src/settings.ts:134`); y así no se toca `hub/src/settings.ts` ni `hub/src/config.ts`, ni `ui/src/settings/draft.ts` y `options.ts`, que reescribe `panel-i18n-ayuda`. Coste: cada navegador se configura por su cuenta.

### D4. Inventario de eventos

Todo sale del flujo `ServerMessage` que ya recibe la UI (`ui/src/main.ts:107`). Nuevo `ui/src/notify.ts` con `class Notifier { observe(message: ServerMessage): void; active(): boolean; onChange: () => void }`:

| Evento | Mensaje del hub | Título / cuerpo | `tag` | Clic |
|---|---|---|---|---|
| `permiso` | `question` con `kind: 'permission'` (`hub/src/office.ts:1252`) | "Permiso pendiente · {agente}" / `detail` | `question:{id}` | `store.select(agentKey)` |
| `pregunta` | `question` sin `kind` | "Pregunta de {agente}" / primera `question` | `question:{id}` | `store.select(agentKey)` |
| `bloqueo` | `message` cuyo `text` cumple `/^\s*BLOQUEADO\s*:/i` (espejo de `BLOCK_PREFIX`, `hub/src/state-machine.ts:62`; emitido en `hub/src/office.ts:1132`) | "Bloqueado: {agente}" / resto del texto | `message:{id}` | `store.select(fromKey)` |
| `entrega` | `message` con `/^\s*HECHO\s*:/i` y remitente con `roleKind === 'lead'` (`store.agents.get(fromKey)`; jefes de planta, Redacción y Mantenimiento, `hub/src/scope.ts:10,13,49`) | "Entrega de {agente}" / resto | `message:{id}` | `store.select(fromKey)` |
| `documento` | `documents` (`hub/src/office.ts:259`; solo se emite si la lista cambió, `hub/src/documents.ts:78-83`): un documento pasa a `aprobado` o `sin-acuerdo` respecto a la lista anterior, el mismo criterio que `watchApprovals` (`ui/src/panel/deliverables.ts:229-246`), que sigue dando su toast | "Plan aprobado: {título}" · "Skill aprobada: …" · "Sin acuerdo en {título}" | `document:{path}:{status}:{round}` | `openDocument(store, doc)` (`ui/src/panel/deliverables.ts:207`) |
| `guardia` | `alert` con `level: 'alerta'` (`hub/src/office.ts:714`) | "Alerta en {planta}" / N ficheros sin atribuir | `alert:{id}` | `store.select(agentKey)` |

{agente} = `agentName(store.agents.get(key))` (`ui/src/labels.ts:111`) o la `key` corta. Las expresiones `BLOQUEADO`/`HECHO` son protocolo: se copian en `notify.ts` y no se traducen (`hub/src/state-machine.ts` importa `node:path` y no carga en el navegador).

Reglas de emisión, para que un evento avise una vez:

- Historia no avisa: los `messages` del `snapshot` se ignoran; la primera lista de `documents` (del `snapshot` o del primer mensaje `documents`) solo siembra el mapa `path → status`. Las `questions` del `snapshot` sí avisan si no se han visto: están pendientes por definición (cubre reconexión y reinicio del hub).
- `seen: Set<tag>` acotado a 500 entradas, además del `tag` del navegador. La clave `path:status:round` hace que una aprobación en ronda 3 tras volver a revisión sí avise.
- No se avisa si `document.visibilityState === 'visible' && document.hasFocus()`: el panel ya lo muestra (botón "Preguntas pendientes", `ui/src/topbar.ts:64-69`; toasts). Visible en otra pantalla sin foco sí avisa.
- `question-closed` cierra el `Notification` de esa pregunta (`Map<tag, Notification>` → `close()`).
- Sin `renotify`: sustituir por `tag` no vuelve a sonar.

### D5. Clic en el aviso

`notification.onclick`: `window.focus()` (refuerza el comportamiento por defecto; sin `preventDefault`), luego `store.select(key)` para agentes (lo que hace el botón de pendientes, `ui/src/topbar.ts:54-57`; el formulario de pregunta sigue a la selección, `ui/src/panel/question-form.ts:195-212`) o `openDocument(store, doc)` para documentos (modal independiente de la selección). El panel lateral está fuera de las pestañas (`ui/src/main.ts:58`). Si el elemento ya no existe, solo enfoca.

### D6. Ajustes y textos

Nuevo `ui/src/settings/notifications.ts` con `mountNotifySection(notifier: Notifier): HTMLElement`. En `ui/src/settings/settings.ts`: `toggleRow` (`:83`) pasa a exportarse (con la firma que deje i18n), `mountSettings` (`:454`) gana `notifier: Notifier | null = null`, y `buildControls` (`:365`) añade la sección al final del `settings-form`, después de `hub` y del `projectsHost` que inserta `ajustes-gestion-proyectos-2` en esa misma línea: `el('div', 'settings-form', fieldset, this.projectsHost, hub, notifyHost)`. Fuera del `fieldset` y del borrador: efecto inmediato, sin "Guardar" (como borrar una lección y como el alta/baja de plantas). `buildControls` se repite al cambiar la firma (`:205-210`: plantas, puerto, modos, y con i18n el idioma), así que `mountNotifySection` es sin estado: lee `notifier` y `Notification.permission` al construirse y no registra escuchas en `notifier` ni en `document`.

Contenido:

- Interruptor "Avisar en el escritorio". Al activarlo, dentro del manejador del clic: si `typeof Notification === 'undefined'`, deshabilitado con "Este navegador no tiene avisos de escritorio"; si `permission === 'denied'`, vuelve a apagado con "El navegador tiene bloqueados los avisos de esta página: permítelos en los ajustes del sitio y vuelve a activarlos"; si `'default'`, `await Notification.requestPermission()` y solo queda activo con `'granted'`. El estado del permiso va en la pista del interruptor.
- Un interruptor por evento (los seis de D4), deshabilitados con el general apagado. Pista bajo `permiso` y `pregunta`: "Con el panel oculto, el hub retiene permisos y preguntas en el panel solo si estos dos avisos están activos; si apagas uno, vuelven a la terminal".
- Botón "Probar": aviso "Agent Office avisa aquí" con `tag: 'test'`, para ver si macOS lo muestra (Concentración, permisos del navegador en Ajustes del Sistema).
- Cualquier cambio llama a `notifier.save()`, que dispara `notifier.onChange` (→ `heartbeat.pulse()`, D7).

Textos: `panel-i18n-ayuda` va antes, así que todas las cadenas nuevas entran en `ui/src/i18n/es.ts` y `en.ts` con las claves `notify.{permission,question,blocked,done,alert}.title`, `notify.document.{approvedPlan,approvedSkill,noAgreement}`, `notify.alert.files.{one,other}`, `notify.test` y `settings.notifications.{title,hint,enable,unsupported,denied,granted,holdHint,test,event.*}`; se pintan con `t()` en el momento de emitir o construir (no al cargar el módulo), para que el idioma cambie en caliente, y el rastreo de `ui/test/i18n.test.ts` (ningún literal con tilde fuera de `i18n/`) tiene que pasar. "Agent Office" ya está en `SAME_IN_BOTH`. Si por calendario este plan fuera antes, las cadenas irían en constantes de los dos ficheros nuevos y i18n las movería como paso extra (su D10 lo prevé).

### D7. Arranque y replay

`ui/src/main.ts`: `const notifier = api ? new Notifier(store) : null` antes de `mountSettings(settingsHost, store, api, notifier)` (`:65`); `onMessage: (m) => { store.apply(m); notifier?.observe(m); }` (`:107`); `new Heartbeat(send, () => notifier?.active() ?? false)` y, tras crearlo (`:101`), `if (notifier) notifier.onChange = () => heartbeat.pulse()`. En replay o sin key no hay avisos ni sección.

### D8. Ficheros que toca este plan (coordinación)

| Fichero | Cambio |
|---|---|
| `hub/src/types.ts` | `notify?` en el latido de `ClientMessage` (`:322`) |
| `hub/src/questions.ts` | `heartbeat(visible, notifiers)`, `someoneWatching()` |
| `hub/src/office.ts` | firma de `heartbeat` (`:439`) |
| `hub/src/server.ts` | `WsData.notify` (`:12`, `:193`), recuento en `message`/`close`, `parseClientMessage` |
| `hub/test/permissions.test.ts`, `hub/test/office.test.ts`, `hub/test/server.test.ts`, `hub/test/departments.test.ts` | tests de Pasos |
| `ui/src/notify.ts`, `ui/src/settings/notifications.ts` | nuevos |
| `ui/src/i18n/es.ts`, `ui/src/i18n/en.ts` | claves de D6 (ficheros que crea i18n) |
| `ui/src/heartbeat.ts`, `ui/src/main.ts` | D2, D7 |
| `ui/src/settings/settings.ts` | `export` en `toggleRow`, parámetro `notifier`, `notifyHost` al final de `settings-form` |
| `ui/src/styles.css` | `.notify-events` junto a `.setting-row` (`:982`) |
| `README.md` | viñetas de "Uso" (`:98`, `:101`) y una nueva "Avisos de escritorio" |

No toca `hub/src/settings.ts`, `hub/src/config.ts`, `hub/src/floor-cli.ts`, `ui/src/settings/draft.ts`, `ui/src/settings/options.ts` ni `ui/src/api.ts`.

## Pasos

1. `hub/src/types.ts`, `hub/src/questions.ts`, `hub/src/office.ts`: `notify` en el latido y `notifiers` en el mostrador (D2). Verificable: en `hub/test/office.test.ts`, tras "a hidden tab does not count as watching" (`:263`), test "a hidden tab that can notify counts as watching": `heartbeat(false, 1)` → `ask()` queda pendiente y `snapshot().questions` la lista; `heartbeat(false, 0)`, `clock.advance(31_000)`, `tick()` → `await pending` es `null` y hay `question-closed` con `released`.
2. `hub/test/permissions.test.ts`: test "a permission is held and emitted only for a hidden panel that can notify": `watched()`, `h.clock.advance(31_000)` (caduca el latido visible de `:23`); con `notifiers` 0, `permission(request(repo, 'ls'))` devuelve `null`; `heartbeat(false, 1)`; `permission(request(repo, 'bun run hub'))` pendiente; `h.messages` contiene `{ type: 'question', data: { kind: 'permission', detail: 'bun run hub', agentKey: LEAD } }`; `answer(…, 'Permitir')` resuelve `allow`. El test de `:67` sigue en verde.
3. `hub/src/server.ts` (D2). Verificable: en `hub/test/server.test.ts`, tras `:127`, test "a hidden panel that can notify keeps the desk watching until its socket closes": `h.clock.advance(31_000)`; `expect(h.office.desk.someoneWatching()).toBe(false)`; socket autenticado envía `{ type: 'heartbeat', visible: false, notify: true }` → `until(() => someoneWatching())`; `ws.close()` → `until(() => !someoneWatching())`.
4. `hub/test/office.test.ts`: test "the panel receives the BLOQUEADO and HECHO messages it notifies about": `SendMessage` `BLOQUEADO:` de `adev-1` → `h.messages` tiene `{ type: 'message', data: { fromKey: 'adev-1', text: /^BLOQUEADO:/ } }` y `{ type: 'agent', data: { key: 'adev-1', state: 'blocked' } }`; `SendMessage` `HECHO:` del jefe → `message` con `fromKey: LEAD` y el `agent` de LEAD con `roleKind: 'lead'`.
5. `hub/test/departments.test.ts`: en el test de rondas (`:109`), tras la aprobación (`:142`) y el sin acuerdo (`:169`), comprobar que el último `documents` de `h.messages` lista el plan con ese `status` y `round`. Verificable: `bun test test/departments.test.ts`.
6. `ui/src/i18n/{es,en}.ts` con las claves de D6; `ui/src/notify.ts` (D3, D4, D5); `ui/src/heartbeat.ts` con el segundo parámetro opcional (D2). Verificable: `bun run typecheck` (el `main.ts` antiguo sigue compilando) y `cd ui && bun test` (rastreo de i18n).
7. `ui/src/settings/notifications.ts`, `ui/src/settings/settings.ts` con `notifier` opcional, `ui/src/styles.css` (D6). Verificable: `bun run typecheck`, `bun run build`.
8. `ui/src/main.ts` (D7). Verificable: `bun run build`; prueba manual de Verificación.
9. README, en "Uso": "Preguntas" (`:98`) cambia "Con la pestaña oculta o cerrada salen en la terminal como siempre" por "… salvo que ese navegador tenga activados los avisos de escritorio de permiso y pregunta: entonces se retienen en el panel y el aviso te lleva a ellas"; "Permisos" (`:101`) añade antes de su última frase "Con la pestaña oculta también salen en el panel si tienes activados los avisos de escritorio", conservando "La terminal sigue mostrando el diálogo: vale la primera respuesta"; viñeta nueva "Avisos de escritorio" con los seis eventos, dónde se activan y que la preferencia es por navegador. Verificable: lectura.

## Riesgos

- Concentración de macOS o navegador sin permiso en Ajustes del Sistema: `Notification.permission` es `granted` pero no se ve nada. Un permiso retenido sigue visible en el terminal (vale la primera respuesta); una pregunta retenida espera en silencio hasta `HOLD_MS` (~15 min) y entonces sale en el terminal. Mitigación: botón "Probar" y la nota del README.
- Pestaña oculta mucho tiempo: Chrome puede congelarla (Memory Saver) y Safari aplicarle App Nap; no se puede comprobar offline. Si se descarta, el socket cae y el hub vuelve al terminal; si se congela, el aviso `freeze` retira el `notify` (D2); si una pestaña dormida no fuera capaz de avisar sin que el hub lo sepa, lo pendiente espera hasta `HOLD_MS`. La Verificación incluye un paso con el panel oculto más de 5 minutos.
- Una `entrega` avisa del `HECHO:` del jefe aunque la puerta de tests lo rechace después: el mensaje se registra en `ingest` (`hub/src/office.ts:372`) con independencia de `gateMessage` (`:853`). Se acepta: la cronología muestra "entrega bloqueada" y el aviso no afirma más que lo que el jefe dijo.
- El cuerpo del aviso de permiso lleva `detail` (el comando o el fichero) al Centro de notificaciones, visible con la pantalla bloqueada si macOS muestra previsualizaciones. Es el mismo dato que ya pinta el panel; quien no lo quiera ahí puede ocultar previsualizaciones en Ajustes del Sistema.
- Dos pestañas del panel con avisos: cada una crea su `Notification`; el Centro de notificaciones mostrará dos. Raro y sin más consecuencia.
- Safari: `requestPermission` devuelve promesa en versiones actuales (MDN marca el callback como obsoleto). No se añade compatibilidad con el callback.
- Latidos ocultos nuevos (`visible: false`): el servidor ya los acepta (`hub/src/server.ts:311`) y `lastVisibleAt` no cambia; sin avisos activados nada cambia.
- Un mensaje con `text` `null` (plantas observadas, `publicText`) nunca avisa: es lo deseado.

## Verificación

Automática, en el clon (`CLAUDE.md:17`):

```sh
bun run test            # hub (office, permissions, server, departments) y ui (i18n)
bun run typecheck       # hub y ui
bun run build
```

Manual, con hub aislado (`CLAUDE.md:18`), nunca contra `~/.config/agent-office` y sin `bun run setup` (prohibido, `CLAUDE.md:11`, e instala el plugin en el `~/.claude` real). `bun run build` está permitido; `bun hub/src/main.ts` es regla `ask` (`plugin/settings/clone-permissions.json:15`): el usuario lo aprueba en el panel.

```sh
H=$(mktemp -d); C=$(mktemp -d); D=$(mktemp -d); R=$(mktemp -d)
openssl rand -hex 32 > $H/key        # readKey acepta cualquier texto (hub/src/config.ts:246)
echo '{"port":4799,"docsRepo":"'$D'","departments":{"redaccion":false,"mantenimiento":false},"floors":{"demo":{"path":"'$R'","stack":"generic","managed":true,"baseBranch":"main"}}}' > $H/config.json
bun run build
AGENT_OFFICE_HOME=$H AGENT_OFFICE_CLAUDE_HOME=$C bun hub/src/main.ts &
KEY=$(cat $H/key); U='http://127.0.0.1:4799'
post() { curl -s -X POST "$U/$1" -H "X-Office-Key: $KEY" -H 'X-Office-Role: office-lead-demo' -H 'X-Office-Name: lead-demo' -H 'Content-Type: application/json' -d "$2"; }
post events '{"session_id":"demo-1","cwd":"'$R'","hook_event_name":"SessionStart"}'
```

1. Abrir `$U` en Chrome y en Safari; Ajustes → "Avisar en el escritorio" → el navegador pide permiso → "Probar" muestra el aviso en macOS.
2. Mover la ventana a otro escritorio o taparla. `post permission '{"session_id":"demo-1","cwd":"'$R'","hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"rm -rf build"}}'` (el curl queda esperando): aparece "Permiso pendiente · lead-demo" en macOS; clic → el panel viene al frente con la tarjeta de permiso; "Permitir" → el curl devuelve `allow`. Criterio 1.
3. `post events '{"session_id":"demo-1","cwd":"'$R'","hook_event_name":"PreToolUse","tool_name":"SendMessage","tool_input":{"to":"director","message":"BLOQUEADO: falta la key — necesito la key de backend"}}'` con el panel oculto: aviso "Bloqueado: lead-demo"; repetir el mismo `post`: avisa otra vez porque es otro mensaje; recargar el panel: no avisa de los mensajes del snapshot. Criterio 2.
4. Con el panel visible y con foco, repetir el paso 3: no hay aviso de escritorio, solo el panel.
5. Apagar el interruptor general, esperar 30 s con el panel oculto y repetir el paso 2: no hay aviso y el permiso sale en el terminal (el curl recibe cuerpo vacío al momento). Criterio 3.
6. Encender el general, desmarcar solo "bloqueo" y repetir el paso 3: sin aviso. Desmarcar "pregunta", panel oculto 30 s, `post ask '{"session_id":"demo-1","cwd":"'$R'","hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","tool_use_id":"q-1","tool_input":{"questions":[{"question":"¿Seguimos?","options":[{"label":"Sí"},{"label":"No"}]}]}}'`: cuerpo vacío al momento (nada retenido sin aviso).
7. Con todo activo, dejar el panel oculto más de 5 minutos en Chrome y repetir el paso 2; luego lo mismo en Safari. Si no aparece el aviso o el curl no queda esperando, anotarlo en Riesgos y en el README.

## Preguntas abiertas

- Sin ningún panel abierto no hay aviso de ningún tipo. Una notificación nativa desde el hub (`osascript -e 'display notification'`) cubriría ese hueco, pero sin clic útil y con el diálogo ya en el terminal. Se deja para otra iteración si el usuario la quiere.
- "guardia" (alertas de ficheros sin atribuir) va activo por defecto como el resto. Si resulta ruidoso, cambiar su valor por defecto es una línea en `ui/src/notify.ts`.
- Las entregas `HECHO:` de redactores y artesanos no avisan por sí mismas: su resultado llega como "documento" aprobado. Si el usuario quiere también el texto de la entrega, basta ampliar la condición de `entrega` a `roleKind` `writer`/`skillwright`.

## Historial de revisión

- Ronda 1: versión inicial.
- Ronda 2 (revisor, nota 7/10; y jefe de Redacción). Aplicados: (1) `notify` exige también los eventos `permiso` y `pregunta`, con pista en Ajustes y paso 6 de Verificación; se descarta `notify?: QuestionKind[]` por coste (D2). (2) Receta manual sin `bun run setup`: key a mano, `bun run build`, `bun hub/src/main.ts` con las dos variables, `departments` apagados y `docsRepo` temporal. (3) Orden de ejecución fijado por el jefe (i18n, gestión, avisos): textos en `es.ts`/`en.ts` con `t()` al emitir; regla para el orden inverso en una línea (D6). (4) README `:101` conserva su última frase; Riesgos distingue permiso (diálogo visible) de pregunta (retenida). (5) Test del paso 2 avanza el reloj y comprueba el contraste con `notifiers` 0. (6) Parámetros opcionales en `Heartbeat` y `mountSettings`; orden en `main.ts` (D7). (7) Sección sin estado (D6). (8) Posición tras `hub` y `projectsHost`; cita a `ajustes-gestion-proyectos-2`; `draft.ts`/`options.ts` solo los toca i18n. (9) `documents` solo se emite si cambia; `watchApprovals` citado; `WsData` en `:193`. (10) Riesgo y paso 7 de Verificación con el panel oculto más de 5 minutos, más `freeze`/`resume` en el latido. (11) Riesgos de entrega rechazada por la puerta y de `detail` en pantalla bloqueada. D1 y D2 resumidos a una frase por cita. Rechazados: ninguno.
