# Tope de rondas aplicado por la oficina (M13)

## Contexto

Plan de implementación derivado de la auditoría `redaccion/planes/auditoria-agent-office.md`: hallazgo E1 (sección 1.7), mejoras M13 y M24 (tabla de la sección 2).

- agent-office-dev build/v1 @ 7c89614 (2026-10-16)

`config.review.maxRounds` (por defecto 4, `hub/src/config.ts:117`; rango 1-10, `hub/src/config.ts:103`) llega hoy a los agentes solo como texto en sus plantillas (`hub/src/agents.ts:82`; `plugin/templates/revisor-planes.md.tpl:28-42`; `plugin/templates/lead-redaccion.md.tpl:31,39`). La oficina no lo aplica: `gateMessage` solo mira `HECHO:` (`hub/src/office.ts:563-566`) y `handleProtocol` acepta cualquier `REVISAR: … ronda N` de un autor, lo marca y hace commit (`hub/src/office.ts:1057-1069`). Si el jefe pierde la cuenta, el bucle sigue sin que nadie avise.

En el `PreToolUse` de `SendMessage` corren dos hooks a la vez: `emit.sh events` (`plugin/hooks/hooks.json:25-35`, que acaba en `Office.ingest` → `recordMessage` → `handleProtocol`, `hub/src/office.ts:1408-1419`) y `gate.sh gate-message` (`plugin/hooks/hooks.json:46-55`, que acaba en `Office.gateMessage`, `hub/src/server.ts:86-90`). Que la puerta bloquee el mensaje no impide que `ingest` lo procese: hay que cortar en los dos sitios.

## Objetivo

`gateMessage` bloquea `REVISAR: … ronda N` con N > `config.review.maxRounds` y explica el motivo. Como `emit.sh` corre a la vez que `gate.sh` en el mismo `PreToolUse` y el `REVISAR:` se clasifica ahí (`hub/src/state-machine.ts:235-254`), `handleProtocol` (`hub/src/office.ts:1057-1070`) ignora también ese `REVISAR:` (sin `markRequested` ni `commitRound`) y lo anota en la actividad. El panel muestra la ronda sobre el máximo.

Criterios de aceptación del brief, literales:

- Test en `hub/test/departments.test.ts`: con `maxRounds: 2`, `REVISAR: … ronda 3` del redactor no sale, `documents.round` sigue en 2, no hay commit «ronda 3» y la actividad lo registra.
- Regla M24: el test se escribe antes del cambio, misma rama; falla con `git stash` de la corrección y pasa con ella.
- `bun run test` y `bun run typecheck` en verde, validados por el tester de la planta.

## Alcance

Entra:

- Decisión pura del tope en `hub/src/gate.ts`, al estilo de `decideDocumentGate`.
- `gateMessage` trata `REVISAR:` de redactor y artesano (los dos departamentos comparten `review.maxRounds`) y bloquea por encima del tope.
- `handleProtocol` ignora el mismo `REVISAR:` y lo anota en la actividad.
- El tope efectivo se recalcula tras un `SIN ACUERDO:` (ver Diseño, decisión 2), para no romper el paso 7 del jefe de Redacción.
- `DocumentView.maxRounds` y su pintado en Tabla, estado del documento y pestaña Planes como «ronda N/M».
- Tests: `hub/test/departments.test.ts` (los del criterio) y `hub/test/units.test.ts` (función pura).

Queda fuera:

- M14 (hacer el commit antes de dejar salir el `REVISAR:`, `gateMessage` asíncrono, subir los timeouts de `gate.sh`/`hooks.json`). `gateMessage` sigue síncrono y `commitRound` sigue en `ingest`.
- Las plantillas de `plugin/templates/`: el tope ya les llega como texto `{{maxRounds}}`. Lo que no cuadra entre plantillas y tope va en Preguntas abiertas.
- Un `REVISAR:` sin «ronda N» (`parseProtocol` devuelve `round: null`, `hub/src/protocol.ts:44-49`): no se bloquea, como hoy. Endurecerlo es trabajo de M14, que ya toca la puerta del `REVISAR:`.
- Los veredictos del revisor (`MEJORAR:`/`APROBADO:`/`SIN ACUERDO:`) con ronda por encima del tope: no se filtran. El revisor solo existe si el jefe lo lanzó tras un `REVISAR:` que pasó la puerta.
- El resto de la auditoría.

## Diseño

### Decisión 1: la regla vive en una función pura y se aplica en los dos hooks

`hub/src/gate.ts` gana `decideReviewGate(f: ReviewGateFacts): GateDecision` junto a `decideDocumentGate` (`hub/src/gate.ts:31-55`), con `ReviewGateFacts = { path: string | null; round: number | null; cap: number; maxRounds: number }`:

- `round === null` o `round <= cap` → `{ pass: true, reason: 'ronda dentro del tope' }`.
- Si no, `pass: false` con un motivo para el redactor, en el tono de los motivos actuales de `gate.ts` (prosa en castellano, va al modelo por stderr con `exit 2`, `plugin/hooks/gate.sh:18-23`): «Tope de rondas: `<path>` ya ha agotado sus `<cap>` rondas de revisión (`review.maxRounds` = `<maxRounds>`); la ronda `<round>` no se abre. No repitas el `REVISAR:`: escribe a tu jefe que se ha alcanzado el tope y espera su decisión. Solo un `SIN ACUERDO:` del revisor y la decisión del usuario abren otras `<maxRounds>` rondas; el usuario también puede subir «Rondas máximas» en Ajustes.» Cuando `cap > maxRounds` añade «(`<maxRounds>` configuradas más las `<cap - maxRounds>` gastadas antes del último `SIN ACUERDO:`)». El criterio del test comprueba que el motivo contiene «ronda 3» y «2 rondas».

`Office` la usa en dos sitios:

1. **`gateMessage`** (`hub/src/office.ts:563-592`). Hoy devuelve `pass` en la línea 566 si el cuerpo no empieza por `HECHO:`. Pasa a: calcular `parsed = parseProtocol(body)`; si `parsed?.kind !== 'review'` y no es `HECHO:`, `pass` como hoy. Si es `review`: `touchSession`, `roleForEvent` (como en 568-569) y, si `isDepartmentFloor(session.floorKind) && isAuthorRole(senderRole)` (`hub/src/scope.ts:74-77,83-85`), `return this.gateReview(e, parsed, body, session, now)`; cualquier otro remitente, `pass` («solo cuenta el REVISAR de un redactor o artesano»): el `REVISAR:` del propio jefe o de una planta gestionada no cambia. La rama de `HECHO:` queda tal cual.

   `gateReview` (privado, nuevo, junto a `gateDocument`, `hub/src/office.ts:992-1026`): `ref = docRef(parsed.target, this.docsRoot(), text(e.cwd) ?? session.cwd)`; `cap = ref ? this.docs.roundCap(ref) : this.config.review.maxRounds`; `decision = decideReviewGate({ path: ref?.path ?? parsed.target, round: parsed.round, cap, maxRounds })`. Si pasa, devuelve sin registrar nada: el `REVISAR:` ya queda en la actividad como `hub.act.reviewRequested` cuando `ingest` lo procesa, y registrar cada paso en `gate_decisions` solo añadiría ruido. Si bloquea: `this.sql.insertGate.run(now, teamOfSession(session.sessionId), ref?.path ?? null, 'block', decision.reason)` (tabla `gate_decisions`, `hub/src/db.ts:125-132`; mismo uso que `hub/src/office.ts:1002`) y `pushActivity` con `event: 'GateMessage'`, `tool: 'SendMessage'` y `summary: { key: 'hub.act.reviewBlockedOverMax', params: { path, round, max: cap } }`.

2. **`handleProtocol`** (`hub/src/office.ts:1057-1070`). Dentro de `if (parsed.kind === 'review' && isAuthorRole(from.role))`, antes de `markRequested`: `const cap = this.docs.roundCap(ref); if (round !== null && round > cap) { pushActivity({ event: 'Review', tool: 'SendMessage', summary: { key: 'hub.act.reviewIgnoredOverMax', params: { path: ref.path, round, max: cap } } }); return; }`. Así no hay `markRequested` (que subiría `documents.round` a 3, `hub/src/documents.ts:142-147`), ni `commitRound` (que haría el commit «redaccion: login ronda 3», `hub/src/office.ts:1188-1208`), ni `refreshDocuments`.

Dos claves distintas (`reviewBlockedOverMax` en la puerta, `reviewIgnoredOverMax` en `ingest`) y no una compartida: en producción las dos entradas aparecen siempre juntas porque los dos hooks disparan con el mismo `PreToolUse`, y dos líneas idénticas parecerían un fallo; con textos distintos se lee lo que pasó («la puerta lo bloqueó» y «el registro lo ignoró»). Es el mismo doblete que ya existe con `HECHO:` (`hub.act.deliveryAccepted` en la puerta y `hub.act.message` en `ingest`).

Las dos claves se añaden a `HubTextParams` (`hub/src/types.ts:8-199`) con `{ path: string; round: number; max: number }` y a `ui/src/i18n/es.ts` y `en.ts` **en el mismo paso**: `ui/src/i18n/hub.ts:5-17` hace fallar `cd ui && bun run typecheck` si una clave `hub.*` de `types.ts` falta en `es.ts` o sus `{marcadores}` no son exactamente los parámetros.

### Decisión 2: el tope efectivo se renueva tras un `SIN ACUERDO:`

`plugin/templates/lead-redaccion.md.tpl:31` dice que, tras `SIN ACUERDO:` (que el revisor manda en la ronda `maxRounds`, `plugin/templates/revisor-planes.md.tpl:40-42`) y la decisión del usuario, el jefe «sigue en el paso 4»: lanza otro revisor cuando el redactor pida `REVISAR: … ronda maxRounds+1`. Un tope plano `N > maxRounds` bloquearía ese `REVISAR:` siempre, y cada `SIN ACUERDO:` dejaría el plan muerto salvo que el usuario subiera «Rondas máximas» en Ajustes. Las plantillas quedan fuera del encargo, así que la regla se ajusta en el hub:

> `cap = maxRounds + R`, donde `R` es la ronda del último veredicto `no-agreement` registrado para ese documento (0 si no hay).

Con `maxRounds: 4`: rondas 1-4; `SIN ACUERDO:` en la 4 → rondas 5-8; sin otro `SIN ACUERDO:`, la 9 se bloquea. Cada presupuesto extra exige un `SIN ACUERDO:`, que según la plantilla del jefe siempre pasa por `BLOQUEADO:` al director y por la decisión del usuario: es justo la intervención humana que el tope quiere forzar, y el caso de E1 (el jefe pierde la cuenta en un bucle de `MEJORAR:`) queda acotado a `maxRounds` rondas por intervención. El criterio del brief (`maxRounds: 2`, ronda 3 bloqueada) se cumple tal cual porque sin `SIN ACUERDO:` `cap = maxRounds`.

Implementación en `hub/src/documents.ts`:

- `export function roundCap(maxRounds: number, lastNoAgreementRound: number | null): number` → `maxRounds + (lastNoAgreementRound ?? 0)`. Pura, con test en `units.test.ts`.
- `DocumentsOptions` (`hub/src/documents.ts:27-35`) gana `maxRounds: () => number`; `Office` lo pasa como `() => this.config.review.maxRounds` al construir `DocumentDesk` (`hub/src/office.ts:300-308`). `reload()` sustituye `this.config` y llama a `refreshDocuments()` (`hub/src/office.ts:805-825`), así que un cambio de «Rondas máximas» en Ajustes se refleja sin más.
- `DocumentDesk.roundCap(ref: DocRef): number` (público): `SELECT round FROM verdicts WHERE path = ? AND kind = 'no-agreement' ORDER BY ts DESC, id DESC LIMIT 1` (tabla `verdicts`, `hub/src/db.ts:88-102`, con índice `verdicts_path`) y `roundCap(this.opts.maxRounds(), row?.round ?? null)`.
- `view()` (`hub/src/documents.ts:255-283`) añade `maxRounds: this.roundCap(ref)` al `DocumentView`.
- Respaldo para un `SIN ACUERDO:` sin «ronda N»: `parseProtocol` deja `round: null` y la fila de `verdicts` quedaría con `round` NULL, con lo que `roundCap` no renovaría nada y el siguiente `REVISAR:` se bloquearía. En `handleProtocol`, al insertar el veredicto (`hub/src/office.ts:1085`), la ronda que se guarda para `no-agreement` es `round ?? this.docs.find(ref.path)?.round ?? null` (`DocumentDesk.find`, `hub/src/documents.ts:86-88`): la ronda registrada del documento en ese momento, que es la que el revisor estaba juzgando. Solo para `no-agreement`; `approved` e `improve` siguen guardando lo que dice el mensaje. El respaldo se hace al insertar y no al consultar: calcularlo en `roundCap` con el `documents.round` actual haría crecer el tope con cada `REVISAR:` posterior (cap = maxRounds + ronda actual, siempre un paso por delante) y lo dejaría sin fondo.

### Decisión 3: el panel pinta «ronda N/M» con el tope efectivo

`DocumentView` (`hub/src/types.ts:465-479`) gana `maxRounds: number` (el tope efectivo del documento, no el de configuración: así «ronda 5/8» tras un `SIN ACUERDO:` se entiende). Añadir el campo no rompe la UI: ningún fichero de `ui/src` construye un `DocumentView` (llegan por `snapshot`/`documents`, `ui/src/store.ts`) y `ui/test/notify.test.ts:83-84` lo construye con `as DocumentView`. Leerlo de `store.settings` no sirve: `settings` solo llega al abrir Ajustes (`ui/src/api.ts:68`, `ui/src/settings/settings.ts:198`) o tras `reload` (`hub/src/office.ts:822`), y es `null` en un panel recién abierto (`ui/src/store.ts:70`).

Cambios de UI, todos con `t()`/`plural()` y sin literales fuera de `ui/src/i18n/` (`ui/test/i18n.test.ts:124-135`):

- `ui/src/table/table.ts:174`: `t('table.roundOfMax', { n: doc.round, max: doc.maxRounds })`. Clave nueva `table.roundOfMax` (`es`: «ronda {n}/{max}», `en`: «round {n}/{max}»). `table.round` se mantiene para la ayuda (`ui/src/table/table.ts:101`) y para la ronda de cada veredicto en el informe (`ui/src/panel/report.ts:114`), donde no hay tope. `table.round.hint` pasa a mencionar el tope.
- `ui/src/labels.ts:137-146`: `documentStatusText` recibe `Pick<DocumentView, 'status' | 'round' | 'score' | 'maxRounds'>` y pinta `t('docStatus.reviewRound', { n: doc.round, max: doc.maxRounds })`; la clave pasa a «En revisión · ronda {n}/{max}» / «In review · round {n}/{max}».
- `ui/src/plans/plans.ts:38-42`: `plural('plans.rounds', doc.round, { max: doc.maxRounds })`; `plans.rounds.one/.other` pasan a «{n} ronda de {max}» / «{n} rondas de {max}» y «{n} round of {max}» / «{n} rounds of {max}». `plural` acepta parámetros extra (`ui/src/i18n/index.ts:30-31`).

`ui/test/i18n.test.ts:40-47` exige las mismas claves y los mismos `{marcadores}` en `es` y `en`, y textos distintos salvo en `SAME_KEYS` (`:56-59`); todos los textos nuevos cumplen.

### Qué no cambia

- `markRequested`/`markRound` siguen con `MAX(round, ?)`: un `REVISAR:` dentro del tope con una ronda menor que la registrada no baja el contador.
- `gate.sh` sin hub (sin `key` o `curl` fallido) sigue saliendo con 0 (`plugin/hooks/gate.sh:3-6,17`): el tope, como la puerta del `HECHO:`, depende de que el hub esté arriba. M11 (guardia estricta) lo cubre.
- `gateMessage` sigue síncrono y barato: una consulta SQL más, muy por debajo de `curl -m 2` (`plugin/hooks/gate.sh:10`).

### Carpetas y ficheros que toca (convivencia)

| Fichero | Cambio |
|---|---|
| `hub/src/gate.ts` | `ReviewGateFacts`, `decideReviewGate` (nuevo, al final). |
| `hub/src/documents.ts` | `roundCap()` exportada; `DocumentsOptions.maxRounds`; `DocumentDesk.roundCap(ref)`; `view()` añade `maxRounds`. |
| `hub/src/types.ts` | `DocumentView.maxRounds`; dos claves en `HubTextParams`. |
| `hub/src/office.ts` | import de `decideReviewGate` (línea 22); opción `maxRounds` del `DocumentDesk` (300-308); `gateMessage` (563-592) y `gateReview` nuevo; `handleProtocol` (1057-1070 y la ronda guardada en 1085). |
| `hub/test/departments.test.ts` | Tres tests nuevos en `describe('Redacción review loop')`. |
| `hub/test/units.test.ts` | Casos de `decideReviewGate` y `roundCap`. |
| `ui/src/i18n/es.ts`, `ui/src/i18n/en.ts` | Claves `hub.act.reviewBlockedOverMax`, `hub.act.reviewIgnoredOverMax`, `table.roundOfMax`; textos de `docStatus.reviewRound`, `table.round.hint`, `plans.rounds.one/.other`. |
| `ui/src/table/table.ts`, `ui/src/labels.ts`, `ui/src/plans/plans.ts` | Pintado «ronda N/M». |

No toca `plugin/` (hooks, plantillas, perfiles), `hub/src/sync.ts`, `hub/src/guard.ts`, `hub/src/privacy.ts` ni `hub/src/server.ts`.

Convive con los encargos M1+M2 (`puerta-tests-cambios-reales`) y M3+M9 (`privacidad-ordenes-oficina`), que también tocan `hub/src/office.ts` y `hub/test/`, y que la auditoría manda ejecutar en serie, no en paralelo (`redaccion/planes/auditoria-agent-office.md:232`). Al escribir este plan sus ficheros aún no existen en `redaccion/planes/`, así que no se les atribuye nada concreto. Punto de roce previsible: M1 cambia la rama de jefe de `gateMessage` (`hub/src/office.ts:573-591`, `decideGate`/`lastEdit`) y este plan añade la rama de `REVISAR:` justo antes, en la misma función; quien vaya segundo rebasa sobre el otro y vuelve a pasar `bun run test`. M4+M5 (`key-token-hook-unico`) toca `plugin/hooks/*`, que aquí no se toca; M6+M8 (`zona-escritura-marcador-fotos`) toca `guard.ts`/`sync.ts`, tampoco.

## Pasos

Todo en el clon `/Users/victorsanblasgomez/Projects/agent-office-dev`, en la rama del encargo, sin hub en marcha: los tests usan `AGENT_OFFICE_HOME`/`AGENT_OFFICE_CLAUDE_HOME` temporales (`hub/test/helpers.ts:22-27`) y un `docsRepo` temporal (`hub/test/helpers.ts:66`), así que no tocan `~/.config/agent-office` ni `~/Projects/office-docs`.

Disciplina de commits, por la comprobación M24 del paso 6: el paso 1 se confirma en un commit propio (solo tests); la corrección de los pasos 2-5 se queda **sin confirmar** en el árbol de trabajo hasta que el paso 6 la haya comprobado con `git stash`. Si se confirmara antes, `git stash push -- hub/src ui/src` no tendría nada que guardar (saldría «No local changes to save» con código 0), el test saldría verde «con stash» y la comprobación daría un falso positivo.

1. **Tests primero (M24).** En `hub/test/departments.test.ts`, dentro de `describe('Redacción review loop')` (línea 116), tres tests; en `hub/test/units.test.ts`, los casos puros. Verificable: `cd hub && bun test test/departments.test.ts test/units.test.ts` en rojo (`units.test.ts` falla al importar `decideReviewGate`; el test A falla en el primer `toMatchObject({ …, maxRounds: 2 })`, porque `DocumentView` aún no tiene ese campo; los tests B y C, en el mismo `maxRounds`). Commit «test: tope de rondas (M13), en rojo». Es el único commit hasta el paso 6.

   Test A, el del criterio:

   ```ts
   test('the office enforces maxRounds: a REVISAR over the cap is blocked, ignored and logged', async () => {
     const cwd = redaccionTeam();
     h.config.review.maxRounds = 2; // the harness and Office share the config object (helpers.ts:66-78, office.ts:271)
     writeFileSync(join(docs, PLAN), '# Plan\n');
     touch(join(docs, PLAN), -60_000);
     say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `REVISAR: ${PLAN} ronda 1`);
     say(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1', 'redactor-login', `MEJORAR: ${PLAN} ronda 1 — nota 5/10\n1. bloqueante: falta la migración`);
     await h.office.idle();
     // commitDocument only commits when the staged diff is not empty (docs-repo.ts:49-50): each round needs a real change.
     h.clock.advance(60_000);
     writeFileSync(join(docs, PLAN), '# Plan\n\n## Pasos\n1. migración\n');
     touch(join(docs, PLAN), -1000);
     expect(gate(LEAD, cwd, 'ared-1', 'redactor-login', `REVISAR: ${PLAN} ronda 2`).pass).toBe(true);
     say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `REVISAR: ${PLAN} ronda 2`);
     await h.office.idle();
     expect(doc(PLAN)).toMatchObject({ status: 'revision', round: 2, maxRounds: 2 });

     h.clock.advance(60_000);
     writeFileSync(join(docs, PLAN), '# Plan\n\n## Pasos\n1. migración\n2. backfill\n');
     touch(join(docs, PLAN), -1000);
     const over = gate(LEAD, cwd, 'ared-1', 'redactor-login', `REVISAR: ${PLAN} ronda 3`);
     expect(over.pass).toBe(false);
     expect(over.reason).toContain('ronda 3');
     expect(over.reason).toContain('2 rondas');
     // emit.sh fires in the same PreToolUse whatever gate.sh answers: ingest must ignore it too.
     say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `REVISAR: ${PLAN} ronda 3`);
     await h.office.idle();
     expect(doc(PLAN)).toMatchObject({ status: 'revision', round: 2 });
     expect(emittedDoc(PLAN)?.round).toBe(2);
     const log = git(docs, 'log', '--format=%s');
     expect(log).toContain('redaccion: login ronda 2');
     expect(log).not.toContain('ronda 3');
     const summaries = h.office.snapshot().activity.map((a) => a.summary);
     expect(summaries).toContainEqual({ key: 'hub.act.reviewBlockedOverMax', params: { path: PLAN, round: 3, max: 2 } });
     expect(summaries).toContainEqual({ key: 'hub.act.reviewIgnoredOverMax', params: { path: PLAN, round: 3, max: 2 } });
     expect(h.db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM gate_decisions WHERE decision = 'block' AND task_id = ?").get(PLAN)?.n).toBe(1);
   });
   ```

   El helper `gate()` (`hub/test/departments.test.ts:63-66`) sirve tal cual: `gateMessage` no mira `to`.

   Test B, el presupuesto tras `SIN ACUERDO:`:

   ```ts
   test('a SIN ACUERDO opens another maxRounds budget; the lead is not capped', () => {
     const cwd = redaccionTeam();
     h.config.review.maxRounds = 2;
     writeFileSync(join(docs, PLAN), '# Plan\n');
     touch(join(docs, PLAN), -60_000);
     say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `REVISAR: ${PLAN} ronda 2`);
     say(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1', 'redactor-login', `SIN ACUERDO: ${PLAN} ronda 2 — falta la migración`);
     expect(doc(PLAN)).toMatchObject({ status: 'sin-acuerdo', round: 2, maxRounds: 4 });
     expect(gate(LEAD, cwd, 'ared-1', 'redactor-login', `REVISAR: ${PLAN} ronda 3`).pass).toBe(true);
     say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `REVISAR: ${PLAN} ronda 3`);
     expect(doc(PLAN)?.round).toBe(3); // status stays sin-acuerdo until the next verdict (documents.ts:305)
     expect(gate(LEAD, cwd, 'ared-1', 'redactor-login', `REVISAR: ${PLAN} ronda 5`).pass).toBe(false);
     expect(gate(LEAD, cwd, 'ared-1', 'redactor-login', `REVISAR: ${PLAN}`).pass).toBe(true); // no round: out of scope, unchanged
     expect(gate(LEAD, cwd, null, null, `REVISAR: ${PLAN} ronda 9`).pass).toBe(true); // the lead is not an author
   });
   ```

   Test C, el `SIN ACUERDO:` sin número de ronda (decisión 2, respaldo):

   ```ts
   test('a SIN ACUERDO without a round number counts at the current round of the document', () => {
     const cwd = redaccionTeam();
     h.config.review.maxRounds = 2;
     writeFileSync(join(docs, PLAN), '# Plan\n');
     touch(join(docs, PLAN), -60_000);
     say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `REVISAR: ${PLAN} ronda 2`);
     say(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1', 'redactor-login', `SIN ACUERDO: ${PLAN} — falta la migración`);
     expect(doc(PLAN)).toMatchObject({ status: 'sin-acuerdo', round: 2, maxRounds: 4 });
     expect(gate(LEAD, cwd, 'ared-1', 'redactor-login', `REVISAR: ${PLAN} ronda 3`).pass).toBe(true);
   });
   ```

   En `units.test.ts`: `decideReviewGate({ path: 'redaccion/planes/x.md', round: 3, cap: 2, maxRounds: 2 }).pass === false` y su `reason` contiene «ronda 3»; `round: 2` pasa; `round: null` pasa; `cap: 6, maxRounds: 4, round: 5` pasa y `round: 7` no, con «gastadas» en el motivo. `roundCap(4, null) === 4`, `roundCap(4, 4) === 8`.

2. **Decisión pura y tope efectivo** (sin commit). `decideReviewGate` en `hub/src/gate.ts`; `roundCap`, `DocumentsOptions.maxRounds`, `DocumentDesk.roundCap(ref)` y `maxRounds` en `view()` en `hub/src/documents.ts`; `DocumentView.maxRounds` en `hub/src/types.ts`; la opción `maxRounds: () => this.config.review.maxRounds` en el constructor de `Office`. Verificable: `cd hub && bun run typecheck` y `cd ui && bun run typecheck` en verde (la UI solo lee `DocumentView`); `units.test.ts` en verde; el test A pasa ya del `toMatchObject` y falla en `expect(over.pass).toBe(false)`.

3. **Claves de actividad** (sin commit). Las dos claves `hub.act.*` en `HubTextParams` (`hub/src/types.ts`) y, en la misma edición, en `ui/src/i18n/es.ts` y `en.ts` con marcadores `{path}`, `{round}`, `{max}`. Verificable: `cd ui && bun run typecheck` en verde (`ui/src/i18n/hub.ts:6-17`) y `cd ui && bun test test/i18n.test.ts` en verde.

4. **La oficina aplica el tope** (sin commit). `gateMessage`, `gateReview` y `handleProtocol` en `hub/src/office.ts` como en la decisión 1, con el respaldo de ronda del `SIN ACUERDO:` de la decisión 2. Verificable: `cd hub && bun test` en verde, incluidos los tres tests nuevos y los existentes del bucle (`departments.test.ts:117-171,173-182,286-298`, que usan `maxRounds: 3` del `office()` de la línea 42 y rondas ≤ 3).

5. **Panel** (sin commit). `table.ts`, `labels.ts`, `plans.ts` y las claves/textos de `es.ts`/`en.ts` de la decisión 3. Verificable: `cd ui && bun run typecheck && bun test` en verde; en `bun run dev:ui` contra una grabación o un hub de pruebas, la fila de un plan en revisión muestra «ronda 2/4».

6. **Comprobación M24, commit y entrega.** Con la corrección aún sin confirmar: `git stash push -- hub/src ui/src` (guarda la corrección y deja los tests del commit del paso 1; comprobar que la salida no es «No local changes to save»), `cd hub && bun test test/departments.test.ts` en rojo, `git stash pop`, en verde. Si por lo que sea la corrección ya estuviera confirmada, la alternativa equivalente es `git checkout <commit del paso 1> -- hub/src ui/src`, el test en rojo, y `git checkout HEAD -- hub/src ui/src`. Después, commit de la corrección («feat: tope de rondas aplicado por la oficina (M13)»). Por último el tester de la planta ejecuta `bun run test` y `bun run typecheck` desde la raíz del clon (`package.json:15-16`): `bun run test` casa con el `testRegex` del perfil Node (`plugin/profiles/node.json:4`, `\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b`), así que su verde queda como veredicto `tests` del tester y abre la puerta del `HECHO:` del jefe (`hub/src/gate.ts:14-16`).

## Riesgos

- **Doble línea en la actividad.** Cada `REVISAR:` por encima del tope deja dos entradas (puerta e `ingest`). Es inherente a tener dos hooks en el mismo `PreToolUse` y se ha preferido a una sola clave que saldría dos veces idéntica (decisión 1). Si molesta, M14 unifica el tratamiento del `REVISAR:` en la puerta.
- **El redactor insiste.** Tras el bloqueo, el modelo puede reintentar con otra redacción. El motivo le dice que no repita y que avise al jefe; cada reintento con «ronda N» se vuelve a bloquear sin efectos (sin `markRequested` ni commit). Un reintento sin «ronda N» pasa (fuera de alcance, ver Preguntas abiertas).
- **Segundo ciclo sin regla en la plantilla del revisor.** La plantilla solo contempla dos casos con bloqueantes: «la ronda es menor que {{maxRounds}}» → `MEJORAR:` y «es la ronda {{maxRounds}}» → `SIN ACUERDO:` (`plugin/templates/revisor-planes.md.tpl:28,40`). En todo el tramo `maxRounds+1 … 2·maxRounds` ninguna de las dos se cumple: el revisor no tiene regla clara y hará lo que le parezca (lo previsible es `MEJORAR:` mientras queden bloqueantes y, por tanto, ningún `SIN ACUERDO:` al final del tramo). El resultado es que el segundo ciclo termina con un bloqueo de la puerta en `cap+1` en vez de con un `SIN ACUERDO:`; el jefe recibe la queja del redactor y escala con `BLOQUEADO:` (formato en `lead-redaccion.md.tpl:50`). El comportamiento es seguro (no hay rondas de más); la redacción de las plantillas queda para otro encargo (Preguntas abiertas).
- **`SIN ACUERDO:` sin número de ronda.** Cubierto con el respaldo de la decisión 2 (ronda registrada del documento al insertar el veredicto) y el test C. Si además el documento no tiene ronda registrada (`documents.round` 0 porque nunca hubo `REVISAR:` con número), el tope no se renueva: `cap = maxRounds`, y el redactor recibe el motivo del bloqueo con la salida (avisar al jefe; subir «Rondas máximas» en Ajustes).
- **Hub caído.** Sin hub, `gate.sh` deja pasar (`plugin/hooks/gate.sh:3-6,17`) e `ingest` no corre: no se abre ronda en la oficina, pero el mensaje llega al jefe, que podría lanzar un revisor. Igual que hoy con `HECHO:`; lo cubre M11.
- **Conflicto en `office.ts` con M1+M2 / M3+M9.** Mitigado con la ejecución en serie y la tabla de ficheros tocados.
- **Cambio de `maxRounds` a mitad de plan.** Subirlo en Ajustes abre rondas al momento (`reload` → `refreshDocuments`); bajarlo puede dejar `round > maxRounds` en el panel («ronda 5/4»): es la verdad del estado y no se maquilla.

## Verificación

En el clon, rama del encargo:

```sh
cd /Users/victorsanblasgomez/Projects/agent-office-dev
cd hub && bun test test/departments.test.ts test/units.test.ts   # paso 1: rojo; único commit hasta el paso 6
cd .. && bun run typecheck                                       # pasos 2-3: hub y ui en verde (corrección sin confirmar)
cd hub && bun test                                               # paso 4: verde
cd ../ui && bun run typecheck && bun test                        # paso 5: verde (i18n.test.ts incluido)
cd .. && git status --short hub/src ui/src                       # paso 6: debe listar la corrección sin confirmar
git stash push -- hub/src ui/src                                 # no debe decir «No local changes to save»
(cd hub && bun test test/departments.test.ts)                    # rojo
git stash pop && (cd hub && bun test test/departments.test.ts)   # verde
git add -A && git commit -m 'feat: tope de rondas aplicado por la oficina (M13)'
bun run test && bun run typecheck                                # paso 6: el tester, desde la raíz
grep -rn maxRounds hub/src/                                      # ahora aparece en office.ts, documents.ts y gate.ts (E1 lo pedía)
```

Comprobaciones a mano, opcionales, con un hub de pruebas (`AGENT_OFFICE_HOME` y `AGENT_OFFICE_CLAUDE_HOME` temporales, `config.json` propio con otro `port` **y** `docsRepo` apuntando a un repositorio temporal, porque `office.start()` llama a `sync.cleanup`, que borra las fotos de `redaccion/.fuentes/*` que no estén en su base de datos):

- `curl -s -X POST http://127.0.0.1:<port>/gate-message -H 'X-Office-Key: <key>' -d '{"session_id":"…","hook_event_name":"PreToolUse","tool_name":"SendMessage","agent_id":"a1","agent_type":"redactor-x","cwd":"<docsRepo>/redaccion","tool_input":{"to":"team-lead","message":"REVISAR: redaccion/planes/x.md ronda 9"}}'` devuelve `block:Tope de rondas…` tras una sesión de `office-lead-redaccion` registrada en ese `cwd`.
- En el panel, Tabla → Redacción, la fila del plan muestra «ronda N/M».

## Preguntas abiertas

- ¿Debe bloquearse también un `REVISAR:` sin «ronda N»? Hoy pasa (y abre ronda con `round: null`, `documents.round` sin cambio). Se deja para M14, que ya convierte la puerta del `REVISAR:` en obligatoria.
- Las plantillas del revisor y del jefe hablan del tope como «la ronda {{maxRounds}}», y el revisor no tiene regla para las rondas entre `maxRounds+1` y `2·maxRounds` (Riesgos). Con el presupuesto renovable de la decisión 2 sería más exacto «la última ronda del presupuesto que indica el panel»; queda para un encargo de plantillas, que aquí están fuera.
- Si el usuario prefiere el tope plano (sin renovación tras `SIN ACUERDO:`), basta con que `roundCap` devuelva `maxRounds` y con quitar el test B; el resto del plan no cambia. La renovación se ha elegido porque sin ella el paso 7 de `lead-redaccion.md.tpl` deja de poder cumplirse sin tocar Ajustes.
