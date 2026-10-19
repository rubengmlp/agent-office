# Historial de revisión: tope-rondas-oficina

## Ronda 1

Plan inicial enviado a revisión. Decisiones tomadas al redactar, pendientes de veredicto:

- Función pura `decideReviewGate` en `gate.ts` y aplicación en los dos hooks (`gateMessage` y `handleProtocol`), con dos claves de actividad distintas.
- Tope efectivo renovable tras `SIN ACUERDO:` (`cap = maxRounds + ronda del último no-agreement`) para no romper el paso 7 de `lead-redaccion.md.tpl` sin tocar plantillas.
- `DocumentView.maxRounds` con el tope efectivo, pintado como «ronda N/M» en Tabla, estado y Planes; descartado leerlo de `store.settings` porque solo se carga al abrir Ajustes.

Veredicto: MEJORAR, nota 7/10.

Aplicados:

1. (bloqueante) Test A: `commitDocument` devuelve `unchanged` sin diff (`docs-repo.ts:49-50`). El plan se reescribe con contenido distinto antes de las rondas 2 y 3 (`writeFileSync` + `touch` + `h.clock.advance`) y se espera `idle()` antes de mirar el log; así la ronda 2 deja commit y, sin la corrección, la 3 también lo dejaría.
2. (bloqueante) M24 vs commits: la corrección queda sin confirmar en los pasos 2-5 (marcados «sin commit»); el paso 6 comprueba que `git stash push` guarda algo, y ofrece la alternativa `git checkout <commit de tests> -- hub/src ui/src`. Commit de la corrección después de la comprobación.
3. (menor) Paso 1: el test A falla primero en `toMatchObject({ maxRounds: 2 })`, no en `over.pass`; corregido el texto. El paso 2 indica que ahí pasa a fallar en `over.pass`.
4. (menor) `SIN ACUERDO:` sin ronda: respaldo al insertar el veredicto (`round ?? documents.round` solo para `no-agreement`), con el porqué de no hacerlo al consultar (el tope crecería con cada `REVISAR:`), test C nuevo y riesgo anotado.
5. (menor) Riesgo reescrito: en todo el tramo `maxRounds+1 … 2·maxRounds` el revisor no tiene regla; referenciado también en Preguntas abiertas.

Rechazados: ninguno.

## Ronda 2

Enviado con los cinco puntos aplicados.

Veredicto: APROBADO, nota 9/10. El plan no se toca más.

Menores que quedan como notas para quien implemente (no aplicados: la aprobación invalida cualquier cambio posterior):

1. Objetivo: escribir «N > tope efectivo (maxRounds sin SIN ACUERDO)» en vez de «N > config.review.maxRounds».
2. Motivo de `decideReviewGate`: plantilla literal sin comillas invertidas alrededor de los números, o `toContain('2 rondas')` falla.
3. Añadir un caso corto de Mantenimiento (artesano, `REVISAR: taller/skills/pdf-tools ronda 4` con maxRounds 3, bloqueado), siguiendo `departments.test.ts:565-573`.
4. `gateReview`: `pass` cuando `!ref`, para conservar el comportamiento de hoy (`handleProtocol` ya ignora ese mensaje, `office.ts:1049`).
5. Verificación: `git add hub/src ui/src` en vez de `git add -A`.
6. Paso 5: una grabación anterior no trae `maxRounds`; verificar con hub de pruebas o usar `table.round` como respaldo si `doc.maxRounds` no es número.
7. La renovación tras `SIN ACUERDO:` también aplica a Mantenimiento, cuya plantilla no vuelve al paso 4 (`lead-mantenimiento.md.tpl:33`); inofensivo, anotarlo.
