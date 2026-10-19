# Historial: puerta-tests-cambios-reales

## Ronda 1

Plan inicial a partir del brief del jefe de Redacción: implementación de M1 + M2 de la auditoría (`auditoria-agent-office.md`, S1, M1, M2, M24, riesgo «Falsos bloqueos de la puerta con M1»).

Decisiones tomadas al redactar:

- Las dos vías de M1 escriben en la tabla `edits` existente; sin esquema nuevo.
- Vía directa: `shellWrites` sobre `shellPaths`, solo rutas que existen tras el comando o que el comando borra; `git <escritura>` cuenta como cambio sobre la raíz; se saltan comandos de tests y comprobación.
- Huella: segunda instancia de `GuardWatch` acotada a la planta del desarrollador; `fingerprintPending` cierra la puerta mientras corre el `git status` del final del turno.
- M2: `tool_response.exit_code` si viene (documentación actual) y resumen de salida siempre (la fixture de 2.1.292 no trae `exit_code`); `TEST_FAILED` como constante del módulo para no tocar `types.ts` (tsconfig de la UI lo incluye).
- No se tocan plantillas, hooks, `types.ts`, `db.ts` ni la UI.

Veredicto del revisor: MEJORAR, nota 6/10, 3 bloqueantes y 12 menores.

## Ronda 2

Aplicados todos los puntos:

- B1 (M24 con `git stash` no funciona y choca con las plantillas): M24 definido sobre commits. El revisor de código comprueba `git log --stat build/v1..HEAD` (`<sha-tests>` primero, solo `hub/test/`); el tester ejecuta la suite en una copia de `<sha-tests>` extraída con `git archive` a una carpeta temporal (no un worktree, para no tocar `.git` del clon) y luego en `HEAD`. Paso 9 y Verificación dicen lo mismo y nombran a quién.
- B2 (`TEST_FAILED` con falsos rojos deterministas): cada patrón anclado a la línea de resumen de su ejecutor (tabla en Diseño 3); caso «verde con nombres engañosos» en el paso 1; nombres de tests sin «fail»; riesgo reescrito.
- B3 (lista de rojos incorrecta): `bun test` no comprueba tipos, lista reescrita con el motivo real de cada fallo; `fingerprintPending` con `lastOwnerEdit: null`; el test de `guard.test.ts` usa dos repos git y cuenta llamadas de `git`; añadido el caso `interrupted: true`.
- M4: huella `mtime:size` de las candidatas en `PreToolUse` por `tool_use_id`, cuenta solo lo que cambia; `fingerprint` se exporta.
- M5: `GIT_TREE` (solo subcomandos que tocan el árbol) en vez de `GIT_WRITES`; la baseline guarda `HEAD` y `finish` añade `git diff --name-only` si cambió.
- M6: `. (git)` en los dos sitios. M7: `realPath` en ambos lados de `relative`. M8: `team()`, `done()`, `teamWithEdit()` suben al ámbito del módulo. M9: forma BSD `sed -i '' 's/a/b/' lib/trips.dart`. M10: `NEVER_FAILS` con anticipación tras `:` y caso `bun test || :`. M11: el caso de la huella usa `flutter test`. M12: límite del worktree en Riesgos (se opta por anotarlo; la ampliación por `--show-toplevel` queda indicada). M13: `shellWrites` también en `PostToolUseFailure` sin interrupción. M14: una sola consulta, `lastOwnerEdit` usa la `last` filtrada con la explicación de por qué el resultado es el mismo. M15: `trackChanges` incluye a los `intern`, como `ownerKeys`.

Rechazados: ninguno.

Veredicto del revisor: MEJORAR, nota 6/10, 1 bloqueante y 10 menores.

## Ronda 3

Aplicados todos los puntos:

- B1 (el diff de `HEAD` bloqueaba el flujo verde → commit → `HECHO:`): de los ficheros del diff solo cuentan los que no estaban en la `Snapshot` de la baseline o cuya huella actual difiere de la guardada; caso nuevo «un commit de lo ya probado no bloquea» en git real (paso 2) y en la lista de «no fallan» de Verificación; caso espejo en `guard.test.ts`.
- M2: `WatchDeps.headDiff`, activa solo en `changes`; test «sin headDiff no hay rev-parse».
- M3: `office.ts` lee el comando de `tool_input` (no `c.command`) y exige `tool_use_id`; caso Pre/`PostToolUseFailure` con fichero cambiado.
- M4: `team(stack = 'flutter')` registra la planta antes del `SessionStart` (`touchSession` fija `stack` una vez, `office.ts:1241,1253-1256`).
- M5: escrituras de prueba siempre con distinta longitud.
- M6: `ts >= since`, con el empate explicado.
- M7: `total` en `ownerEdits` para «(y N más)» real; el diff de `HEAD` acotado a `limit`.
- M8: `tool_use_id` sin entrada → nada; sin `tool_use_id` → nada; se elimina la regla simple de respaldo.
- M9: con baseline en curso, las candidatas se filtran con `git check-ignore`; caso «la vía directa respeta .gitignore cuando hay baseline».
- M10: el `rm -rf` del tester va en un Bash aparte.
- M11: `describe('fingerprint safety net')`, `guard.test.ts:91`; `repo()` en `:94-103`.

Rechazados: ninguno.

Veredicto del revisor: MEJORAR, nota 7/10, 2 bloqueantes y 9 menores.

## Ronda 4

Aplicados todos los puntos:

- B1 (la huella cegaba a la guardia de departamentos): `recordBashChanges` guarda en memoria lo que inserta y `attributedFiles(…, includeFingerprints)` lo resta para `this.watch`; afirmación corregida; test «la huella no ciega a la guardia» (alerta `posible` con la fila de huella presente).
- B2 (`run_in_background`): `test: null` en `postTool`/`failedTool`; la vía directa no compara huellas para esa llamada; caso en paso 1, rojo en Verificación, riesgo.
- M3: `git check-ignore -z --stdin` sin `-q`, código 1 normal; caso con dos rutas.
- M4: patrón de flutter anclado a `^\d+:\d+ \+\d+.*`.
- M5: «un commit de lo ya probado» no comprueba la fila del turno 1; sigue en la lista de «no fallan».
- M6: `start` guarda los slugs aparte; `finishing` limpiado en `finally`.
- M7: `changes.finish` en `retire` y `endSession`; riesgo del reinicio.
- M8: `exempt` con `installTargets()`.
- M9: `stash list|show` y `-C` fuera de la planta excluidos; `checkout -b` y `reset --soft` como residuo en Riesgos.
- M10: residuo `echo bun test` anotado en Diseño 3 y Riesgos, con el motivo de no usar `tokenize`.
- M11: límite de los interns con dueño de tarea en Riesgos.

Rechazados: ninguno.

Veredicto del revisor: APROBADO, nota 8/10. El plan no se toca después de la aprobación. Notas menores del revisor para quien ejecute (no aplicadas al plan):

1. El filtro `git check-ignore` del paso 6 depende de `changes.watching`, que se construye en el paso 7: crear `changes` en el paso 6 o aplazar el filtro al 7.
2. En «la huella no ciega a la guardia», comprobar como aserción la fila de huella en `edits` del desarrollador (es lo que hace que el caso falle en la base).
3. El helper `watch()` de `hub/test/guard.test.ts:106-119` usa `runGit` fijo: ampliarlo con un `git` inyectable y opciones (`headDiff`) para los casos nuevos.
4. Patrón de flutter más estricto, con el contador de fallos: `^\d+:\d+ \+\d+(?: ~\d+)? -\d+: Some tests failed\.`.
5. Riesgo: un `HECHO:` con el turno del desarrollador aún abierto solo cuenta la vía directa (la huella no existe todavía).
6. Riesgo: las filas de huella llevan el `ts` del final del turno; un verde del tester durante el turno, posterior a un cambio que solo ve la huella, no abre la puerta (una ejecución más del tester).
7. Riesgo: `trackChanges` también cubre a los `intern` hijos del jefe y les atribuye lo que otros cambien durante su vida; coherente con `ownerKeys`.
8. Con `since = lastTesterGreen`, el paso con verde posterior sale con el motivo «sin cambios en el repositorio» en vez de «tester en verde después del último cambio»; misma decisión, distinto texto en `gate_decisions`.
9. `trackChanges` necesita `session` (`floorKind`, `sessionId`): añadirla a la firma.
