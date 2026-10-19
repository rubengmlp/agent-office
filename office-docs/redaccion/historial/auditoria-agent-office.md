# Historial: auditoria-agent-office

## Ronda 1 (2026-10-16)

Primera versión del plan. Auditoría de solo lectura de `agent-office-dev build/v1 @ 7c89614`.

- Leídos: los 35 ficheros de `hub/src`, hooks y scripts del plugin, `clone-permissions.json`, las once plantillas, la skill `office-protocol`, la UI (núcleo, panel completo, Planes, Ajustes, Tabla, `office/office.ts`, `scene/scene.ts`, `scene/assets.ts`, `scene/characters.ts`), la lista de tests de cada fichero, `README.md`, `CLAUDE.md` y `docs/spikes.md`.
- Contrastado con la documentación de Claude Code: reglas de permisos de Bash (para S8/M10) y campos JSON de la línea de estado (para F2).
- Resultado: 42 hallazgos (11 seguridad, 6 arquitectura, 9 calidad, 4 tests, 4 rendimiento, 7 UX, 6 agentes, 3 documentación), 32 mejoras, 10 features y las cinco primeras acciones.

Veredicto: MEJORAR, nota 8/10. Dos bloqueantes y catorce menores.

Aplicados:
- Bloqueante 1 (M24 como encargo suelto no puede pasar la puerta): M24 pasa a ser una regla de cada encargo de corrección (test primero, en la misma rama); M9 se une a M3 en la acción 2; M13 sube a la acción 5; Pasos 2 y 3 actualizados.
- Bloqueante 2 (M32/S11 suponían un relanzador que no existe): S11 reescrito; M32 incluye el supervisor `hub.sh` generado por `setup`, depende de M11, esfuerzo medio y criterio con `/health` en menos de 5 s.
- Menores 3 a 13, 15 y 16: cifras de P1 unificadas (ocho/doce procesos, mitad o tercio); comandos de Verificación de P1 y A1 corregidos; verificación de M5 por procesos o contador de peticiones; E6 con la causa en la plantilla; S2 con la retención indefinida de `reports`; S3 con «cualquier usuario local»; M7 con huella propia para `~/.claude` y S4 sin el caso de otro plan; M27 con `VACUUM` único al migrar; M28/P2 con baseline perezosa en `guard()`; M14 a esfuerzo medio con riesgo nuevo; F7 como checklist en la plantilla respetando `contextFree`; C3 con los casos reales y `write-tree`/hash por fichero; acción 3 con los cinco scripts.

Rechazado con matiz:
- Menor 14 decía que `ui/src/office/meetings.ts` ya lo comparten la 2D y la 3D. No es así: `ui/src/scene/layout.ts:294-307` tiene una copia idéntica de `findMeetingPairs` y `scene.ts:53` importa esa. A2 y M17 lo recogen como primer caso de la duplicación y M17 crece desde `meetings.ts` como pedía el revisor.

## Ronda 2 (2026-10-16)

Veredicto: MEJORAR, nota 7/10. Dos bloqueantes y once menores. Todos aplicados.

- Bloqueante 1 (el redactor no tiene Bash): S4 reescrito con los actores reales (artesano y jefes de departamento; redactor y revisor sin Bash) y ejemplo con `cd` + heredoc; criterio de M7 con artesano y escritura no detectable por `shellPaths`.
- Bloqueante 2 (Paso 1 pedía un «Cerrar» que no existe para planes entregados): Paso 1 reescrito (aparcar mientras se reparte; después aparcado o descartar) y U1 recoge que «Cerrar» solo existe en `ejecutando`.
- Menores: M14 y su riesgo incluyen el `timeout: 5` de `hooks.json:52`; M13 hace que el `ingest` ignore el `REVISAR:` por encima del tope, con criterio de ronda y commit; M5 trata aparte `AskUserQuestion` y la segunda entrada de `PermissionRequest`; S3/M4 incluyen el token de mensajería con fichero temporal 600; U5 y M26 corregidos (el fallback impreso ya existe); criterio de M28 referido a la baseline y riesgo de atribución añadido; M31 resuelve el jefe por `sessions.team` o spawns y añade el test de C2; M8 salta las entradas con punto; M30 incluye `QUESTION_PREFIX`; Verificación de A1 con los 25 + `opts`; S6 y A3 marcan como dato en vivo lo que no está en la foto.

## Ronda 3 (2026-10-16)

Veredicto: MEJORAR, nota 8/10. Un bloqueante y cinco menores. Todos aplicados.

- Bloqueante (la baseline perezosa de M28 dejaba ciega la red de seguridad): elegida la opción (a) del revisor. M28 y P2 mantienen la baseline al empezar el turno y se quedan solo con la huella compartida; criterio con test de carrera; riesgo nuevo que explica por qué no debe moverse a `guard()` y qué costaría hacerlo asíncrono.
- Menores: M27 hace el `VACUUM` en `openDb`, fuera de `migrate()`, solo si `auto_vacuum` es 0; M5 deja aparte la entrada de `SendMessage` y el paso 3 secuencia M14 tras M5; el paso 1 recomienda solo aparcar y explica qué hace Descartar; M30 cierra las `pending` en `office.start()` en vez de en `prune`; S2 añade que el recorte a 50 no se aplica a las sesiones sin rol (`reports.ts:115`).

## Ronda 4 (2026-10-16)

Veredicto: APROBADO, nota 9/10. Tres notas menores que el revisor no pide aplicar y que no se aplican porque cualquier cambio invalidaría la aprobación; quedan aquí para quien ejecute S4/M7:

- El ejemplo `cd ~/.claude/agents && …` de S4 sí lo detecta la guardia (`hub/src/guard.ts:251-253` bloquea cualquier ruta de `claudeHome` fuera de `skills/` y `plugins/`). Ejemplos que sí se cuelan: `cd ~ && cat > .claude/agents/x.md <<EOF …` o `python3 -c "open('/…/.claude/agents/x.md','w')"`. La conclusión de S4 no cambia.
- En el mismo ejemplo, desde el cwd del artesano (`office-docs/taller`) el `cd` correcto es `cd ../redaccion/planes`, no `cd ../../…`.
- En la Verificación de A1, «los métodos privados empiezan en la 827» es un dato accesorio no confirmado por el revisor (en la foto, `private background` está en `hub/src/office.ts:827`).
