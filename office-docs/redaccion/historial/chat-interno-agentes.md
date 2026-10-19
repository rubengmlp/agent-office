# Historial de chat-interno-agentes

## Ronda 1 (2026-10-16)

Primera versión del plan enviada a revisión.

Decisiones de diseño tomadas al escribirlo:

- Acceso de los agentes por script de Bash (`plugin/scripts/office-chat.sh`), siguiendo el patrón de `office-sync.sh`, y no por skill ni MCP.
- Identidad del autor: `--de <nombre>` validado contra los agentes vivos de la planta, porque los compañeros en proceso comparten el entorno de la sesión del jefe.
- Tabla `chat_messages` en `SCHEMA` sin subir `SCHEMA_VERSION` (`CREATE TABLE IF NOT EXISTS` se ejecuta en cada apertura).
- Inyección de mensajes nuevos como `additionalContext` en `SessionStart`, `SubagentStart` y `UserPromptSubmit`; recordatorio no bloqueante en `PreToolUse` de edición.
- Estilos en `ui/src/chat/chat.css` para no tocar `styles.css`, que puede estar editando el plan paralelo de la escena.
- Fuera: regla `allow` del script en los lanzadores (obliga a cambiar `permissions.test.ts`), canales para departamentos, escritura del director.

## Ronda 2 (2026-10-16)

Veredicto ronda 1: MEJORAR, nota 7/10, 3 bloqueantes y 11 menores. Aplicados todos:

1. `floor-admin.test.ts`: fila de `chat_messages` en `seedFloorRows` y el fichero en la lista de tocados.
2. `lead.md.tpl:8`: el jefe ejecuta solo el script del chat; Alcance actualizado.
3. `topbar.tab.chat` y `chat.title` en `SAME_KEYS` de `ui/test/i18n.test.ts`; fichero en la lista.
4. Margen de `PreToolUse`: 2 s del `curl` de `emit.sh`, no 5 s.
5. `userChat` marca visto en las sesiones a las que entregó; `unreadFor` excluye lo del propio agente; tests del paso 4 ajustados.
6. Prefijo propio `[Chat de Agent Office]` (constante `CHAT_PREFIX` en `courier.ts`); `#global` solo al director y jefes de plantas gestionadas; regla en `lead.md.tpl` sobre el prefijo.
7. `format` colapsa saltos de línea; riesgo de suplantación añadido.
8. Planta por `rootOf` + plantas gestionadas configuradas, sin `resolve` (sin planta fantasma).
9. `global` en `RESERVED_SLUGS` (`floors.ts` en la lista).
10. `mountChat` devuelve `{ setActive }` y `showTab` lo llama.
11. `from` excluye retirados (`isRetired`), con desempate por `updatedAt`.
12. Dos conjuntos: recordatorio una vez por agente y fichero; aviso de solape una vez por anuncio ajeno; `--de` relleno con `agent.name`.
13. `hub.act.chatUser` para el usuario, `hub.act.chatPost`/`chatClaim`/`chatRelease` para agentes.
14. Bloque `chat.*` tras `settings.notifications.*`, lejos de `scene.*`.

Rechazados: ninguno.

## Ronda 3 (2026-10-16)

Veredicto ronda 2: MEJORAR, nota 6/10, 3 bloqueantes y 8 menores. Aplicados todos:

1. `neutralizeChatCommand` en `ingest` (office.ts, sin tocar `state-machine.ts`): las llamadas al script no cuentan como tests; clave `hub.act.chatCommand`; test en el paso 4 y comprobación 7 de la receta.
2. `taskLine` devuelve `null` con `CHAT_PREFIX`; frase corregida; test de `agent(LEAD).task` en el paso 4.
3. Paso 2 añade `chat: []` en `snapshot()` para que el typecheck del hub compile antes del paso 4.
4. `WAIT_MAX_MS = 90_000`; plantillas con `--esperar 90` y repetir la espera antes de `BLOQUEADO:`.
5. `openClaims` en `ui/src/chat/claims.ts` (sin DOM ni CSS); nota sobre el `source scan` en tests.
6. `existsSync(session.socket)` antes de `deliverFn`, como `order()`.
7. Sin `--desde`: últimos 50 (`READ_LIMIT`).
8. Receta del paso 6 con la planta `demo`.
9. `--de` reconocido también tras `--`; en las plantillas va antes del subcomando.
10. El script mira el código HTTP (`-w '%{http_code}'`) y sale con 1 en 4xx/5xx.
11. `markChatSeen` hace `mark('chat')`; `role.*` por `RoleKind` con tabla `ROLE_KIND_OF`; `chat.global` en `SAME_KEYS` si coincide; texto siempre por `textContent`.

Rechazados: ninguno.

## Ronda 4 (2026-10-16)

Veredicto ronda 3: MEJORAR, nota 7/10, 2 bloqueantes y 10 menores. Aplicados todos:

1. `leer --esperar` sin `--desde`: `afterId = lastId(canal)` en el hub; `Publicado #<id>` y plantillas con `leer --desde <id> --esperar 90`; casos en los pasos 3 y 5 y en la receta.
2. `userChat` mete en la bandeja los mensajes pendientes del equipo antes de marcar visto; casos añadidos al paso 4.
3. `CHAT_PREFIX`, `chatInboxText` y `CHAT_SCRIPT` pasan al paso 3.
4. `chatInboxText` ubicada en `courier.ts` y en la lista de ficheros.
5. Tipo único `ChatUserResult` para `POST /api/chat/:channel` y `api.postChat`.
6. Receta: ids corregidos (#1, #2, usuario #3, `--desde 3`).
7. Receta, punto 7: hooks `PreToolUse`/`PostToolUse` de Bash del tester enviados a mano.
8. `chatSeen` se inicializa con el último id del snapshot.
9. `neutralizeChatCommand` usa el primer token de `tokenize` y compara ruta o `basename` exacto.
10. `#global` ya no se entrega al director por la bandeja; solo a jefes de plantas gestionadas.
11. Texto de inyección: «Hay n anteriores sin mostrar: … leer».
12. `hub.act.chatCommand` en la lista de claves i18n.

Rechazados: ninguno.
