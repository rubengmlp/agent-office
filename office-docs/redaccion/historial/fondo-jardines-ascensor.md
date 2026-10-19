# Historial — fondo-jardines-ascensor

## Ronda 1 (2026-10-16)

Plan enviado a revisión. Decisiones tomadas al escribirlo:

- Controlador de ascensor puro y compartido (`ui/src/lift.ts`) para que la lógica se teste sin pixi ni three y las dos vistas solo pinten.
- Detección del viaje por el par de puntos en la boca del ascensor que ya generan `liftRoute` y `planPath`, sin cambiar las rutas ni los tests que las cubren.
- Fondo 2D con cielo arriba, jardín abajo y márgenes laterales de 12 px lógicos; la constante se puede dejar a 0 si el revisor no quiere ceder ancho.
- La torre acristalada del 3D pasa a ser el vestíbulo con puerta a la calle; el camino del jardín arranca de ella para que `planPath` no cambie.
- Verificación manual con el replay `demo.json` en `bun run dev` con `AGENT_OFFICE_HOME` temporal, sin levantar hub.
- Sin cambios en `hub/`, `store.ts`, `types.ts`, `i18n/`, `panel/` ni `styles.css`, para no pisar el plan paralelo del chat interno.

Veredicto: MEJORAR, nota 6/10. 4 bloqueantes, 8 menores.

## Ronda 2 (2026-10-16)

Aplicados todos los puntos de la ronda 1:

1. (bloqueante) En 3D la calle `STREET` pasa a ser una parada del ascensor con la coordenada de `mainGround`; `servesLift` pura en `layout.ts` compara coordenadas, con tests. Rellano de calle fuera de la puerta z1 y segundo par de puertas en la cabina (D2, D7).
2. (bloqueante) Plaza fija por agente: nuevo `ParkingLot` puro (`ui/src/parking.ts`) con `reserve/release`, `depart` pendiente y tests (D1b).
3. (bloqueante) La cúpula de cielo sigue a la cámara cada frame, radio 240, `depthWrite: false`, `renderOrder -1` (D6).
4. (bloqueante) `cancel` en destroy/recreación/`snapToTarget`; `maxDwell` cancela al viajero que no confirma; tests (g), (h), (i) (D1).
5. (menor) Cifras reales de mesas por fila con `SIDE_MARGIN = 12` en D3 y Riesgos.
6. (menor) `applyScroll` fija `world.x` en cada frame (D3, paso 9).
7. (menor) Una sola referencia de altura: `room.origin.y` para paradas, cabina y viajero (D2, D7).
8. (menor) `Point.floor?` en 2D; detección del par por `floor` distinto (D2, paso 4).
9. (menor) `moving` verdadero y pose idle durante espera/viaje, escrito en D2.
10. (menor) Calzada en 2D (`GARDEN_ROAD_Y`) y pasillo peatonal + salida marcha atrás por la carretera en 3D (D4, D6).
11. (menor) Llegadas 3D desde el borde de la carretera: `streetPoint` cambia y se actualizan sus tests (D6, paso 13).
12. (menor) Definidos `gardenTop`, posición inicial de la cabina y `depart` con coche ausente (D1, D1b, D3).

Rechazados: ninguno.

Veredicto: MEJORAR, nota 6/10. 2 bloqueantes, 6 menores.

## Ronda 3 (2026-10-16)

Aplicados todos los puntos de la ronda 2:

1. (bloqueante) `hold = lot.boarding(key)` en vez de `!carReady`; `depart(key)` encola por agente y `boarding` cae en el mismo tick en que su coche pasa a `leaving`. Test (f) (D1b, D4, D6).
2. (bloqueante) Desbordamiento de plazas: reservas compartidas con cola FIFO por plaza, `quickReturn` cuando hay cola, `reserve` nunca falla. Test (g) con N+2 agentes (D1b).
3. (menor) Cifra corregida: ceder 24 px quita una mesa por fila en ≈ 57 % de los anchos. Decisión: `SIDE_MARGIN = 0` por defecto; la pregunta abierta pasa a ser si subirlo (D3, Riesgos).
4. (menor) `snapToTarget()` nuevo en `CharacterView` 2D para `cancelled` (D2, paso 8).
5. (menor) `site.liftStops` como getter; `Site.update` sigue devolviendo `boolean` (paso 15).
6. (menor) El camino cruza el aparcamiento: se descartan las plazas que solapan `exitX ± 1` (D6).
7. (menor) Salida 2D con un solo `gate(ground)`: `gardenRoute(...).slice(1)` dentro de `liftRoute` (D4).
8. (menor) Puertas de la cabina 3D por caras servidas con `controller.servedAt()` (D1, D7).

Rechazados: ninguno.

Veredicto: MEJORAR, nota 8/10. 1 bloqueante, 8 menores.

## Ronda 4 (2026-10-16)

Aplicados todos los puntos de la ronda 3:

1. (bloqueante) Replanificación 2D a media subida: `CharacterView` guarda `pendingTarget`, descarta la ruta, y con `arrived` marca `needsPath`; `OfficeView.update` recalcula `buildPath` desde la planta de destino en el mismo frame (D2, pasos 8 y 9). Sin test unitario porque `CharacterView` depende de pixi; cubierto en la verificación manual (punto 4) y anotado en Riesgos.
2. (menor) `liftRoute(from, to, ...rest)` (D4, paso 4).
3. (menor) El paso 4 reescribe los tres tests de "leaving the 2D office" y las llamadas a `liftGate(layout, top, slug)`.
4. (menor) `gardenArrival(door, pathY, gate)` propia para la llegada (D4, paso 4).
5. (menor) `release` quita la salida de la cola de `depart`; liberación al dejar de estar `away` en el paso 9 (D4).
6. (menor) Puertas de cristal en la cabina 2D; atenuación aceptada en Riesgos (D5).
7. (menor) `placeAt` de la posición vieja al recrear la vista por `look` (D4, paso 9).
8. (menor) Clip `walk` y `pad` oculto también en el escalón planta baja ↔ calle (D7, paso 16).
9. (menor) Referencia de `Character.dispose` corregida a `characters.ts:322-327` (D1).

Rechazados: ninguno.

Veredicto: SIN ACUERDO. 1 bloqueante (viajes 3D anexo → planta alta del principal no pasan por la cabina: la detección del par no cubre la llegada por la pasarela de la cara x1) y 6 notas menores. El plan no se toca hasta que decida el usuario; posición enviada al jefe: el bloqueante es correcto y el arreglo propuesto (detectar el par (at, path[0]), rellano fuera de x1, tercer par de puertas, test y punto manual) es viable sin cambiar alcance ni ficheros.

Decisión del usuario: opción (a), ronda 5 con los arreglos.

## Ronda 5 (2026-10-16)

Aplicado el bloqueante y las seis notas de la ronda 4:

1. (bloqueante) Dos reglas de detección sobre la posición real (`liftLeg` pura en `layout.ts`, con `fromFace`/`toFace`), rellano de pasarela fuera de la cara x1 acortando el lerp de `planPath`, tercer par de puertas en x1 y `servedFaces()` en lugar de `servedAt()`; tests de `servesLift` (5) y `liftLeg` (4) en `layout.test.ts`, test (j) en `lift.test.ts`, punto manual director ↔ jefe de mantenimiento (D1, D2, D7, pasos 2, 13, 14, 16, Verificación 4).
2. (menor) Plazas descartadas: 2, quedan 5; `bayX[]` de plazas útiles y `lot.resize(bayX.length)` (D6).
3. (menor) `lot.release` en 3D al dejar de estar `away` (D6, paso 17).
4. (menor) Anillo de manzanas y desaparición de coches atados a `far` con `setFar` (D6, paso 11, 14, 17).
5. (menor) `stepDown` que decae al cruzar la puerta z1 para que el pie no se hunda en el zócalo (D2, paso 16).
6. (menor) `depart` idempotente por `key` (D1b, D4).
7. (menor) `gardenArrival` antepone `(from.x, pathY)` cuando `from.y > pathY` (D4).

Rechazados: ninguno.

Veredicto: APROBADO, nota 8/10. El plan no se toca más. Seis notas menores que quedan para quien ejecute el plan: (1) el test de `liftLeg` en la ruta inversa debe poner `at` en el pasillo justo antes de la boca, con la ruta ya recortada; (2) en 2D la planta actual es `path[0].floor` y falta crear y probar el `liftLeg` 2D en el paso 4; (3) unificar la firma de `gardenArrival` a `(from, door, pathY, gate)`; (4) `exitX` real en la demo es 10.2 o 11.25 según columnas, así que el número de plazas útiles no es fijo: comprobar "las que no se solapan con el camino"; (5) aplicar el mínimo de 3 plazas sobre las útiles, no antes de descartar; (6) en 2D, `buildPath` debe comprobar `from.y >= gardenTop` también para `kind: 'exit'`.
