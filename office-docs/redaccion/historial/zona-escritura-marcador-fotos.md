# Historial: zona-escritura-marcador-fotos

## Ronda 1

Plan escrito sobre agent-office-dev build/v1 @ 7c89614 (2026-10-16). Veredicto: MEJORAR, nota 6/10, 3 bloqueantes y 7 menores. Todos aplicados en la ronda 2:

- B1 (zona de encargo rompía el flujo Bash del artesano: `guard.ts:207` marca `pdf` posicional como escritura): la zona de encargo solo rige en Edit/Write/MultiEdit/NotebookEdit; en Bash sigue la del departamento. `Zones.exact` eliminado; `office.ts:317` ya no cambia (office.ts pasa de cuatro a tres puntos). Test del artesano con cwd `/docs/taller`.
- B2 (criterio literal «BD vacía + carpetas de otro → aviso y no tocar nada»): paso 4 del `cleanup` nuevo; test «BD vacía + hub-b + huérfana hub-a → `[]` y las dos siguen».
- B3 (el caso `fantasma` adaptado pasa ya en A): corregido en Pasos y Verificación; ya no cuenta como fallo esperado.
- m4: adopción en pasada previa por slug, antes de clasificar.
- m5: fallback probado con `agent_type: 'redactor-otro'` sin `start`.
- m6: riesgo «BD restaurada con el mismo id» declarado como no cubierto.
- m7: test de `createIdIfMissing` en `units.test.ts`; fichero añadido a la tabla.
- m8: `README.md:158` en la documentación.
- m9: criterio `git diff --stat < 15` sustituido por el `grep` y la comprobación de que `office.ts:317` no aparece en el diff.
- m10: cita de `toAuthor` corregida (`ref.kind`, `ref.slug`).

Rechazados: ninguno.

## Ronda 2

Veredicto: APROBADO, nota 9/10. El plan no se toca más: cualquier cambio invalidaría la aprobación. El revisor dejó seis notas menores sin exigencia de aplicarlas; quedan aquí para quien ejecute el plan:

- README.md:158 está en «Probado en vivo»: mejor no reescribirla (nadie ha probado en vivo la zona por encargo) y, si no se cambia, el `grep "dos ficheros" README.md` de la Verificación 5 no dará coincidencia: ignorar esa comprobación o añadir una línea con fecha cuando se pruebe de verdad.
- Numeración de Riesgos desfasada respecto a Pasos: «paso 9 los cambia juntos» es el paso 10 (i18n) y «el git stash del paso 13» es el paso 14.
- M24: usar un único comando con los cuatro ficheros de test (guard, sync, departments, units) tanto en el Diseño como en el paso 14 y la Verificación 3.
- Verificación 6, segunda pasada: con `ajeno` aún marcado `otro-hub` y la base de datos vacía, el paso 4 del `cleanup` corta y no retira nada; hay que reescribir el marcador de `ajeno` o retirar esa carpeta antes de reiniciar.
- Paso 1: un `test(...)` con varios `expect` falla en el primero que no se cumple; «falla en los casos de bloqueo nuevos y solo en esos» se ve por test, no por caso.
- Carrera entre el `cleanup` en segundo plano del arranque (`office.ts:330`) y un `office-sync` en curso (worktree creado y marcado, sin `INSERT` todavía): puede retirar la foto que se está creando. Ya ocurre hoy; no lo introduce este plan.

Decisiones tomadas al redactar, por si el revisor las cuestiona:

- `zonesFor` recibe el nombre como tercer parámetro opcional (`= null`) para que las llamadas existentes compilen y para que «nombre desconocido» sea literalmente el código de hoy.
- `Zones.exact` para `taller/skills` del artesano: sin él, `init_skill.py … --path {{docsRepo}}/taller/skills` (flujo de `artesano.md.tpl:14`) se bloquearía en `guard.ts:256`.
- Carpetas sin marcador fuera de la base de datos: se avisan, no se borran. El caso `fantasma` de `sync.test.ts:108-112` se adapta escribiendo el marcador propio.
- `hubId` obligatorio en `OfficeOptions` (sin valor por defecto) para que dos hubs no compartan id por omisión; obliga a tocar `helpers.ts` y tres construcciones manuales de `Office` en tests.
- `main.ts` también crea el `id` si falta (además de `setup`), para que una instalación actualizada sin volver a pasar por `setup` marque sus fotos.
- `office.ts` se toca en cuatro puntos acotados; el plan lo declara en la tabla de ficheros como pide el brief.
