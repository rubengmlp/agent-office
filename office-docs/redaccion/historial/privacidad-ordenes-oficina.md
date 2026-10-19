# Historial: privacidad-ordenes-oficina

Base: agent-office-dev build/v1 @ 7c89614 (2026-10-16).

## Ronda 1 (2026-10-16)

Plan escrito desde el brief del jefe de Redacción (M3 + M9 + README de la auditoría). Decisiones tomadas al redactar:

- La pertenencia a la oficina se decide en una sola función de `Office` (`sessionInOffice`) que sustituye a `inScope` y añade `agent_type` del primer evento de la sesión principal como tercera fuente del rol, porque la fixture real `team-sandbox.json` no lleva cabecera y el jefe se reconoce por `agent_type`.
- La privacidad se aplica con un «tipo de planta efectivo» (`visibleKind`) en vez de cambiar la firma de las funciones de `privacy.ts`, para cubrir con un cambio todos los usos de `kind` en `ingest`.
- El test `a managed floor keeps the full event` (`office.test.ts:63-70`) se adapta con `leadMeta`: representa una sesión de la oficina.
- El filtro del selector se extrae a `ui/src/panel/orderable.ts` para poder probarlo sin DOM.
- Las filas antiguas de `reports` de sesiones personales quedan como pregunta abierta.
- Antes de enviar, los planes de M1+M2 (`puerta-tests-cambios-reales.md`) y M13 (`tope-rondas-oficina.md`) ya existían en `planes/`: la sección de convivencia cita lo que declaran sus tablas de ficheros en ese momento (M1+M2: `ingest` tras `:429`, `trackChanges`, `ownerEdits`, `gate`, `gateMessage`; M13: `gateMessage`, `gateReview`, `handleProtocol`, `DocumentDesk`). Hay que releerlas en cada ronda.

Enviado a revisión. Veredicto: MEJORAR, nota 7/10, 2 bloqueantes y 5 menores.

## Ronda 2 (2026-10-16)

Aplicados los siete puntos:

1. (bloqueante) `touchSession` fija `session.role` desde `agent_type` en eventos de la sesión principal, antes de persistir y emitir; test nuevo (`office: true` en el último mensaje `session`, rol en `sessions`, payload del subagente conservado). Elegido frente a «volver a emitir la sesión cuando cambie `sessionInOffice`» porque además arregla `restoreSessions`.
2. (bloqueante) `decidePlan` trata `'not-office'` como `'no-director'`; añadido a la tabla de Diseño y a la de ficheros.
3. (menor) `leadRole` con el mismo fallback que `gate()` (`535`).
4. (menor) Pasos 5 y 11 y Verificación: tests commiteados primero, corrección sin commitear hasta pasar la prueba de `git stash`.
5. (menor) Texto del paso 3 corregido: el test falla en `toMatchObject({ office: false })`.
6. (menor) README matizado (título de sesión y asunto de tareas sí se guardan; `ignore` no crea agente ni eventos) y riesgo nuevo.
7. (menor) `README.md:187` nombra la entrada «Permisos» sin número de línea.

Ningún punto rechazado. Veredicto: MEJORAR, nota 6/10, 3 bloqueantes y 4 menores.

## Ronda 3 (2026-10-16)

Aplicados los siete puntos:

1. (bloqueante) Las dos claves `hub.*` entran en `HubTextParams` (`types.ts:148,158`); añadido al Diseño, al paso 6 y a la tabla de ficheros.
2. (bloqueante) El tercer test usa un predicado de tipo `m is Extract<ServerMessage, { type: 'session' }>`.
3. (bloqueante) `storeReport` conserva su firma y comprueba la sesión dentro, cubriendo `455`, `1126` y `1582`; el primer test añade un `SessionEnd` (5 eventos, 0 filas en `reports`).
4. (menor) Modo `ignore`: sale tras `classify` y cierra la sesión si `c.sessionEnded`.
5. (menor) El tercer test reinicia de verdad con un segundo `Office` sobre la misma BD y un socket existente.
6. (menor) Re-emisión de la vista de sesión en `touchAgent` al fijar el rol del principal; el caso del compañero con sesión propia va a Riesgos.
7. (menor) Receta visual corregida: key creada, planta en `floors`, `X-Office-Socket`, comparación personal/jefe.

Ningún punto rechazado. Veredicto: MEJORAR, nota 8/10, 1 bloqueante y 4 menores.

## Ronda 4 (2026-10-16)

Aplicados los cinco puntos:

1. (bloqueante) `restoreSessions` repone la sesión y no el agente para las ignoradas; ayudante `ignored`; el segundo test da socket a `me-2` y reinicia con un segundo `Office`. Añadido a la tabla de puntos y a la de ficheros.
2. (menor) Paso 8 cita `texts.test.ts:151` (`session-basic.json` sin meta) y `floor-admin.test.ts:140-142` con el motivo por el que deben seguir pasando.
3. (menor) Riesgo nuevo: `gate()` no pasa por la salida temprana de `ignore`.
4. (menor) `ignore` limitado a `floorKind === 'managed'` (es lo que nombra la clave); ayuda del ajuste y README lo dicen.
5. (menor) Riesgo nuevo: `dumpRaw` con `AGENT_OFFICE_RAW=1`.

Ningún punto rechazado. Veredicto: APROBADO, nota 8/10.

Notas menores del revisor que quedan sin aplicar (el plan no se toca tras la aprobación; para quien lo ejecute):

1. `report()` con `sessionInOffice` devuelve `null` también para agentes vivos de plantas observadas (hoy tienen informe en vivo). Si se quiere conservar, la condición es `remembers(session.floorKind) && !this.sessionInOffice(session)`.
2. La re-emisión de la vista en `touchAgent` apenas se alcanza para la sesión principal con la decisión (a); se puede quitar.
3. `restoreSessions` en `ignore` solo mira `isOfficeRole(row.role)`: un compañero tmux con sesión propia y sin rol recupera su agente en su siguiente evento, no al arrancar; se puede usar también `row.team`.
4. Decidir si `inScope` queda como wrapper de `sessionInOffice` o se renombran los llamadores de `466` y `484`.
5. En `README.md:151`, «el texto de los mensajes» es más exacto que «los mensajes»: `recordMessage` sigue insertando la fila con cuerpo nulo.
