# Fondo, zona de jardines con jardineros y coches, y ascensor real en la oficina

## Contexto

La escena de la oficina (vistas 2D con pixi.js y 3D con three.js) pinta el edificio sobre un color plano (`--canvas-bg`), no tiene exterior y los cambios de planta no se ven como un viaje: en 2D el personaje recorre en línea recta la columna del ascensor (`ui/src/office/layout.ts:152-159`, `ui/src/office/office.ts:374-382`) y en 3D hace un lerp vertical con un disco bajo los pies (`ui/src/scene/characters.ts:509-536`, `ui/src/scene/characters.ts:304`). Un agente que termina ya "se va": el hub marca `away` (`hub/src/office.ts:762-764`, `hub/src/office.ts:1641`), la UI lo manda a un objetivo `exit` en la acera y lo desvanece (`ui/src/office/office.ts:321-327`, `ui/src/scene/scene.ts:455`), pero no hay jardín, ni coche, ni nada que ver fuera.

Base sobre la que se escribe:

- agent-office-dev build/v1 @ 7c89614 (2026-10-16)

Todo el trabajo se hace en el clon `/Users/victorsanblasgomez/Projects/agent-office-dev`, nunca en la copia en vivo (`CLAUDE.md` del repo, reglas 1 a 5).

## Objetivo

1. Fondo para la escena de la oficina (hoy no hay).
2. Zona de jardines fuera del edificio con jardineros animados y coches aparcados.
3. Un agente que termina "se va a casa": sale del edificio, cruza el jardín, sube a su coche y el coche se marcha. Se reutiliza el estado actual de agentes terminados/away, no se inventa otro.
4. Ascensor real: los agentes que cambian de planta usan un ascensor visible que sube y baja entre pisos, en vez de aparecer en el destino.

Criterios de aceptación (literal del encargo):

- Fondo visible en ambas vistas sin tapar agentes ni etiquetas.
- Jardín con ≥1 jardinero animado y varios coches.
- Agente que termina recorre edificio, jardín y coche, el coche se va y el agente desaparece.
- Agente que cambia de planta viaja en el ascensor sin aparecer de golpe.
- `bun run test`, `bun run typecheck` y `bun run build` pasan en el clon, validados por el tester de la planta.

## Alcance

Entra:

- Interfaz de la oficina, vistas 2D (`ui/src/office/`) y 3D (`ui/src/scene/`), en dos fases dentro de este plan: fase 1 la 2D, fase 2 la 3D. Las dos comparten un controlador de ascensor puro y testeable.
- Tests unitarios nuevos del controlador del ascensor y ajuste de los tests de rutas existentes.

Fuera:

- Hooks del plugin, protocolo de agentes, base de datos del hub.
- Servidor del hub: no hace falta exponer ningún dato nuevo. La UI ya recibe `away`, `endedAt`, `floor` y `roleKind` en `AgentView` (`hub/src/types.ts:321-341`), que es todo lo que necesitan el viaje a casa y el ascensor. Este plan no toca `hub/`.
- Textos: ningún elemento nuevo lleva texto visible, así que no se añaden claves a `ui/src/i18n/`. Los literales nuevos en código (nombres de clips, claves de materiales) van sin tildes ni `¿¡`, porque `ui/test/i18n.test.ts:124-136` falla con cualquier literal acentuado fuera de `i18n/`.
- Llegada en coche de los agentes nuevos (entran andando desde el borde del jardín; ver Preguntas abiertas).

### Ficheros y carpetas que toca este plan

Se ejecuta en paralelo con el plan del chat interno de agentes (`redaccion/planes/chat-interno-agentes.md`). Su sección «Carpetas y ficheros que toca este plan» declara, a fecha de esta ronda, que edita `hub/**`, `plugin/**`, `ui/src/main.ts`, `ui/src/topbar.ts`, `ui/src/store.ts`, `ui/src/api.ts`, `ui/src/i18n/es.ts`, `ui/src/i18n/en.ts` y crea `ui/src/chat/**`, y que no toca `ui/src/office/**`, `ui/src/scene/**`, `ui/src/sprites/**`, `ui/public/**` ni `ui/src/styles.css`. Este plan se queda en la escena y en los ficheros compartidos que el otro declara no tocar; los conjuntos son disjuntos.

Ficheros nuevos:

- `ui/src/lift.ts` — `LiftController`, lógica pura del ascensor compartida por 2D y 3D.
- `ui/src/lift.test.ts` — tests del controlador (bun test, sin pixi ni three).
- `ui/src/parking.ts` — `ParkingLot`, lógica pura del aparcamiento (plazas, reservas por agente, estados de los coches), compartida por 2D y 3D.
- `ui/src/parking.test.ts` — tests del aparcamiento.
- `ui/src/office/backdrop.ts` — cielo, horizonte y azotea 2D.
- `ui/src/office/garden.ts` — jardín 2D: césped, camino, setos, jardineros, plazas y coches.
- `ui/src/office/lift-cabin.ts` — cabina 2D pintada a partir del controlador.
- `ui/src/scene/backdrop.ts` — cúpula de cielo y manzanas lejanas 3D.
- `ui/src/scene/garden.ts` — jardín 3D: césped, camino, setos, árboles, jardineros, aparcamiento, carretera y coches.
- `ui/src/scene/lift-cabin.ts` — cabina 3D dentro de la torre acristalada.

Ficheros existentes que se modifican:

- `ui/src/office/constants.ts`, `ui/src/office/layout.ts`, `ui/src/office/layout.test.ts`, `ui/src/office/furniture.ts`, `ui/src/office/character-view.ts`, `ui/src/office/office.ts`.
- `ui/src/scene/constants.ts`, `ui/src/scene/layout.ts`, `ui/src/scene/layout.test.ts`, `ui/src/scene/materials.ts`, `ui/src/scene/buildings.ts`, `ui/src/scene/characters.ts`, `ui/src/scene/scene.ts`.

Lo que este plan NO toca, para no pisar al plan del chat:

- `hub/**` completo (servidor, API, tipos, base de datos, tests del hub).
- `ui/src/store.ts`, `ui/src/types.ts`, `ui/src/api.ts`, `ui/src/live.ts`, `ui/src/actions.ts`, `ui/src/main.ts`, `ui/src/topbar.ts`, `ui/src/styles.css`.
- `ui/src/panel/**`, `ui/src/i18n/**`, `ui/src/table/**`, `ui/src/plans/**`, `ui/src/settings/**`.
- `ui/src/scene/scene.css`, `ui/src/scene/labels.ts`, `ui/src/scene/camera.ts`, `ui/src/scene/picking.ts`, `ui/src/scene/effects.ts`, `ui/src/scene/furniture.ts`, `ui/src/scene/assets.ts`, `ui/src/scene/rig.ts`, `ui/src/scene/batch.ts`.
- `ui/src/office/floor-scene.ts`, `ui/src/office/palette.ts`, `ui/src/office/pixel.ts`, `ui/src/office/effects.ts`, `ui/src/office/meetings.ts`, `ui/src/sprites/sprites.ts`.
- `plugin/**`, `ui/public/**`.

## Diseño

### D1. Un controlador de ascensor puro, compartido por las dos vistas

Las dos vistas necesitan la misma máquina de estados (cabina parada, en marcha, abriendo, abierta, cerrando; cola de viajeros; parada por planta) y hoy cada una tiene su propio pseudoascensor. Se escribe una sola vez en `ui/src/lift.ts`, sin dependencias de pixi ni three, con coordenadas abstractas (un número por parada: `y` lógica en 2D, altura del mundo en 3D). Así se testea con `bun test` en segundos y las dos vistas solo pintan.

```ts
export type LiftFace = 'room' | 'street' | 'bridge'; // por que cara entra o sale el viajero (2D solo usa 'room')
export type LiftRider = { key: string; from: string; to: string; fromFace: LiftFace; toFace: LiftFace };
export type LiftEvent =
  | { type: 'boarded'; key: string }    // puertas abiertas en `from`: el viajero puede entrar
  | { type: 'arrived'; key: string }    // puertas abiertas en `to`: el viajero sale
  | { type: 'cancelled'; key: string }; // la parada desaparecio: el viajero debe recolocarse
export type LiftPhase = 'idle' | 'moving' | 'opening' | 'open' | 'closing';

export class LiftController {
  constructor(options: { speed: number; doorTime: number; dwell: number; maxDwell: number });
  setStops(stops: ReadonlyMap<string, number>): void; // slug -> coordenada; si esta parada, se ajusta a la nueva coordenada de `at`
  request(rider: LiftRider): void;                     // viajero esperando en `from`
  aboard(key: string): void;                           // el viajero ya esta dentro: la cabina puede cerrar
  cancel(key: string): void;
  tick(dt: number): LiftEvent[];
  get position(): number;   // coordenada actual de la cabina
  get doors(): number;      // 0 cerradas .. 1 abiertas
  get at(): string | null;  // parada en la que esta detenida, o null en marcha
  get phase(): LiftPhase;
  get riders(): readonly string[]; // dentro de la cabina
}
```

Reglas de la máquina:

- `idle`: si hay viajeros dentro, destino = `to` del primero que subió; si no, destino = `from` del primer esperando. Si `stops.get(dest) === position`, pasa a `opening` (y `at = dest`); si no, a `moving`.
- `moving`: `position` avanza hacia `stops.get(dest)` a `speed`. Al llegar, `at = dest`, `opening`.
- `opening`: `doors` sube a razón `1/doorTime`. Al llegar a 1: emite `arrived` para todos los de dentro cuya parada `to` tenga la misma coordenada que `at` (y los saca), emite `boarded` para los que esperan con `from` en esa coordenada (pasan a "entrando"), empieza `dwell`.
- `open`: cierra cuando no queda nadie "entrando" y han pasado `dwell` segundos. Si se superan `maxDwell` segundos con alguien "entrando" sin confirmar `aboard`, ese viajero se **cancela** (`cancelled`, sale de la cola) y la cabina cierra; así nunca se queda abriendo y cerrando en la misma planta por un viajero que no llega.
- `closing`: `doors` baja a 0, vuelve a `idle`.
- `request` con `from` en la coordenada de `at` y fase `open`: emite `boarded` en el mismo tick.
- `cancel(key)` saca al viajero de donde esté (esperando, entrando o dentro) sin evento. Si estaba dentro, la cabina sigue con el siguiente destino de la cola.
- `setStops` sin el slug de un viajero (dentro o esperando) → `cancelled`.
- Posición inicial: la coordenada de la parada que la vista declare como planta baja en el primer `setStops` (2D: la última de `sceneOrder`; 3D: `nav.mainGround`), puertas cerradas, `idle`.
- Dos slugs pueden compartir coordenada (en 3D la calle `STREET` se registra con la coordenada de `mainGround`, D7). Las comparaciones de "misma parada" se hacen por coordenada, no por slug.

Por qué FIFO y una sola cabina: es lo que ya hay dibujado en 3D (una torre en el edificio principal, `ui/src/scene/buildings.ts:580-604`) y en 2D (una columna por planta, `ui/src/office/furniture.ts:145-152`), y es la lógica más fácil de leer en pantalla. El anexo 3D sube por escalera y no usa el controlador (sigue con el lerp actual).

Ciclo de vida de los viajeros: toda vista que destruya o recree un personaje, o lo recoloque de golpe, llama antes a `lift.cancel(key)`. En 2D: al cambiar de `look` (`ui/src/office/office.ts:209-212`), al limpiar entradas (`ui/src/office/office.ts:242-247`) y en `CharacterView.destroy`. En 3D: en `Character.dispose` (`ui/src/scene/characters.ts:322-327`, llamado desde el bucle de limpieza `ui/src/scene/scene.ts:397-403`) y en `snapToTarget` (`ui/src/scene/characters.ts:459-468`). Sin esto un viajero fantasma bloquearía la cola FIFO.

Para las puertas de la cabina 3D (tres caras, D7) el controlador expone `servedFaces(): readonly LiftFace[]`: las caras (`fromFace` de los que han recibido `boarded`, `toFace` de los que han recibido `arrived`) servidas en la parada abierta actual (se vacía al cerrar). La cabina abre cada cara servida, no la de `at`: en la planta baja coinciden la sala (`room`), la calle (`street`) y la pasarela al anexo (`bridge`), y un slug no basta para distinguirlas (sala y pasarela son las dos `mainGround`). Si un viajero sale a la calle y otro espera en la sala, se abren las dos caras.

### D1b. Un aparcamiento puro, compartido por las dos vistas

La plaza de un agente tiene que quedar fija desde que decide irse hasta que su coche se ha marchado: `resolveTarget` se recalcula cada `MEETING_REFRESH_S` y en cada `sync` (`ui/src/office/office.ts:264-311`, `ui/src/scene/scene.ts:427-448`), y con el mismo `id: 'exit'` y el personaje parado, `setTarget` recoloca de golpe (`ui/src/office/character-view.ts:134-140`, `ui/src/scene/characters.ts:239-245`). Por eso la elección de plaza no se recalcula: se **reserva**.

```ts
export type CarState = 'parked' | 'leaving' | 'away' | 'arriving';
export type Car = { bay: number; state: CarState; progress: number; seed: number }; // progress 0..1 dentro de leaving/arriving
export class ParkingLot {
  constructor(bays: number, options: { leaveTime: number; returnAfter: number; quickReturn: number; arriveTime: number });
  resize(bays: number): void;           // conserva reservas y estados de las plazas que siguen existiendo; las reservas de plazas eliminadas pasan a la plaza con menos reservas
  reserve(key: string): number;         // plaza fija para `key`; si ya tiene, la misma. Elige la plaza con menos reservas; a igualdad, hashString(key) % bays y siguientes. Nunca falla: varias keys pueden compartir plaza
  release(key: string): void;           // libera la reserva y quita a `key` de la cola de salida de su plaza (al destruir el personaje o cuando deja de estar away)
  bayOf(key: string): number | null;
  carReady(bay: number): boolean;       // hay coche `parked`
  depart(key: string): void;            // encola la salida de `key` en su plaza (FIFO por plaza); idempotente: si `key` ya esta encolada o ya se fue, no hace nada
  boarding(key: string): boolean;       // verdadero mientras la salida de `key` sigue encolada; falso en cuanto su coche ha pasado a `leaving` por el o si no tiene salida encolada
  tick(dt: number): void;               // por plaza: si el coche esta `parked` y hay cola, saca al primero y pasa a `leaving`; leaving: progress → 1 (leaveTime) → away; away: tras returnAfter (o quickReturn si la cola no esta vacia) → arriving; arriving: progress → 1 (arriveTime) → parked
  get cars(): readonly Car[];
}
```

Cómo encajan `depart`, `boarding` y `hold`: el agente llama a `depart(key)` al llegar a la plaza; en el mismo `tick` el coche pasa a `leaving` y `boarding(key)` se vuelve falso, así que `hold = lot.boarding(key)` deja de retener al personaje y éste se desvanece mientras el coche espera su primer segundo con los faros encendidos y arranca. Si el coche está `away` o `arriving` (porque otro agente de la misma plaza acaba de irse), `boarding(key)` es verdadero y el personaje espera visible hasta que el coche vuelve, se aparca y arranca con él. Nunca se usa `carReady` para `hold`: justo después de `depart` es falso aunque el coche se esté yendo con el agente.

Desbordamiento: la reserva no falla nunca. Si hay más agentes `away` que plazas (en `ui/public/replays/demo.json` se van 9 agentes al final con 3-7 plazas), varios comparten plaza y salen en orden FIFO: el coche de la plaza se va con el primero, vuelve antes (`quickReturn = 1.5` s en lugar de `returnAfter`) porque hay cola, y se lleva al siguiente. Los que esperan en la misma plaza se superponen en el mismo punto unos segundos; se acepta (ver Riesgos).

Las vistas solo pintan `cars` (posición por `bay`, `state` y `progress`) y preguntan `bayOf`/`boarding`. Tests en `ui/src/parking.test.ts`: (a) `reserve` devuelve la misma plaza en llamadas sucesivas, después de `depart` y mientras su coche está `leaving`/`away`; (b) dos agentes no comparten plaza mientras haya plazas libres; (c) `depart` con coche `away` queda encolado y arranca al volver a `parked`; (d) `release` permite que otro agente obtenga esa plaza; (e) el ciclo `leaving → away → arriving → parked` respeta los tiempos, y con cola usa `quickReturn`; (f) tras `depart` con coche `parked`, `boarding(key)` es falso en el siguiente `tick`; con coche `away`, es verdadero hasta que el coche vuelve y arranca; (g) N+2 agentes con N plazas: todos obtienen plaza, ninguna plaza tiene más de dos reservas, y tras suficientes `tick` todos los `boarding` son falsos y se han producido N+2 salidas.

### D2. Protocolo de viaje del personaje (igual en 2D y 3D)

No se cambian las rutas que ya calculan `liftRoute` (2D) y `planPath` (3D): ambas ponen dos puntos consecutivos en la boca del ascensor, uno en la planta de origen y otro en la de destino (`ui/src/office/layout.ts:152-159`, `ui/src/scene/layout.ts:270-282`). Cada punto lleva su planta: en 3D `Waypoint.floor` ya existe; en 2D los puntos de `buildPath` ganan `floor?: string`, que `buildPath` rellena en los dos puntos de boca de ascensor (`gate`). En 2D la puerta del jardín (`gardenDoor`) comparte `x` con `gate(ground)` pero no lleva `floor`, así que no se confunde con un viaje.

El personaje detecta el viaje en `advance` con dos reglas, siempre sobre su posición real `at` (nunca mira pares que empiecen en otra planta):

- **Regla A (ya en la boca).** `path[0].floor !== at.floor` y `serves(at.floor, path[0].floor)`: el personaje está en la boca del ascensor de su planta y el siguiente punto es la boca de otra planta servida. Es el caso de quien llega a la torre por la pasarela del anexo (D7) y de quien ya estaba en la boca.
- **Regla B (aproximación en la misma planta).** `path[0].floor === at.floor`, `path[0]` es la boca de su planta, `path[1]` existe con otra planta y `serves(path[0].floor, path[1].floor)`: antes de llegar a la boca se desvía al rellano.

Con la ruta anexo → planta alta `[(mantenimiento, aX), (redaccion, mX), (direccion, mX), …]` (`ui/src/scene/layout.ts:274-281`), estando en `mantenimiento` no se cumple ninguna de las dos (el par `(redaccion, direccion)` no empieza en `at.floor`), así que el personaje hace su lerp por la pasarela como hoy; ese lerp termina en el rellano de pasarela (D7) y entonces se cumple la regla A con `from = redaccion`, `to = direccion`. La dirección contraria (planta alta → anexo) usa la regla B en la planta alta y sale por la cara de pasarela en la planta baja porque su `toFace` es `bridge`.

La detección es una función pura `liftLeg(at, path, nav, stops, viaBridge): LiftLeg | null` en `ui/src/scene/layout.ts` (y la equivalente 2D en `ui/src/office/layout.ts`), con `LiftLeg = { from, to, fromFace, toFace, approach: boolean }`: `fromFace` es `street` si `from === STREET`, `bridge` si `viaBridge` (el personaje acaba de llegar por un lerp horizontal desde otro edificio), `room` si no; `toFace` es `street` si `to === STREET`, `bridge` si el punto que sigue al par está en otro edificio (`buildingOf` por `nav.floors`), `room` si no. Así se testea sin personaje.

1. **Aproximación.** En vez de meterse en el hueco, camina hasta el **rellano** de su cara (`lift.landing(from, fromFace)`): en 2D `{ x: lift.x - LANDING_DX, y: top + walkY }` (a la izquierda del hueco); en 3D, `room` = `{ x: exitX - LANDING_DX, z: AISLE_Z }` (justo dentro de la sala, delante de la puerta lateral que ya existe en `sideWall`, `ui/src/scene/buildings.ts:157-185`), `street` = `{ x: exitX, z: AISLE_Z + LIFT_W/2 + 0.6 }` (fuera de la puerta de calle de la torre, D6) y `bridge` = `{ x: exitX + LIFT_W/2 + 0.6, z: AISLE_Z }` (en la pasarela, fuera de la cara `x1`, D7). Con la regla A el personaje ya está en su rellano y no camina. Al llegar llama a `lift.request({ key, from, to, fromFace, toFace })` y espera en pose idle.
2. **Embarque.** Con el evento `boarded` camina del rellano al centro de la cabina (`lift.cabin(from)`: en 2D `{ x: lift.x + lift.w/2, y: top + walkY }`; en 3D `{ x: exitX, z: AISLE_Z }`, que ya es el centro de la torre, `ui/src/scene/buildings.ts:470`) y llama a `lift.aboard(key)`.
3. **Viaje.** Mientras está dentro, su coordenada vertical es la de la cabina: en 2D `y = controller.position`; en 3D la `y` del mundo es exactamente `controller.position`, porque las paradas se registran con `room.origin.y`, que ya es absoluta (`ui/src/scene/buildings.ts:466`), y la cabina se pinta en esa misma `y`. Una sola referencia para paradas, cabina y viajero. La pose es idle (en 3D el clip `idle`, como hoy en los transfers verticales, `ui/src/scene/characters.ts:559`).
4. **Salida.** Con `arrived`, su posición pasa a ser `lift.cabin(to)` en la planta destino, consume los dos puntos del par y sigue su ruta normal (en 3D el siguiente punto ya es `{ x: target.lane, z: AISLE_Z }`, `ui/src/scene/layout.ts:284`; con `toFace = street` ese punto lo saca por la puerta de calle de la torre; con `toFace = bridge` el siguiente punto está en el anexo y el lerp horizontal lo saca por la cara `x1`). En 3D con `to === STREET` el centro de la torre a nivel de acera queda 0,29 m por debajo del suelo de la cabina y dentro del zócalo (`ui/src/scene/buildings.ts:589`); para que no se vea el pie hundido, `Character` mantiene un desnivel `stepDown = PLINTH_H - SIDEWALK_Y` que suma a su `y` y que decae linealmente a 0 en los primeros `LIFT_W/2 + 0.3` m andados desde la cabina (justo al cruzar la puerta `z1`): baja el escalón al salir, no dentro.

Mientras espera, entra o viaja, `moving` sigue siendo verdadero (así `exitAlpha`/`fadeAlpha` no empiezan a desvanecer y las vistas no lo tratan como "sentado"), pero la pose es idle: en 2D `walkClock` no avanza y `poseWalking` no se aplica (`ui/src/office/character-view.ts:151,170`); en 3D `decide` recibe `moving` y `ride !== null` y elige `idle`, como hace ya con `transfer.vertical` (`ui/src/scene/characters.ts:559`).

Replanificaciones (`setTarget` con otro `id`) durante la espera cancelan la petición (`lift.cancel`) y recalculan. Durante el viaje, las dos vistas difieren porque solo el 3D planifica dentro del personaje:

- 3D: se guarda como `pendingReplan` y al salir `replan()` llama a `planPath` con su `nav`, como hace ya con `transfer` (`ui/src/scene/characters.ts:470-482`, `:530-533`).
- 2D: `CharacterView` no planifica; la ruta la calcula `OfficeView.buildPath` desde `entry.view.position` (`ui/src/office/office.ts:310`, `:374-382`), y una ruta calculada a media subida partiría de una `y` entre plantas (`sceneAt` devolvería la planta que la cabina estuviera cruzando). Por eso, durante el viaje `setTarget` guarda solo el `Target` nuevo (`pendingTarget`) y **descarta la ruta recibida**. Con `arrived`, el personaje queda en `lift.cabin(to)`, adopta `pendingTarget` como `target` y pone `needsPath = true` (getter público). `OfficeView.update`, tras repartir los eventos del controlador, recorre las entradas con `needsPath` y les da `view.setPath(buildPath(view.position, view.target, scene))`, calculada ya desde la planta de destino, en el mismo frame. Las llamadas posteriores de `assignTargets` con el mismo `id` siguen el camino de siempre (`ui/src/office/character-view.ts:130-140`) sobre una ruta válida.

Un `cancelled` recoloca al personaje de golpe en su objetivo: en 3D con el `snapToTarget` que ya existe (`ui/src/scene/characters.ts:459-468`, que a su vez llama a `cancel`, idempotente); en 2D no hay equivalente (`CharacterView` solo tiene `placeAt` y la rama de salto de `setTarget`, `ui/src/office/character-view.ts:106-141`), así que `CharacterView` gana `snapToTarget()` = `lift.cancel(key)`, `ride = null`, `placeAt({ x: target.x, y: target.y })`.

El personaje recibe el servicio por `setTarget` (2D: `setTarget(target, path, lift)`; 3D: `setTarget(target, nav, lift)`), con esta interfaz mínima para no acoplarlo al controlador entero:

```ts
export type LiftService<P> = {
  serves(from: string, to: string): boolean;
  landing(floor: string, face: LiftFace): P; // punto del rellano de esa cara (2D: Point; 3D: { x, z } locales de la planta)
  cabin(floor: string): P;          // punto del centro de la cabina
  request(rider: LiftRider): void;
  aboard(key: string): void;
  cancel(key: string): void;
  position(): number;
  take(key: string): LiftEvent | null; // eventos pendientes del viajero `key`
};
```

`OfficeView`/`OfficeScene` llaman a `controller.tick(dt)` una vez por frame y reparten los eventos por `key` a los personajes.

### D3. Vista 2D: disposición del mundo

Hoy el mundo es la pila de plantas a ancho completo (`ui/src/office/office.ts:171-192`). Se le añaden tres franjas, en coordenadas del edificio, dentro de `backgrounds`:

- **Cielo** arriba: `SKY_H = 32` px lógicos. Las plantas pasan a empezar en `top = SKY_H`.
- **Márgenes laterales**: `SIDE_MARGIN = 0` por defecto. La constante existe y el código la respeta (el edificio se calcula con `width = logicalWidth - 2 * SIDE_MARGIN`, y `applyScroll`, `ui/src/office/office.ts:442`, pasa a colocar `world.position.set(SIDE_MARGIN * SCALE, -round(scrollY) * SCALE)`, porque hoy reescribe `x = 0` en cada frame), pero se deja a 0 por su coste: el paso de mesa es de 42 px (`SLOT_W + 2`, `ui/src/office/layout.ts:83`), así que ceder 24 px quita una mesa por fila en 24/42 ≈ 57 % de los anchos posibles (por ejemplo a 340 lógicos, hoy `xMax = 224` y una planta con jefe coloca 4 mesas en x = 58, 100, 142, 184; con margen 12, `xMax = 200` y caben 3). El fondo 2D se ve arriba (cielo) y abajo (jardín), que es donde no cuesta ancho. Subirlo a 12 es un cambio de una constante, si se prefiere ver cielo a los lados.
- **Jardín** abajo: `GARDEN_H = 80` bajo la última planta (la de abajo es la planta baja, `sceneOrder[last]`, `ui/src/office/office.ts:215`). `gardenTop = ground.top + ground.layout.height + FLOOR_GAP` (el `FLOOR_GAP` queda dentro del portal, pintado por el jardín). `worldHeight = SKY_H + plantas + GARDEN_H`; el scroll ya existente (`ui/src/office/office.ts:432-453`) absorbe el alto extra.

`ui/src/office/backdrop.ts` (`Backdrop`, un `Graphics` + nubes) pinta: bandas de cielo (3-4 tonos), siluetas de edificios lejanos tras la azotea (y en los márgenes si `SIDE_MARGIN > 0`), sol o luna según tema, nubes que se desplazan en `tick(seconds)`, y la azotea del edificio (pretil, depósito, antena). Tema claro/oscuro: paleta elegida por `matchMedia('(prefers-color-scheme: dark)')`, que `OfficeView.mount` ya escucha (`ui/src/office/office.ts:105-109`); se redibuja en ese `change`.

Criterio "sin tapar agentes ni etiquetas": todo lo nuevo que no se mueve va en `backgrounds` (detrás de `actors`); jardineros, coches y cabina van en `actors` con `zIndex` por `y`, igual que los personajes (`ui/src/office/character-view.ts:394`), y los iconos/etiquetas de los agentes están dentro de su propio `root`, por encima de su cuerpo.

### D4. Vista 2D: jardín, coches y viaje a casa

`ui/src/office/garden.ts` (`GardenScene`):

- Geometría (coordenadas del edificio, `x` de `-SIDE_MARGIN` a `width + SIDE_MARGIN`, `y` de `gardenTop` a `gardenTop + GARDEN_H`): el **portal** bajo la columna del ascensor de la planta baja (puerta pintada de `lift.w` de ancho entre `gardenTop - FLOOR_GAP` y `gardenTop + 10`), césped en dos tonos, un **camino** horizontal a `pathY = gardenTop + GARDEN_PATH_Y (26)` que sale por la derecha, setos y parterres de flores a la izquierda, una **fila de plazas** a la derecha a `bayY = gardenTop + GARDEN_BAY_Y (48)`, `BAY_W = 36`, `bays = clamp(floor((width/2) / BAY_W), 3, 6)`, y una **calzada** debajo a `roadY = gardenTop + GARDEN_ROAD_Y (68)` por la que entran y salen los coches sin atravesar la fila.
- **Coches** (`CarSprite`): `Graphics` de 28×12 (carrocería, ventanas, dos ruedas, faros) con color por `hsl(hashString(seed) % 360, 0.55, 0.45)` de `ui/src/office/palette.ts:12`. El estado lo lleva el `ParkingLot` (D1b) con `leaveTime = 2.2`, `returnAfter = CAR_RETURN_S (6)`, `arriveTime = 2.2`; el sprite solo interpola: `leaving` baja de `bayY` a `roadY` en el primer tercio del `progress` y recorre la calzada hacia la derecha hasta `x > width + SIDE_MARGIN + 40` en los otros dos; `arriving` hace el camino inverso entrando por la derecha; `away` no se pinta. Así nunca faltan coches y ningún coche cruza a los aparcados.
- **Jardineros** (`Gardener`): se construyen con `buildCharacter` de `ui/src/sprites/sprites.ts:311` con `roleKind: 'skillwright'` (la bata color tierra funciona como mono de trabajo) y `saturation: 1`. Dos: uno **siega**, camina ida y vuelta por el césped izquierdo con un cortacésped pintado delante (sprite propio de 10×7) y la pose `poseWalking` reproducida (los sprites no exponen `poseWalking`; se replica el balanceo de piernas/brazos con los `parts` que devuelve `buildCharacter`); otro **poda** un seto, quieto, brazos oscilando y destellos de recorte cada 0,8 s. Son decorativos: `eventMode = 'none'`, sin etiqueta.
- API: `update(width, gardenTop, liftX)` (llama a `lot.resize(bays)`), `spot(bay): Point` (puerta del conductor: `{ x: bayX(bay) - 7, y: bayY }`), `lot: ParkingLot`, `tick(dt)`, `destroy()`.

Viaje a casa en `office.ts`:

- `resolveTarget` con `agent.away` (`ui/src/office/office.ts:321-327`) deja de devolver `streetExit` y devuelve `{ id: 'exit', kind: 'exit', x: spot.x, y: spot.y, z: spot.y + 1 }` con `spot = garden.spot(garden.lot.reserve(agent.key))`. Como la reserva es fija, el objetivo no cambia entre refrescos aunque el coche de esa plaza esté saliendo. `streetExit` se sustituye en `layout.ts` por `gardenDoor(layout, top)` = `{ x: lift.x + lift.w/2, y: top + height + FLOOR_GAP + 8 }` (el portal) y una `gardenRoute(gate, door, pathY, spot)` que devuelve `[gate(ground), door, { x: door.x, y: pathY }, { x: spot.x, y: pathY }, spot]`.
- `buildPath` para `kind: 'exit'`: `liftRoute(gate(origin), gate(ground), ...gardenRoute(...).slice(1))`, es decir, el par de boca de ascensor con `floor` en ambos (dispara el viaje, D2) seguido de la `gardenRoute` sin su primer punto, que es el propio `gate(ground)`; `liftRoute` ya deduplica cuando origen y planta baja coinciden (`ui/src/office/layout.ts:155`). Para admitir varios puntos finales, la firma pasa de `liftRoute(from, to, goal)` a `liftRoute(from, to, ...rest: Point[])` (hoy solo acepta un `goal`, `ui/src/office/layout.ts:152`). La ruta resultante tiene un solo `gate(ground)`.
- Al llegar (`entry.view.leaving && !entry.view.moving`), `OfficeView` llama a `lot.depart(agent.key)` (idempotente por `key`, así que puede llamarse cada frame mientras siga parado en la plaza, sin marca extra); en ese `tick` el coche pasa a `leaving` (1 s quieto con faros encendidos y arranca) y el personaje se desvanece con el `exitAlpha` actual (`ui/src/office/character-view.ts:358-367`). `FrameInput` gana `hold: boolean` = `lot.boarding(agent.key)`: con `hold` el alfa se queda en 1 y `exitAt` se reinicia (el agente espera a que su coche vuelva porque otro acaba de irse en él, D1b).
- `lot.release(key)` cuando la entrada se destruye (`ui/src/office/office.ts:242-247`) o el agente deja de estar `away` (en `syncEntries`, si `!agent.away && lot.bayOf(key) !== null`). `release` también quita la salida de `key` de la cola de `depart` de su plaza, para que ningún coche se marche "con" un agente que ya no está.
- Cambio de `look` (`ui/src/office/office.ts:209-212`): hoy la vista nueva se crea sin colocar y `setTarget` la hace saltar al objetivo (`ui/src/office/character-view.ts:124-128`); pasa al moverse entre una planta observada y una gestionada. Antes de destruir la vieja: `lift.cancel(key)` y `nueva.placeAt(vieja.position)`.
- Llegadas: los personajes nuevos se colocan en `gardenGate = { x: width + SIDE_MARGIN + CHAR_W, y: pathY }` en lugar de `streetExit` (`ui/src/office/office.ts:216`), y `buildPath` detecta `from.y >= gardenTop` para devolver `gardenArrival(from, door, pathY, gate(ground))` = `[{ x: from.x, y: pathY }]` solo si `from.y > pathY` (quien vuelve de `away` desde su plaza sube primero al camino en vertical y no cruza la fila de coches en diagonal), seguido de `[{ x: door.x, y: pathY }, door, gate(ground)]` (función propia en `layout.ts`; quien llega no tiene plaza, así que no se reutiliza `gardenRoute`), seguida de `gate(target)` y la meta: `[...gardenArrival(...), ...liftRoute(gate(ground), gate(target), goal).slice(1)]`.

### D5. Vista 2D: cabina y hueco

- `drawLift` (`ui/src/office/furniture.ts:145-152`) pasa a pintar solo el hueco: columna oscura semitransparente, dos guías verticales y, en `walkY`, el marco de la puerta de rellano con su led. Se quita la "puerta clara" fija de 18 px que hoy simula una cabina en cada planta.
- `ui/src/office/lift-cabin.ts` (`LiftCabin`): dos `Graphics` en `actors`: `back` (interior: suelo, pared, barra) con `zIndex = position - 1` y `doors` (dos hojas que se abren desplazándose `doors * (w/2 - 1)` px) con `zIndex = position + 1`, ambas en `x = lift.x + 1`, `y = position - CABIN_H` con `CABIN_H = 26`. El viajero, con `zIndex = y = position`, queda entre las dos. Las hojas se pintan como **cristal** (marco opaco de 1 px y relleno con `alpha 0.45`): el hueco mide `LIFT_W = 14` y el personaje `CHAR_W = 16` (`ui/src/office/constants.ts:2,9`), así que con puertas opacas el cuerpo, el icono y el anillo de selección (que van dentro de su `root`) quedarían tapados durante el viaje; con cristal se ven atenuados. Se acepta esa atenuación (ver Riesgos).
- Paradas: tras cada `sync`, `controller.setStops(new Map(sceneOrder.map(s => [s.slug, s.top + s.layout.walkY])))`. Como la cabina se mueve a `LIFT_SPEED_2D = 70` px/s y las plantas miden ≥128 px, un viaje de una planta dura ~2 s, visible pero sin estorbar. `serves(a, b)` en 2D: ambas en `scenes` y `a !== b`. La cabina arranca en la parada de la planta baja.
- Corrección del "aparece de golpe" en 2D: el id del objetivo de mesa es `desk:${agent.key}` (`ui/src/office/office.ts:357`), así que al cambiar de planta `setTarget` ve el mismo id y **salta** (`ui/src/office/character-view.ts:134-140`). Pasa a `desk:${scene.slug}:${agent.key}`; con id distinto se toma la ruta nueva, que incluye el par de ascensor.

### D6. Vista 3D: fondo, jardín y coches

- `ui/src/scene/backdrop.ts` (`Backdrop`): cúpula `SphereGeometry(SKY_RADIUS = 240, 24, 12)` con `MeshBasicMaterial({ side: BackSide, fog: false, toneMapped: false, depthWrite: false, map })`, `renderOrder = -1`, `frustumCulled = false`, donde `map` es un `CanvasTexture` 4×256 con el degradado cénit→horizonte (dos paletas, clara y oscura). La cúpula **sigue a la cámara**: en cada frame `dome.position.copy(camera.position)` (solo traslación; el degradado es vertical y no se nota). Así siempre está a 240 m del ojo, por debajo de `camera.far ≥ 320` (`ui/src/scene/camera.ts:126`), aunque la cámara se aleje hasta `maxDistance` (`ui/src/scene/camera.ts:125`); una cúpula fija en el origen se recortaría por detrás del edificio en la vista "Edificio". Manzanas lejanas: 30-40 cajas con `Batcher` (`ui/src/scene/batch.ts:83`) en un anillo alrededor del origen, alturas 6-24 m, materiales mate muy desaturados, que la niebla ya existente convierte en siluetas. El anillo se ata a la niebla: `fitShadows` (`ui/src/scene/scene.ts:611-612`) fija `far = max(160, radius·7)` y la niebla empieza en `0.55·far`; con el jardín en los límites `far ≈ 190-200`, así que un anillo fijo a 60-110 m quedaría casi entero antes de la niebla y no sería silueta. `Backdrop.setFar(far)` se llama desde `fitShadows` y reconstruye el anillo entre `BLOCKS_NEAR = 0.7·far` y `BLOCKS_FAR = 0.95·far`; los coches que se alejan dejan de pintarse en `|x| > CAR_VANISH = 0.85·far` (ya dentro de la niebla densa), y el `Garden` recibe ese umbral por `setFar` también. Árboles de fondo igual (cilindro + 2 esferas). En `applyTheme` (`ui/src/scene/scene.ts:615-622`) la niebla toma el color del horizonte de la paleta en lugar de `--canvas-bg`, para que las siluetas se fundan con el cielo; `scene.background` se mantiene como respaldo.
- `ui/src/scene/garden.ts` (`Garden`): grupo propio añadido a `scene`, posicionado en `streetOrigin` (coordenadas de la pseudoplanta `calle`, `ui/src/scene/buildings.ts:481-484`). Franjas en `z`: césped `GARDEN_Z0 = 9.5` a `GARDEN_Z1 = 17.5` (tras la acera, que llega a `z ≈ 9`, `ui/src/scene/buildings.ts:549`); **pasillo peatonal** delante de las plazas a `PARK_AISLE_Z = 18.2`; **plazas** en batería centradas en `PARK_Z = 20.8` (coches de `CAR_LEN = 4.2` × 1.8, de `z = 18.7` a `22.9`; `BAY_W = 2.6`, `bays = clamp(round(span / 5), 3, 7)`, centradas en el ancho del solar); **carretera** `ROAD_Z = 25` (asfalto de 3 m con marcas); borde `GARDEN_FAR_Z = 27.5`. **Camino** de 1.6 m a `x = exitX` de la planta baja (centro de la torre del ascensor) desde la puerta de calle de la torre hasta el pasillo peatonal. Setos (`box`), parterres (esferas pequeñas de colores), 4-6 árboles (versión grande del `plant` de `ui/src/scene/furniture.ts:428`, reescrito aquí para no tocar `furniture.ts`), farolas. El estado de los coches lo lleva el `ParkingLot` (D1b) con `leaveTime = 3`, `returnAfter = CAR_RETURN_S (8)`, `arriveTime = 3`.
- **Puerta de calle de la torre**: hoy los agentes salen atravesando el cristal `z1` de la torre (`ui/src/scene/buildings.ts:594`). Esa caja se divide: en la planta baja se deja una abertura de `LIFT_W - 0.4` de ancho y `DOOR_H` de alto, con marco; por encima sigue el cristal. La torre pasa a ser el vestíbulo y el camino arranca de su puerta.
- **Coches** (`Car`): `Group` con 6-8 mallas (carrocería, habitáculo, 4 ruedas, faros, luces traseras emisivas) a partir de `UNIT_BOX`/`unitCylinder` de `batch.ts`; color por `hashString`. Interpola el `progress` del `ParkingLot`: `leaving` = 1 s quieto con faros, retrocede de la plaza a la carretera (`z` de `PARK_Z` a `ROAD_Z`) girando 90°, y recorre `+x` hasta `|x| > CAR_VANISH` (umbral atado a la niebla, ver `Backdrop.setFar`); `arriving` hace el camino inverso entrando por `-x`; `away` no se pinta. La trayectoria de salida va por la carretera, nunca por la fila de plazas ni por el pasillo peatonal.
- **Jardineros** (`Gardener`): modelo `assets.modelFor('skillwright')` (farmer.glb, `ui/src/scene/assets.ts:96`), clonado con `SkeletonUtils.clone` y animado con `GltfRig` (`ui/src/scene/rig.ts:123`), con `MannequinRig` de respaldo si el modelo falla, igual que `Character.attach` (`ui/src/scene/characters.ts:329-382`) pero sin picking, etiqueta ni efectos. Uno siega (clip `walk`, ida y vuelta por un carril del césped, cortacésped delante); otro poda (clip `interact`, de cara a un seto). Son ~30 líneas parecidas a `attach`; no se extrae un helper para no tocar `characters.ts` más de lo necesario (ver Riesgos).
- Materiales: `gardenKit()` nuevo en `ui/src/scene/materials.ts` (césped, tierra, asfalto, marca vial, seto, tronco, hoja, flores ×3, pintura ×6, cristal de coche, neumático, faro), registrado en `disposeSharedMaterials` (`ui/src/scene/materials.ts:434-447`) y con variante clara/oscura en `applyTheme` (`ui/src/scene/materials.ts:219-223`) para césped y asfalto.
- Límites de cámara y sombras: `Site.computeBounds` (`ui/src/scene/buildings.ts:517-527`) amplía `max.z` hasta `GARDEN_FAR_Z` para que `clampTarget` (`ui/src/scene/camera.ts:271-283`) permita encuadrar el jardín y `fitShadows` (`ui/src/scene/scene.ts:593-613`) cubra coches y jardineros.

Viaje a casa en `scene.ts`:

- `exitTarget(nav, spot?)` (`ui/src/scene/layout.ts:78-83`) acepta un punto opcional `{ x, z }` en coordenadas de calle; sin él mantiene el comportamiento actual (los tests existentes siguen pasando). El objetivo pasa a ser `{ x: spot.x, z: spot.z, lane: street.exitX, facing: 0 }` con `spot = garden.spot(bay) = { x: bayX(bay) - 0.9, z: PARK_AISLE_Z }` (el pasillo peatonal, delante del morro del coche, lado del conductor): con `lane = exitX`, `planPath` ya produce `(exitX, AISLE_Z) → (exitX, PARK_AISLE_Z) → (spot.x, PARK_AISLE_Z)` (`ui/src/scene/layout.ts:284-286`), es decir, sale por la puerta de la torre, baja por el camino y recorre el pasillo hasta su coche sin cruzar la fila.
- `resolveTarget` con `agent.away` (`ui/src/scene/scene.ts:455`) usa `exitTarget(nav, garden.spot(garden.lot.reserve(agent.key)))`. Al llegar (`character.leaving && !character.moving`), `lot.depart(agent.key)` una vez; `FrameInput` gana `hold = lot.boarding(agent.key)` como en 2D y `fadeAlpha` (`ui/src/scene/characters.ts:673-683`) respeta `hold`. `lot.release(key)` en el `dispose` de la entrada (`ui/src/scene/scene.ts:397-403`) y en `syncEntries` cuando el agente deja de estar `away` con una reserva viva (el hub puede quitar `away`, `hub/src/office.ts:418,640,1428`; sin la liberación, su salida encolada se llevaría un coche vacío).
- Los recién llegados aparecen en el borde de la carretera: `streetPoint(nav)` (`ui/src/scene/layout.ts:85-88`) pasa a devolver `{ floor: STREET, x: exitX, z: ROAD_Z - 1.0, lane: exitX }` (hoy devuelve el punto de salida en la acera, `(exitX + 2.5, 5.5)`, que no cruza el jardín). Con `lane = exitX`, `planPath` desde ahí produce `(exitX, AISLE_Z)` en calle y el par de ascensor: el agente sube por el camino, espera en el rellano de calle, entra en la torre y sube en cabina. Para que ese recorrido en línea recta por `x = exitX` no atraviese la fila de plazas, el **camino cruza el aparcamiento**: `Garden` calcula las candidatas `cx_i = left + BAY_W/2 + BAY_W·i` centradas en el solar, descarta cualquiera cuyo tramo `[cx_i - BAY_W/2, cx_i + BAY_W/2]` se solape con `[exitX - PATH_CLEARANCE, exitX + PATH_CLEARANCE]`, y guarda las útiles en `bayX: number[]`; `lot.resize(bayX.length)` dimensiona el `ParkingLot` solo con las útiles y el índice de plaza del `ParkingLot` se traduce a `x` con `bayX[bay]`, así que el hueco del camino no tiene índice. La franja de `PARK_Z` se pinta como camino en ese hueco. Con el anexo de la demo, las 7 candidatas van de `0.325` a `18.525` y `exitX ≈ 11.15`: el intervalo `[10.15, 12.15]` toca la 3 (`8.125..10.725`) y la 4 (`10.725..13.325`), así que se descartan dos y quedan 5. Se actualiza la aserción de `streetPoint` en `ui/src/scene/layout.test.ts:72` y el caso de llegada (`:104-113`).

### D7. Vista 3D: cabina en la torre

- `ui/src/scene/lift-cabin.ts` (`LiftCabin`): `Group` en `site.root` con suelo (`LIFT_W - 0.2` × 0.08 × `LIFT_W - 0.2`), techo con lámpara emisiva, barra y **tres pares de puertas**: cara `x0` (`room`, la del edificio, por donde se entra y sale en las plantas), cara `z1` (`street`, la de calle, planta baja) y cara `x1` (`bridge`, la de la pasarela al anexo, planta baja; la torre tiene esa cara abierta en la planta baja cuando hay anexo, `ui/src/scene/buildings.ts:590-592`, y la pasarela arranca ahí, `:605-621`). Cada par se desliza según `controller.doors`, pero solo si su cara está en `controller.servedFaces()` (D1). Si está vacío (apertura sin viajeros, no debería ocurrir) se abre `room`.
- **Rellano de pasarela.** El tramo anexo → planta baja principal es el lerp horizontal de `planPath` `(mantenimiento, aX) → (redaccion, mX)` (`ui/src/scene/layout.ts:274-281`), que hoy termina en el centro de la torre. Cuando el punto de destino de ese lerp es la boca de una planta servida y el punto siguiente es otra planta servida (`liftLeg` con `at` en el destino del lerp devuelve un tramo), `Character` acorta el lerp hasta `lift.landing(redaccion, 'bridge')` = `{ x: exitX + LIFT_W/2 + 0.6, z: AISLE_Z }` y marca `viaBridge = true`; al terminar, la regla A pide el ascensor con `fromFace = bridge`, con `boarded` entra por la cara `x1` y sube. Si el punto siguiente no es un viaje servido (va a la propia planta baja), el lerp termina donde hoy y el personaje sigue andando. Posición `x = cx` de la torre, `z = AISLE_Z`, `y = controller.position`.
- Paradas: `controller.setStops` con `slug → room.origin.y` de las plantas del edificio principal (`PLINTH_H + level * STOREY_H`, `ui/src/scene/buildings.ts:466`) **más `STREET → origin.y de mainGround`**: la calle es una parada que comparte coordenada con la planta baja. `LIFT_SPEED = 2.4` ya existe (`ui/src/scene/constants.ts:57`). Posición inicial: la de `mainGround`.
- Por qué la calle es parada: `planPath` resuelve planta alta → calle como un solo par `(exit en la planta) → (exit en STREET)` sin pasar por la planta baja, porque `streetNav` declara `building: 'main'` (`ui/src/scene/layout.ts:74-76`, `:270-273`; lo confirman `floorsOf(path) = ['mobile', STREET]` en `ui/src/scene/layout.test.ts:87` y `[STREET, 'mobile']` en `:109`). Si STREET no fuera parada, las salidas a casa y las llegadas desde y hacia plantas altas seguirían con el lerp de hoy. Con STREET registrada en la coordenada de la planta baja, ese par viaja en cabina y la cabina se detiene abajo.
- `servesLift(a, b, nav, stops)` es una función pura en `ui/src/scene/layout.ts`: ambas en `nav.floors`, ambas `building === 'main'`, `a !== b` y `stops.get(a) !== stops.get(b)`. Así planta alta ↔ calle y planta alta ↔ planta se sirven, y planta baja ↔ calle (misma coordenada) sigue con el lerp corto actual de 0,29 m, que es el escalón del portal. En todos los lerps no servidos (escaleras del anexo y escalón planta baja ↔ calle) el clip pasa de `idle` a `walk` y el disco `pad` (`ui/src/scene/characters.ts:304`) deja de mostrarse: `props.pad.visible = false` siempre, porque ya no queda ningún tramo que sea "plataforma". Tests en `ui/src/scene/layout.test.ts`: `servesLift('mobile', STREET)` verdadero, `servesLift('redaccion', STREET)` falso, `servesLift('taller', 'mantenimiento')` falso, `servesLift('mantenimiento', 'redaccion')` falso (edificios distintos), `servesLift('redaccion', 'direccion')` verdadero. Y de `liftLeg` con la ruta `planPath` de `taller` a una mesa de `direccion`: con `at` en `mantenimiento` devuelve `null`; con `at` en el rellano de pasarela de `redaccion` y `viaBridge = true` devuelve `{ from: 'redaccion', to: 'direccion', fromFace: 'bridge', toFace: 'room', approach: false }`; en la ruta inversa (`direccion` → `taller`), con `at` en una mesa de `direccion` devuelve `{ from: 'direccion', to: 'redaccion', fromFace: 'room', toFace: 'bridge', approach: true }`; y en la salida `mobile` → calle, `toFace: 'street'`.
- El `Character` en viaje: `worldPosition` (`ui/src/scene/characters.ts:540-553`) devuelve, cuando `ride.phase === 'riding'`, `(origin.x + exitX, controller.position, origin.z + AISLE_Z)` con `origin` el de la planta `from` (la `x`/`z` del centro de la torre es la misma en todas las plantas principales, `ui/src/scene/buildings.ts:466-470`); `advance` (`ui/src/scene/characters.ts:484-538`) añade antes del bucle la gestión de `ride` descrita en D2, y el bloque de transfer existente queda para los casos no servidos.

### D8. Qué no cambia

- El hub, `AgentView`, `Store` y `withDefaults` (`ui/src/store.ts:348-356`): `away` sigue siendo la señal de "se va a casa".
- Las reglas de quién se va y cuándo (`hub/src/office.ts:1434-1441`) y de cuándo desaparece del todo (`FORGET_ENDED_MS`, `hub/src/office.ts:189`; `ENDED_VISIBLE_MS`, `ui/src/store.ts:51`).
- El panel, la tabla, los textos y los estilos CSS.

## Pasos

Fase 0 — controlador compartido

1. Crear `ui/src/lift.ts` con `LiftController`, `LiftRider`, `LiftEvent`, `LiftPhase` y `LiftService` según D1 y D2. Verificable: `cd ui && bun run typecheck` limpio.
2. Crear `ui/src/lift.test.ts` con: (a) un viajero de A a B: secuencia `moving → opening → boarded → (aboard) → closing → moving → opening → arrived`, con `position` monótona y acotada por las paradas; (b) dos viajeros en plantas distintas se sirven FIFO; (c) un viajero cuyo `from` está en la coordenada de `at` con puertas abiertas recibe `boarded` en el mismo tick; (d) `cancel` mientras espera no mueve la cabina; (e) `setStops` con la cabina parada ajusta `position` a la nueva coordenada; (f) `setStops` sin la parada de un viajero emite `cancelled`; (g) con `maxDwell` vencido el viajero que no confirmó recibe `cancelled`, la cabina cierra y **a continuación atiende al siguiente viajero de la cola** (llega a su `from`, emite su `boarded`); (h) dos slugs con la misma coordenada: un viajero de C a la segunda recibe `arrived` cuando `position` es la de la primera; (i) `cancel` de un viajero que va dentro hace que la cabina siga al destino del siguiente; (j) `servedFaces()`: con un viajero que sale con `toFace: 'street'` y otro que espera en la misma coordenada con `fromFace: 'bridge'`, al abrir devuelve `['street', 'bridge']` y tras cerrar está vacío. Verificable: `cd ui && bun test src/lift.test.ts` en verde.
2b. Crear `ui/src/parking.ts` (`ParkingLot`) y `ui/src/parking.test.ts` con los casos (a)-(g) de D1b, en especial (f) `boarding` tras `depart` y (g) el desbordamiento con N+2 agentes y N plazas. Verificable: `cd ui && bun test src/parking.test.ts`.

Fase 1 — vista 2D

3. `ui/src/office/constants.ts`: añadir `SKY_H = 32`, `SIDE_MARGIN = 0`, `GARDEN_H = 80`, `GARDEN_PATH_Y = 26`, `GARDEN_BAY_Y = 48`, `GARDEN_ROAD_Y = 68`, `BAY_W = 36`, `CAR_LEAVE_S = 2.2`, `CAR_RETURN_S = 6`, `CAR_QUICK_RETURN_S = 1.5`, `LIFT_SPEED_2D = 70`, `LIFT_DOOR_S = 0.4`, `LIFT_DWELL_S = 0.6`, `LIFT_MAX_DWELL_S = 4`, `CABIN_H = 26`, `LANDING_DX = 6`. Verificable: typecheck.
4. `ui/src/office/layout.ts`: `Point` gana `floor?: string`; sustituir `streetExit` por `gardenDoor(layout, top)`; añadir `gardenRoute(gate, door, pathY, spot): Point[]`, `gardenArrival(door, pathY, gate): Point[]` y `liftCenter(layout): number` (D4, D5); `liftGate(layout, top, slug)` devuelve el punto con su `floor`; `liftRoute(from, to, ...rest: Point[])`. Reescribir `ui/src/office/layout.test.ts` entero, porque `typecheck` no lo cubre (`ui/tsconfig.json:15` excluye `*.test.ts`) y los tres tests de "leaving the 2D office" usan `streetExit` o `liftGate` con la firma vieja: "off the canvas on the right" (`:45-53`) pasa a comprobar que la ruta de salida es `[gate(upper), gate(ground), door, path, path, spot]` con `door.y > groundTop + ground.height`, que los dos `gate` llevan `floor` y los demás no; "the lift door is passed once" (`:55-60`) usa `gardenDoor` en lugar de `streetExit` y comprueba que `liftRoute(gate(ground), gate(ground), door, spot)` devuelve `[gate(ground), door, spot]`; "an agent arriving" (`:62-71`) pasa a `[...gardenArrival(door, pathY, gate(ground)), gate(upper), goal]` y comprueba que empieza en el camino, pasa por la puerta y tiene un solo `gate(ground)`; el de mesas no cambia. Verificable: `cd ui && bun test src/office/layout.test.ts`.
5. `ui/src/office/furniture.ts`: `drawLift` pinta solo el hueco y el marco de rellano (D5). Verificable: typecheck; visual en el paso 10.
6. Crear `ui/src/office/backdrop.ts` (`Backdrop` con `draw(width, worldHeight, dark)` y `tick(seconds)`) y `ui/src/office/lift-cabin.ts` (`LiftCabin` con `update(controller, lift)`), según D3 y D5. Verificable: typecheck.
7. Crear `ui/src/office/garden.ts` (`GardenScene`, `CarSprite`, `Gardener`) sobre `ParkingLot` según D4. Verificable: typecheck.
8. `ui/src/office/character-view.ts`: `FrameInput.hold`; `setTarget(target, path, lift: LiftService<Point> | null)`; estado `ride` y gestión de aproximación/embarque/viaje/salida en `advance` (D2), con `moving` verdadero y pose idle durante el viaje; durante el viaje `setTarget` guarda `pendingTarget` y descarta la ruta, y `arrived` deja `needsPath = true` (getter) con `setPath(path)` para que `OfficeView` la rellene (D2); nuevo `snapToTarget()` (`lift.cancel`, `ride = null`, `placeAt(target)`) que se usa al recibir `cancelled`; `destroy` llama a `lift.cancel(key)`; `applyTransform` respeta `hold`. Verificable: typecheck.
9. `ui/src/office/office.ts`: `applyScroll` coloca `world` en `(SIDE_MARGIN * SCALE, -scrollY * SCALE)`; plantas desde `SKY_H`; `Backdrop`, `GardenScene` y `LiftCabin` montados; `controller.setStops` tras cada `sync`; `controller.tick(dt)` y `lot.tick(dt)` y reparto de eventos en `update`, seguido del recálculo de ruta para las entradas con `view.needsPath` (D2); `resolveTarget` away → `lot.reserve` + `garden.spot`; `buildPath` con `gate(..., slug)`, `gardenRoute` deduplicada en la salida y `gardenArrival` en la llegada; id de mesa `desk:${scene.slug}:${agent.key}`; `lot.depart(key)` al llegar; `hold = lot.boarding(key)`; al recrear la vista por `look`: `lift.cancel` y `placeAt` de la posición vieja; `lot.release` + `lift.cancel` al destruir la entrada y `lot.release` cuando el agente deja de estar `away`; nuevos llegan en `gardenGate`; `worldHeight` con cielo y jardín; redibujo del fondo en el `change` de tema. Verificable: typecheck y paso 10.
10. Comprobación visual 2D con el replay (ver Verificación): cielo arriba, jardín abajo con ≥2 jardineros animados y ≥3 coches; un agente que entra viaja en cabina hasta su planta; a partir de 1:08 (a 4x, ~17 s) los agentes `done` bajan en cabina, cruzan el jardín, se desvanecen junto a un coche y el coche se va; aparece un coche de reemplazo.

Fase 2 — vista 3D

11. `ui/src/scene/constants.ts`: `SKY_RADIUS = 240`, `GARDEN_Z0 = 9.5`, `GARDEN_Z1 = 17.5`, `PARK_AISLE_Z = 18.2`, `PARK_Z = 20.8`, `CAR_LEN = 4.2`, `ROAD_Z = 25`, `GARDEN_FAR_Z = 27.5`, `BAY_W = 2.6`, `CAR_LEAVE_S = 3`, `CAR_RETURN_S = 8`, `CAR_QUICK_RETURN_S = 1.5`, `PATH_CLEARANCE = 1.0`, `BLOCKS_NEAR_K = 0.7`, `BLOCKS_FAR_K = 0.95`, `CAR_VANISH_K = 0.85` (fracciones de `far`), `LANDING_DX = LIFT_GAP + LIFT_W / 2 + 0.45`, `STREET_LANDING_DZ = LIFT_W / 2 + 0.6`, `BRIDGE_LANDING_DX = LIFT_W / 2 + 0.6`, `STEP_DOWN = PLINTH_H - SIDEWALK_Y`, `LIFT_DOOR_S = 0.5`, `LIFT_DWELL_S = 0.8`, `LIFT_MAX_DWELL_S = 4`, `TOWER_DOOR_W = LIFT_W - 0.4`. Verificable: typecheck.
12. `ui/src/scene/materials.ts`: `gardenKit()` y su alta en `applyTheme` y `disposeSharedMaterials` (D6). Verificable: typecheck.
13. `ui/src/scene/layout.ts`: `exitTarget(nav, spot?: { x: number; z: number })`, `streetPoint(nav)` en el borde de la carretera, `servesLift(a, b, nav, stops)` y `liftLeg(at, path, nav, stops, viaBridge)` (D2, D6, D7). En `ui/src/scene/layout.test.ts`: actualizar `:72` (`streetPoint` ya no coincide con `exitTarget`: es `{ x: exitX, z: ROAD_Z - 1 }`) y el caso de llegada (`:104-113`, la ruta sigue siendo `[STREET, 'mobile']` y pasa por `(exitX, AISLE_Z)` en calle); añadir un caso con `spot` que compruebe `lane === ground.exitX`, `x === spot.x`, `z === spot.z` y que `planPath` desde una mesa alta termina en ese punto pasando por `(exitX, AISLE_Z)` en calle; añadir los cinco casos de `servesLift` y los cuatro de `liftLeg` de D7 con `stops` que registre `STREET` en la coordenada de `redaccion` (el `nav()` del fichero ya tiene `taller`/`mantenimiento` en el anexo y `direccion` en el principal, `ui/src/scene/layout.test.ts:47-58`). Verificable: `cd ui && bun test src/scene/layout.test.ts`.
14. Crear `ui/src/scene/backdrop.ts` (con `setFar`), `ui/src/scene/garden.ts` (plazas útiles `bayX[]` saltando el camino, `setFar`) y `ui/src/scene/lift-cabin.ts` (tres caras por `servedFaces`) según D6 y D7. Verificable: typecheck.
15. `ui/src/scene/buildings.ts`: abertura de calle en la torre (D6); `computeBounds` hasta `GARDEN_FAR_Z`; `Site` expone `liftX` (centro de la torre), `streetOrigin` y `span` (`left..right` del solar) para `Garden.update`, y un getter `liftStops: ReadonlyMap<string, number>` con `slug → origin.y` de las plantas del edificio principal más `STREET → origin.y de mainGround`, recalculado en `update`. `Site.update` sigue devolviendo `boolean` (`changed`), que `scene.ts:311` usa para `setBounds`, `fitShadows` y `reframe`. Verificable: typecheck.
16. `ui/src/scene/characters.ts`: `FrameInput.hold`; `setTarget(target, nav, lift)`; `ride` en `advance` y `worldPosition` (D2, D7) usando `liftLeg` con las reglas A y B, acortando el lerp de pasarela hasta el rellano `bridge` y marcando `viaBridge`, con `moving` verdadero y clip `idle` durante el viaje; `stepDown` al salir a la calle (D2); `snapToTarget` y `dispose` llaman a `lift.cancel(key)`; `fadeAlpha` con `hold`; clip `walk` en todos los lerps no servidos (escaleras del anexo y escalón planta baja ↔ calle) y `pad` siempre oculto. Verificable: typecheck.
17. `ui/src/scene/scene.ts`: montar `Backdrop` (con `follow(camera.position)` en cada `step`), `Garden`, `LiftCabin` y el `LiftController`; `controller.setStops(site.liftStops)` tras `site.update`; `controller.tick`, `lot.tick` y reparto de eventos en `animate`; `resolveTarget` away con `lot.reserve` + `garden.spot`; `lot.depart(key)` y `hold = lot.boarding(key)`; `lot.release` al eliminar la entrada y cuando el agente deja de estar `away` con reserva viva; `fitShadows` → `backdrop.setFar(far)` y `garden.setFar(far)`; `applyTheme` → `backdrop.retheme`, `garden.retheme` y color de niebla del horizonte; `dispose` libera todo lo nuevo. Verificable: typecheck y paso 18.
18. Comprobación visual 3D con el replay y `view=3d`: cúpula de cielo y siluetas tras el edificio en ambos temas, también con la vista "Edificio" alejada al máximo (rueda) sin recorte de cielo; botón "Edificio" encuadra edificio y jardín; jardineros animados y coches; agentes que llegan suben por el camino, esperan fuera de la torre, entran y suben en la cabina; agentes `done` de plantas altas bajan en la cabina, salen por la puerta de calle de la torre, bajan por el camino y el pasillo peatonal, se desvanecen junto a su coche y el coche sale marcha atrás a la carretera sin tocar los demás; coche de reemplazo.

Cierre

19. `cd ~/Projects/agent-office-dev && bun run test && bun run typecheck && bun run build`, los tres en verde, validados por el tester de la planta.

## Riesgos

- **Ancho útil en 2D.** Con `SIDE_MARGIN = 0` no se pierde ancho. Si se sube a 12, se pierde una mesa por fila en ≈ 57 % de los anchos (D3).
- **Viajero atenuado en la cabina 2D.** Las puertas de cristal (alfa 0.45) atenúan cuerpo, icono y anillo de selección mientras viaja, unos 2 s por planta. Se acepta: es lo que se espera de un ascensor acristalado y el viajero sigue siendo visible y seleccionable (el `hitArea` no cambia).
- **Replanificación a media subida en 2D sin test unitario.** `CharacterView` depende de pixi.js, así que el caso "cambio de objetivo durante el viaje" se comprueba en la verificación manual (punto 4 del replay, las reuniones del director con los jefes encadenan cambios de planta) y no en `bun test`.
- **Agentes que comparten plaza.** Si se van más agentes que plazas, los que esperan el mismo coche se superponen en el mismo punto hasta que el coche vuelve (`quickReturn`, unos 5-7 s por turno). Es visible en el final de la demo. Si molesta, se puede desplazar al segundo de la cola unos píxeles/decímetros; se deja fuera para no mover el objetivo con el mismo `id`.
- **Planta baja ↔ calle en 3D sin cabina.** Como comparten coordenada, ese tramo sigue siendo el lerp corto actual (0,29 m, el escalón del portal). Si se ve raro, se puede sustituir por una pequeña rampa pintada en la puerta de calle de la torre; no afecta a los criterios de aceptación.
- **Jardín fuera de pantalla en 2D.** Con pocas plantas y pantalla baja el jardín queda bajo el borde y hay que hacer scroll para ver el coche marcharse. El cielo sí se ve siempre. Ver Preguntas abiertas.
- **Esperas en el rellano.** Con FIFO y una cabina, varios agentes que cambian de planta a la vez pueden esperar varios segundos. `LIFT_MAX_DWELL_S` evita cabinas abiertas indefinidamente; si se alarga demasiado se puede subir `LIFT_SPEED_2D`/`LIFT_SPEED`.
- **Plantas que cambian de alto o desaparecen durante un viaje.** `setStops` en cada `sync` cubre los cambios de `top`; una parada que desaparece emite `cancelled` y el personaje se recoloca con el `snapToTarget` actual.
- **Sombras más gruesas en 3D.** Ampliar `bounds` al jardín agranda la cámara de sombras (`fitShadows`), así que las sombras de las mesas quedan algo menos nítidas. Si molesta, se mantiene `bounds` sin jardín para sombras y solo se amplía el límite de cámara.
- **Duplicación en `Gardener` 3D.** Repite ~30 líneas de `Character.attach`. Se acepta para no tocar `characters.ts` más allá del protocolo del ascensor; si se quiere, un helper `instantiate(model)` en `assets.ts` queda para otro plan.
- **Test de literales acentuados.** Cualquier cadena con tilde en los ficheros nuevos rompe `ui/test/i18n.test.ts`. Los nombres de clips, materiales y claves van en inglés o sin tildes.
- **Choque con el plan del chat interno.** Si ese plan acaba tocando `ui/src/scene/scene.ts` o `ui/src/office/office.ts` (por ejemplo para pintar burbujas de chat), habrá conflicto. La lista de ficheros de Alcance es la frontera; lo que está en "no toca" se respeta.

## Verificación

Todo en el clon `~/Projects/agent-office-dev`, en la rama del encargo. Nunca `bun run setup`, `bun run floor`, `bun run hub`, `bun run office` ni `bun run dev:hub`.

Automática (criterio de aceptación, la ejecuta el tester de la planta):

```sh
cd ~/Projects/agent-office-dev
bun run test        # hub + ui; incluye ui/src/lift.test.ts, ui/src/parking.test.ts y los layout.test.ts actualizados
bun run typecheck   # hub + ui
bun run build       # vite build → hub/public del clon
```

Unitaria rápida durante el desarrollo:

```sh
cd ~/Projects/agent-office-dev/ui
bun test src/lift.test.ts src/parking.test.ts src/office/layout.test.ts src/scene/layout.test.ts test/i18n.test.ts
```

Manual, sin hub: el servidor de desarrollo de la UI en modo replay no abre conexión ni usa la configuración real. `AGENT_OFFICE_HOME` apunta a una carpeta vacía para que `vite.config.ts:14-19` no lea la key real.

```sh
cd ~/Projects/agent-office-dev/ui
AGENT_OFFICE_HOME=$(mktemp -d) bun run dev
# 2D: http://127.0.0.1:5173/?replay=replays/demo.json
# 3D: http://127.0.0.1:5173/?replay=replays/demo.json&view=3d
```

Qué mirar en el replay (`ui/public/replays/demo.json`, 1:16 de duración; a 4x dura 19 s):

1. Al cargar: fondo visible (cielo y siluetas tras la azotea en 2D; cúpula y siluetas en 3D, con las manzanas lejanas veladas por la niebla y no nítidas). Cambiar el tema del sistema y comprobar que el fondo cambia de paleta.
2. Jardín: ≥2 jardineros moviéndose, ≥3 coches aparcados. Las etiquetas y los iconos de los agentes se siguen viendo encima de todo.
3. Entre 0:04 y 0:20 llegan agentes a `mobile`, `backend` y `mantenimiento`: en 2D entran por el portal y suben en cabina; en 3D aparecen junto a la carretera, suben por el camino por el hueco de la fila de plazas (5 plazas con el anexo de la demo), esperan fuera de la torre, entran y suben en cabina (los de `mantenimiento` cruzan la pasarela al anexo y suben por la escalera, como hoy); ningún agente aparece de golpe en su planta.
4. Las reuniones (director con los jefes) llevan a un agente a otra planta y de vuelta: cada tramo usa la cabina (en 3D la cabina se ve moverse dentro de la torre; en 2D sube/baja por el hueco con las puertas abriéndose en cada parada). En 3D, fijarse en el director y el jefe de mantenimiento (el director se desplaza, `hostFloor` en `ui/src/scene/scene.ts:420-425`): va de `direccion` a la planta baja en cabina, sale por la cara de la pasarela, cruza al anexo y sube por la escalera; a la vuelta cruza la pasarela, espera en el rellano fuera de la cara `x1`, entra por esa cara cuando se abre y sube en cabina hasta `direccion`; nunca sube flotando por el hueco. Cambio de objetivo a media subida: en 2D, pausar el replay cuando un agente esté dentro de la cabina, hacer clic en otro agente para forzar `assignTargets`, o esperar a que la reunión termine mientras viaja; al salir de la cabina debe caminar por la planta de destino hasta su mesa o asiento, nunca en diagonal entre plantas ni por el hueco.
5. De 1:08 a 1:16 los agentes pasan a `done` + `away` (9 agentes, más que plazas): bajan en cabina, cruzan el jardín, se desvanecen junto a un coche en cuanto llegan si está aparcado, el coche se marcha y a los pocos segundos llega otro a la plaza; los que comparten plaza esperan visibles a que vuelva el coche y se van con él. Ningún coche se marcha vacío. Cuando el último agente se ha ido no queda ningún personaje de agente en la escena.
6. Rendimiento: en la pestaña Performance del navegador, el frame se mantiene por debajo de 16 ms en 3D con la demo completa en un portátil reciente.

## Preguntas abiertas

- ¿Debe la vista 2D hacer scroll automático hasta el jardín cuando un agente seleccionado se va a casa? Hoy `focusSelected` solo centra al seleccionado cuando cambia la selección (`ui/src/office/office.ts:455-465`); seguir al que se va sería una extensión pequeña.
- ¿Queremos que los agentes nuevos lleguen también en coche (un coche entra, aparca, el agente baja y entra al edificio)? Queda fuera por simetría de coste; el diseño de `CarSprite`/`Car` ya tiene el estado `arriving`, así que sería un paso más si se pide.
- `SIDE_MARGIN` en 2D va a 0: el fondo se ve arriba y abajo. ¿Se quiere ver cielo también a los lados a costa de una mesa por fila en ≈ 57 % de los anchos (subir la constante a 12)?
