# Ayuda y dos idiomas en el panel

## Contexto

Todos los textos del panel están escritos en español directamente en el código: etiquetas de rol, estado y planta en `ui/src/labels.ts:14-100`, opciones de Ajustes en `ui/src/settings/options.ts:19-94`, y el resto repartido por `topbar.ts`, `table/table.ts`, `settings/settings.ts`, `panel/*.ts`, `time.ts`, `store.ts`, `api.ts`, `actions.ts`, `replay.ts`, `main.ts` y las dos escenas (`office/floor-scene.ts:28-34`, `scene/buildings.ts:54-68`, `scene/camera.ts:85-167`). No hay ningún mecanismo de idioma ni preferencia guardada. La Tabla no explica sus columnas, estados ni acciones (`ui/src/table/table.ts:19`, `134`); Ajustes tiene una línea por sección y una por campo numérico (`settings.ts:331-363`, `options.ts:62-94`), pero nada para cada rol, cada destino de permisos, cada planta ni los datos del hub.

Base sobre la que se escribe:

- agent-office-dev `build/v1` @ `7480a64` (2026-10-16)

Desde `61f915e`, Ajustes ganó la sección Permisos (`settings.ts:314-326`, `337-341`; `options.ts:42-55`) y el panel las tarjetas de permiso con Permitir/Denegar (`panel/question-form.ts:51-63`). Todo ello entra aquí. La UI no tiene tests (`ui/package.json:6-10`); los del hub corren con `bun test` (`package.json:15`).

## Objetivo

Que el panel se explique solo (cada elemento de Tabla y cada opción de Ajustes dice qué es y para qué sirve, con texto visible y no solo tooltips) y funcione en español e inglés, con un selector en la cabecera que traduce toda la interfaz al instante y recuerda la elección.

## Alcance

Entra:

- Diccionario `es`/`en` en `ui/src/i18n/`, función `t()`, tema `lang` en el `Store`, selector en la cabecera y persistencia en `localStorage`.
- Traducción de todos los textos que genera la UI: pestañas, tabla, panel lateral, Ajustes, replay, avisos, toasts, tiempos relativos, fechas, rótulos de las escenas 2D y 3D, los errores de arranque de las escenas y el idioma del documento (`<html lang>`).
- Ayuda en Tabla (leyenda desplegable con columnas, estados, chips, estados de documento y acciones, más `title` de refuerzo) y en Ajustes (línea visible bajo cada rol, bajo la cuadrícula de roles para alias y esfuerzos, bajo cada destino de permisos, cada planta y cada dato del hub; secciones y campos numéricos ya la tienen).
- Tests de la UI con `bun test`: diccionarios completos, con los mismos marcadores y sin copias, interpolación, y un rastreo que falla si queda español con tilde en el código fuera del diccionario. Se añaden al script `test` de la raíz.

Queda fuera:

- Textos que llegan del hub como datos y se muestran tal cual: resúmenes de actividad (`hub/src/office.ts:527-927`), notas de guardado de Ajustes (`hub/src/settings.ts`), errores de la API, preguntas y opciones de los agentes, títulos de documentos, `detail` de los agentes. Traducirlos exige que el hub conozca el idioma (Preguntas abiertas). La única excepción es la etiqueta de las tres plantas fijas (`Dirección`, `Redacción`, `Mantenimiento`, `hub/src/floors.ts:142-147`), que la UI resuelve por `kind` (D5).
- Mensajes entre agentes, documentos de office-docs y plantillas.
- Los textos de `ajustes-gestion-proyectos-2` y `avisos-escritorio`: se ejecutan después de este plan y escriben sus claves directamente en el diccionario (D10).

## Diseño

### D1. Diccionario tipado en `ui/src/i18n/`, sin efectos al importar

- `es.ts`: `export const es = { ... } as const;` es la fuente de verdad. `export type Messages = { [K in keyof typeof es]: string }` y `export type MessageKey = keyof Messages`.
- `en.ts`: `export const en: Messages = { ... }`. Si falta una clave, `bun run typecheck` falla; no hace falta fallback.
- `index.ts`:

```ts
export type Lang = 'es' | 'en';
export const LANGS: readonly Lang[] = ['es', 'en'];
export const LANG_NAMES: Record<Lang, string> = { es: 'Español', en: 'English' };  // aquí y no en topbar.ts: el rastreo del test excluye i18n/
export const LANG_KEY = 'agent-office.lang';
export function interpolate(text: string, params?: Record<string, string | number>): string;   // {n}, {name}…
export function createTranslator(dict: Messages): { t; plural };                                 // puro, sin DOM: es lo que prueba el test
export function readStoredLang(): Lang;   // typeof localStorage !== 'undefined' y try/catch; solo acepta un valor de LANGS, si no 'es'
export function currentLang(): Lang;
export function applyLang(lang: Lang): void;   // cambia el diccionario activo y, si typeof document !== 'undefined', document.documentElement.lang
export function storeLang(lang: Lang): void;   // localStorage, en try/catch
export function t(key: MessageKey, params?): string;        // sobre el diccionario activo
export function plural(key: string, n: number, params?): string;  // `${key}.one` si n === 1, si no `${key}.other`
```

El módulo no toca `localStorage` ni `document` al importarse: `main.ts` llama a `applyLang(readStoredLang())` como primera línea de `boot()` (`main.ts:23`), antes de montar nada. El idioma inicial sin preferencia guardada es `es`: el hub y los agentes hablan español y un navegador en inglés mezclaría idiomas desde la primera visita; `navigator.language` no se consulta. Hasta que el usuario elige, no se escribe nada en `localStorage` (solo `storeLang` lo hace, desde `Store.setLang`).

Claves planas con prefijo por pantalla: `topbar.*`, `table.*`, `table.help.*`, `table.col.*`, `state.*`, `state.hint.*`, `role.*`, `role.hint.*`, `stack.*`, `floorKind.*`, `floor.*`, `verdict.*`, `docStatus.*`, `docStatus.hint.*`, `alert.*`, `panel.*`, `question.*`, `memory.*`, `report.*`, `timeline.*`, `orders.*`, `deliverables.*`, `settings.*`, `replay.*`, `time.*`, `api.*`, `toast.*`, `scene.*`, `main.*`. El inventario de lo que hay que mover está en D4.

Plurales: `fichero/s` (`table.ts:164`, `deliverables.ts:42`), `commit/s` (`deliverables.ts:31`) y `agente/s regenerado/s` (`settings.ts:118`) con `plural()`; `y N más` no varía. Español e inglés comparten la regla uno/otros.

Claves que legítimamente tienen el mismo texto en ambos idiomas (nombres propios `Agent Office`, `Replay`, `Opus`, `Sonnet`, `Haiku`, `Fable`, `Flutter`, `Laravel`, `Node`; roles, títulos y palabras iguales `Director`, `Tester`, `Tests`, `Skills`, `Hub`, `Roles`; esfuerzos `low`…`max`; símbolos `—`, `✓`, `✗`, `×`, `↺`, `▶`, `❚❚`) se listan **por clave** en `SAME_KEYS` dentro del test (D8); el test dirá si falta alguna. Los planes `ajustes-gestion-proyectos-2` (`:77`) y `avisos-escritorio` (`:98`) llaman `SAME_IN_BOTH` a esta misma lista: es una sola constante, `SAME_KEYS`, y quien los ejecute añade ahí sus claves.

### D2. El idioma es un tema del `Store`

`ui/src/store.ts`: `Topic` gana `'lang'` (`store.ts:20-35`); `Store` gana `get lang(): Lang { return currentLang(); }` y `setLang(lang)` que llama a `applyLang(lang)`, `storeLang(lang)` y `mark('lang')`. Cambiar de idioma es un tema más, como `mode` o `connection`: cada componente decide si se repinta entero o solo reetiqueta (D4).

### D3. Selector en la cabecera

`ui/src/topbar.ts`: un `select.lang-select` al final de la cabecera, después de `tabs` (`topbar.ts:44-52`), con `aria-label` `t('topbar.lang')` y una opción por `LANGS` con `LANG_NAMES[lang]` (cada idioma en su propio idioma; no se traducen). `change` → `store.setLang(value)`. `select` tiene estilo global con `width: 100%` (`styles.css:101-112`) y `.topbar` es flex (`:151-159`), así que se añade junto a `.tabs` (`:263`): `.lang-select { width: auto; flex: none; margin-left: 4px; }`.

### D4. Repintado por fichero: qué textos salen y cómo se actualizan

Dos tipos de componente: los que reconstruyen su DOM en cada `watch` solo necesitan `'lang'` en su lista de temas; los que montan DOM fijo necesitan una `relabel()` que se llama al montar y en `watch(['lang'])`.

| Fichero | Textos que pasan al diccionario | Cómo se actualiza |
|---|---|---|
| `main.ts:16-17`, `78`, `90` | avisos de key y de carga | `setNotice` guarda la clave y `watch(['lang'])` lo vuelve a pintar |
| `topbar.ts:12-25`, `31-32` | estados de conexión, pestañas, botón de preguntas | `relabel()`; el botón de preguntas se rehace con `pending.replaceChildren(t('topbar.pending'), ' ', pendingCount)` para conservar el nodo del contador |
| `labels.ts:14-100`, `125-138` | roles, estados, stacks, tipos de planta, veredictos, niveles de alerta, estados de documento, `nota N/10`, `En revisión · ronda N` | funciones (D5); `localeCompare(…, 'es')` en `labels.ts:122` y `store.ts:240` usa `currentLang()` |
| `badge.ts:6` | etiqueta del estado | `stateLabel`; además `badge.title = stateHint(state)` (D6) |
| `time.ts:3-9` | `ahora`, `hace N s/min/h/d` | `t()` en cada llamada; los relojes ya se recalculan con `tick` |
| `store.ts:49-53`, `164-167` | toasts de preguntas y alertas | `t()` al crear el toast |
| `api.ts:19`, `50-58`, `112` | mensajes fijos de la API | `t()` al construir el resultado |
| `actions.ts:31`, `47` | `Orden enviada`, órdenes en replay | `t()` |
| `replay.ts:20`, `136-154` | error de formato, títulos de botones, `Replay`, `Pausar/Reproducir` | `mountReplayControls` recibe `store` (cambio en `main.ts:85`) y añade `watch(['lang'], render)`; `render` fija también `restart.title`, la etiqueta `Replay` y los `title` de las velocidades, que hoy se ponen solo al montar |
| `table/table.ts:19-25`, `80`, `103-104`, `111-112`, `131`, `138`, `164`, `176`, `187`, `210` | columnas, `? pregunta pendiente`, `ronda N`, `Planes/Skills`, vacíos, `N ficheros`, `tras X`, `Alertas de la guardia`, `Esperando agentes…` | `'lang'` en `store.watch` (`table.ts:257`); la leyenda es fija y se reetiqueta aparte (D6) |
| `panel/header.ts:11`, `16`, `21` | hint, `Agente no disponible`, `terminó/desde` | `'lang'` en `watch` (`header.ts:8`) |
| `panel/memory.ts:11`, `30`, `47-49`, `54`, `69`, `73-78`, `92`, `102-117`, `122`, `190` | formato de fecha, `Sin resumen`, placeholder, `Nueva lección`, título `Memoria`, botones, `tú/agente`, `Enviada por`, estados, `Rol: … · Planta: …`, confirmación | `DATE_FORMAT` pasa a `dateFormat()` con `currentLang()`; `relabel()` para el título, el formulario y `scope`; `renderLists()` en `watch(['lang'])` |
| `panel/orders.ts:23-24`, `28-29`, `49`, `96`, `119` | placeholder, `Enviar orden`, título, `Destino`, `Enviando…`, prefijo de bloqueo, `Orden enviada` | `relabel()` y `'lang'` en `watch` (`orders.ts:140`). `endAssist` compara con el `prefillText` guardado (`orders.ts:75`), así que sigue valiendo tras cambiar de idioma |
| `panel/deliverables.ts:9`, `25-31`, `42`, `56`, `93`, `101`, `111-112`, `189-193`, `222`, `238`, `283-291` | fecha, `sin actualizar`, `a fecha de`, `va N commits por delante`, `Instalada en`, confirmación, toasts, `Descartar/Cerrar` (visor y tarjeta), visor, `Entregables · Planes` | `'lang'` en `watch` (`deliverables.ts:265`) y `store.lang` dentro del `JSON.stringify` de `signature` (`:279`), no vaciarla: `watch` no dice qué tema cambió y vaciarla reconstruiría la tarjeta en cada evento de `agents`, perdiendo los `details` abiertos; el visor expone `relabel()` (botones y, si el cuerpo muestra el aviso sin hub o `Cargando…` de `loadContent`, `:189-193`, lo repone en el idioma nuevo) y `renderHead()` en `watch(['lang'])` |
| `panel/report.ts:29`, `49`, `54-58`, `64`, `79`, `102`, `112`, `127`, `137`, `143`, `148`, `154`, `168`, `196-204` | títulos de bloque, `Informe`, `en vivo/cerrado`, estados | `relabel()` para el título fijo (`report.ts:168`); `rendered = ''` y `render()` en `watch(['lang'])` |
| `panel/timeline.ts:63-64` | `Mensajes`, `Actividad`, vacíos | `signature = ''` y repintar en `watch(['lang'])` |
| `panel/question-form.ts:33-34`, `57`, `61`, `67`, `83`, `127`, `166` | botones, títulos, hint, `Caduca en`, `Otra…` | `QuestionForm.relabel()`; `mountQuestion` lo llama en `watch(['lang'])`. Los valores `PERMISSION_ALLOW = 'Permitir'` y `PERMISSION_DENY = 'Denegar'` (`question-form.ts:9-10`) **no se traducen**: son el protocolo con el hub (`hub/src/office.ts:422`); solo cambia el texto del botón |
| `settings/options.ts:19-94` | filas de rol, etiquetas de modelo (`Heredar (inherit)`, `Otro…`; los alias `Opus`… no cambian), modos de permiso, destinos, departamentos, campos numéricos | las filas llevan `labelKey`/`hintKey: MessageKey` en vez de `label`/`hint`; quien las pinta llama a `t()` (D7) |
| `settings/draft.ts:123-136` | mensajes de validación | `t()` con `{role}`, `{min}`, `{max}`, `{slug}` |
| `settings/settings.ts:116-118`, `133`, `190-191`, `217-221`, `236-246`, `294`, `317`, `331-363`, `406`, `414-421` | todo | `watch(['lang'])` pone `signature = ''`, `outcome = null` y llama a `render()`: `buildControls` se reconstruye y `syncControls` restaura el borrador (`settings.ts:368-381`). `loadError` es texto del hub y se muestra como llegó |
| `office/floor-scene.ts:23-34` | subtítulos de placa, `(anexo)`, `observada` | `office.ts:107` añade `'lang'`; la firma de `FloorScene.update` (`floor-scene.ts:83`) incluye `currentLang()` para que `draw()` repinte el texto Pixi |
| `scene/buildings.ts:54-68`, `82`, `599`; `scene/materials.ts:48`, `130`; `scene/furniture.ts:37`; `scene/scene.ts:489` | subtítulos del rótulo, `Canvas 2D no disponible` (sale en pantalla por `main.ts:77-79`), rótulo del tejado del anexo `'Mantenimiento'` (`:599`, pasa a `t('floor.mantenimiento')`; el `'Agent Office'` de `:555` es nombre propio y queda), estado de carga | `scene.ts:183` añade `'lang'`; la firma de `buildings.ts:245` incluye `currentLang()` para regenerar `signTexture`; la firma de `Site.update` (`buildings.ts:465-470`) también lo incluye, porque solo ella dispara `rebuildSite()` (`:514`) y con él el tejado; los `throw new Error(t('scene.noCanvas'))` solo se evalúan al lanzar |
| `scene/camera.ts:85`, `91`, `97`, `138`, `147`, `167` | `Plantas`, `Siguiendo a`, `Dejar de seguir`, `Edificio`, `Anexo`, ayuda de gestos | la firma de `setFloors` (`camera.ts:131`) incluye el idioma; `CameraRig.relabel()` para el cuadro de seguimiento, llamado desde `scene.ts` en `watch(['lang'])` |
| `scene/labels.ts:98` | estado en la etiqueta HTML del personaje | `AgentLabel` (`scene/labels.ts:52`) guarda `lang` y repone `stateEl` cuando cambia |

### D5. `labels.ts` pasa de constantes a funciones

`ROLE_LABELS[x]` → `roleLabel(x)`, y lo mismo para `stateLabel`, `stackLabel`, `floorKindLabel`, `verdictLabel`, `alertLevelLabel`, `documentStatusLabel`; nuevas `stateHint`, `roleHint`, `documentStatusHint`. `STATE_COLORS` y `DOCUMENT_STATUS_COLORS` no cambian. Las funciones se añaden en el Paso 2 junto a las constantes y las constantes se borran en el Paso 6, cuando ya no queda ningún consumidor (`typecheck` detecta cualquier olvido).

Nueva `floorLabel(floor: FloorView): string`: para `kind` `direccion`, `redaccion` y `mantenimiento` devuelve `t('floor.direccion')` etc.; para el resto, `floor.label` (el slug). Sustituye las lecturas de `.label` de una planta en `table.ts:128`, `154`, `header.ts:28`, `memory.ts:190`, `orders.ts:11`, `floor-scene.ts:24-25`, `83`, `scene.ts:306`, `buildings.ts:245`, `372`. `plateTitle` (`floor-scene.ts:23-26`) pasa a `view.kind === 'mantenimiento' ? t('scene.plate.annex', { name: floorLabel(view) }) : floorLabel(view)`: la comprobación `/anexo/i` nunca acierta (la etiqueta de esa planta es siempre `Mantenimiento`, `hub/src/floors.ts:147`) y sobra.

### D6. Ayuda en la Tabla

- El host de la Tabla tiene dos hijos fijos: `details.table-help` y `div.table-content`. `render()` solo reemplaza `table-content` (hoy reemplaza todo el host cada segundo por `'tick'`, `table.ts:211`, `215`, `257`), así la leyenda conserva foco y selección de texto. El `toggle` ya capturado (`table.ts:245-255`) deja de descartar lo que no es `data-alert`: si el `details` es la leyenda, guarda `open` en `localStorage['agent-office.help.table']` (try/catch). Abierta la primera vez. Se reetiqueta entera en `watch(['lang'])`.
- Contenido de la leyenda (`table.help.*`), en este orden: para qué sirve (una fila por agente vivo o terminado hace menos de un minuto, agrupadas por planta, con `↳` para quien fue lanzado por otro; clic en una fila selecciona y abre el panel); la cabecera de planta (chip de stack, chip de tipo `Gestionada`/`Observada`/departamento y la ruta); las seis columnas con una frase cada una, incluida `Último test` (`✓`/`✗` del último comando de tests y su hora; el comando en el `title`); `? pregunta pendiente` (el agente espera respuesta en el panel); los diez estados con su `stateBadge` y `state.hint.*` (texto a partir de las transiciones de `hub/src/state-machine.ts:126`, `188`, `202`, `208`, `217`, `325` y, para los bloqueos, `README.md:103`); los documentos de Redacción y Mantenimiento (clic abre el visor; `ronda` y `nota`) con los seis estados `docStatus.hint.*` (`Borrador`, `En revisión`, `Aprobado`, `Sin acuerdo`, `Entregado`, `Descartado`; la fuente es `statusOf` en `hub/src/documents.ts:257-265`, que decide cada estado: `descartado` si hay `discarded_at`, `cerrado` si `closed_at`, `aprobado` solo si el veredicto es posterior al último cambio del fichero y si no vuelve a `revision`, `sin-acuerdo`, `revision` con `improve` o con petición de revisión, `borrador` en otro caso; `README.md:75-78` lo cuenta en prosa); las alertas de la guardia con `Alerta` y `Posible` (reutiliza `ALERT_HINTS`, `table.ts:22-25`). Ninguna ayuda se inventa: sale de esas fuentes.
- `title` de refuerzo: en cada `<th>` (`table.ts:134`; `COLUMNS` pasa a pares `col`/`hint`), en los chips (`table.ts:129-130`), en `? pregunta pendiente` (`:80`), en `ronda`/`nota` (`:103-104`), en el badge de estado de documento (`:102`) y en todo `stateBadge` (D4, `badge.ts`).
- CSS: `.table-help`, `.table-help ul` y `.table-help .badge` con el estilo compacto de `.settings-hint` (`styles.css:955`).

### D7. Ayuda en Ajustes

Todo en `options.ts` como `hintKey` y pintado por `settings.ts`:

- Roles: el `span.role-name` de cada fila (`settings.ts:266`) pasa a un `div.role-name-cell` con el nombre y un `span.setting-hint` con `role.hint.*` (qué hace, quién lo lanza y qué entrega). Van en la misma celda porque `.role-grid` tiene tres columnas (`styles.css:960-965`) y un hijo suelto descuadraría la fila; el hint anula la negrita y el `padding-top: 7px` de `.role-name` (`styles.css:971-974`). El texto sale de las plantillas `plugin/templates/*.md.tpl` y de `README.md:34-87`, no se inventa. Debajo de la cuadrícula (dentro del `section` de Roles, `settings.ts:331-335`) un `p.settings-hint` visible con `settings.roles.help`: qué son los alias (`opus`, `sonnet`, `haiku`, `fable`), `inherit` (el modelo de la sesión que lo lanza), `Otro…` (un id completo como `claude-opus-5-5`) y los cinco niveles de esfuerzo de `EFFORTS` (`options.ts:40`). Las cabeceras `Modelo`/`Esfuerzo` (`settings.ts:236-238`) llevan el mismo texto como `title`.
- Permisos: cada fila (`settings.ts:314-326`) añade `setting-hint` con `permissionTargetHint(slug)`: `direccion` → la sesión del director; `redaccion`/`mantenimiento` → el jefe del departamento y su equipo; una planta → su jefe de planta, desarrolladores y testers. Las cinco opciones ya se explican en su etiqueta (`options.ts:42-48`); se traducen tal cual.
- Departamentos y campos numéricos: conservan sus `hint` (`options.ts:57-94`), traducidos.
- Plantas: cada fila (`settings.ts:293-312`) añade `setting-hint`: rama de la que Redacción toma la foto de las fuentes y base con la que se mide el avance de los planes.
- Hub: `readonlyRow` (`settings.ts:111-113`) acepta `hint`: repositorio de documentos (carpeta git donde Redacción guarda planes y fotos y Mantenimiento sus skills; se cambia en `config.json`) y puerto (puerto HTTP del hub, donde se abre el panel).
- `Guardar`, `Guardando…`, `Cambios sin guardar` y los mensajes de validación se traducen; `outcomeText` (`settings.ts:115-119`) traduce solo su parte (`Ajustes guardados`, plural de agentes); la `note` del hub se muestra como llega.

### D8. Tests de la UI

Nuevo `ui/test/i18n.test.ts` con `bun:test` (sin dependencias nuevas; `ui/tsconfig.json:14` no incluye `test/`, así que `typecheck` no lo mira). Importa `es`, `en`, `createTranslator` e `interpolate`: nada de DOM.

1. `en` tiene exactamente las claves de `es`, ninguna vacía, cada clave tiene los mismos marcadores `{…}` en ambos idiomas, y toda clave `*.one` tiene su `*.other` (el tipo no lo garantiza porque `plural(key: string)` compone la clave en tiempo de ejecución).
2. Ninguna clave tiene el mismo texto en `es` y en `en` salvo las listadas en `SAME_KEYS: MessageKey[]` (D1).
3. `createTranslator(es).t('table.files.other', { n: 3 })` devuelve `3 ficheros` y `plural('table.files', 1)` devuelve `1 fichero` (claves reales; también con `createTranslator(en)`).
4. Rastreo: con `Bun.Glob('**/*.ts')` sobre `join(import.meta.dir, '../src')` (no depende del `cwd`), menos `i18n/`, falla si el texto del fichero contiene `[áéíóúñÁÉÍÓÚÑ¿¡]` dentro de un literal delimitado por `'`, `"` o `` ` `` (expresión `/(['"`])(?:(?!\1)[^\n])*[áéíóúñÁÉÍÓÚÑ¿¡](?:(?!\1)[^\n])*\1/`): varias cadenas de hoy van entre backticks (`header.ts:21`, `memory.ts:47`, `116`, `122`, `report.ts:29`, `58`, `deliverables.ts:93`). Lee el fichero entero, comentarios incluidos: hoy ninguno de `ui/src` lleva tilde, y uno futuro con tilde dentro de comillas lo haría fallar (se arregla quitando la tilde del comentario). Detector parcial (no ve español sin tildes), pero caza la mayoría de regresiones gratis.

`ui/package.json` gana `"test": "bun test"`; `package.json:15` pasa a `"test": "cd hub && bun test && cd ../ui && bun test"`. El tester de la planta reconoce `bun run test` por `plugin/profiles/node.json:4` y así cubre ambos.

### D9. README

En `## Uso` (`README.md:94-102`): el selector de idioma de la cabecera y que la elección se guarda en el navegador; una línea sobre la leyenda de la Tabla y las ayudas de Ajustes. Nota de que los textos de los agentes y del hub siguen en español.

### D10. Ficheros que toca este plan y orden con los otros dos

Nuevos: `ui/src/i18n/es.ts`, `ui/src/i18n/en.ts`, `ui/src/i18n/index.ts`, `ui/test/i18n.test.ts`.

Modificados: `ui/src/main.ts`, `topbar.ts`, `labels.ts`, `badge.ts`, `time.ts`, `store.ts`, `api.ts`, `actions.ts`, `replay.ts`, `table/table.ts`, `settings/settings.ts`, `settings/options.ts`, `settings/draft.ts`, `panel/header.ts`, `panel/memory.ts`, `panel/orders.ts`, `panel/deliverables.ts`, `panel/report.ts`, `panel/timeline.ts`, `panel/question-form.ts`, `office/office.ts`, `office/floor-scene.ts`, `scene/scene.ts`, `scene/buildings.ts`, `scene/materials.ts`, `scene/furniture.ts`, `scene/camera.ts`, `scene/labels.ts`, `styles.css`, `ui/package.json`, `package.json`, `README.md`. **No toca el hub.**

Orden de ejecución, fijado por Redacción: **1º este plan, 2º `ajustes-gestion-proyectos-2`, 3º `avisos-escritorio`.** Este plan deja el diccionario, `t()`, el tema `lang` y el test; los otros dos añaden sus claves directamente a `ui/src/i18n/es.ts` y `en.ts` (prefijos `settings.floors.*` el segundo; `notify.*` y `settings.notifications.*` el tercero), pintan con `t()`, reetiquetan en `watch(['lang'])` lo que monten fijo, añaden sus nombres propios a `SAME_KEYS` y deben pasar `ui/test/i18n.test.ts` (el rastreo de D8 falla con cualquier texto con tilde fuera de `i18n/`). Zonas de `settings.ts` que tocan después de este plan: `:143-145` y `:365` el segundo; `:83`, `:365` y `:454` el tercero; son líneas distintas de las de D4, salvo `buildControls` (`:365`), donde este plan solo cambia etiquetas por `t()`. También `api.ts`, `main.ts`, `styles.css` y `README.md`, en bloques propios.

## Pasos

1. `ui/src/i18n/{es,en,index}.ts` con las claves de `labels.ts`, `options.ts` y `topbar.ts` (D1); `store.ts` con el tema `lang` (D2); `main.ts` con `applyLang(readStoredLang())`; `topbar.ts` con el selector y `relabel()` (D3). Verificable: `bun run typecheck`; en el navegador, cambiar el selector traduce las pestañas y el estado, `localStorage['agent-office.lang']` y `<html lang>` cambian y al recargar se mantiene; en una visita limpia no hay clave en `localStorage` y el panel sale en español.
2. `labels.ts`: añadir las funciones de D5 **conservando** las constantes; `badge.ts`, `time.ts`, `store.ts` (toasts), `api.ts`, `actions.ts`, `replay.ts` y `main.ts` a `t()` (D4). Verificable: `typecheck`; los tiempos relativos y los toasts salen en el idioma activo.
3. `table/table.ts`: `t()`, `'lang'` en el `watch`, host con `table-help` y `table-content`, leyenda completa y `title` (D6). Verificable: en inglés ningún texto de la Tabla queda en español; la leyenda enumera columnas, chips, `? pregunta pendiente`, diez estados, seis estados de documento y alertas; se abre, se cierra, recuerda el estado y no pierde la selección de texto mientras la tabla se refresca.
4. `panel/*.ts` a `t()` con `relabel()` o repintado (D4). Verificable: con un agente seleccionado, cambiar de idioma traduce cabecera, pregunta pendiente, entregables (tarjetas y visor abierto), informe (incluido el título), memoria (incluido el título), cronología y órdenes sin perder lo escrito en los `textarea`.
5. `settings/options.ts` a `labelKey`/`hintKey`, `settings/draft.ts` y `settings/settings.ts` a `t()`, ayudas de D7, reconstrucción en `watch(['lang'])`. Verificable: cambiar de idioma con cambios sin guardar conserva el borrador (`Cambios sin guardar` sigue activo con los mismos valores); cada rol, el bloque de alias y esfuerzos, cada destino de permisos, cada planta y cada dato del hub muestran su ayuda sin pasar el ratón.
6. Escenas: `office/office.ts`, `office/floor-scene.ts`, `scene/scene.ts`, `scene/buildings.ts`, `scene/materials.ts`, `scene/furniture.ts`, `scene/camera.ts`, `scene/labels.ts` (D4, D5). Al final, borrar las constantes `*_LABELS` de `labels.ts`. Verificable: `typecheck` pasa sin las constantes; en 2D las placas cambian de subtítulo al cambiar idioma; en `?view=3d` cambian los rótulos, la lista de plantas (`Edificio`, `Anexo`, ayuda de gestos), el cuadro `Siguiendo a` y el estado de las etiquetas de personaje.
7. CSS (`.lang-select`, `.table-help`, `.role-name-cell`) y README (D3, D6, D7, D9). Verificable: lectura, `bun run build` y la cuadrícula de roles sigue alineada en tres columnas con las ayudas puestas.
8. `ui/test/i18n.test.ts`, scripts `test` (D8). Verificable: `cd ui && bun test` pasa; introducir un literal `'Añadir'` en `topbar.ts` lo hace fallar, y también uno con backticks como `` `hace ${n} días` `` en `time.ts`; borrar una clave de `en.ts` hace fallar `typecheck` y el test 1; cambiar `{n}` por `{count}` solo en `en.ts` hace fallar el test 1.

## Riesgos

- Español sin tildes que escape al rastreo (`Guardar`, `Cerrar`): lo cubre la revisión manual de Verificación y la lista de D4, que enumera línea a línea lo que hay que mover.
- Reconstruir Ajustes al cambiar idioma pierde el foco del campo activo y el mensaje de resultado anterior. Es un clic deliberado en el selector; el borrador se conserva (`syncControls`).
- Las escenas regeneran texturas de texto (Pixi `Text`, `signTexture`) al cambiar idioma: un repintado por planta, una vez. Sin coste en marcha normal porque la firma solo cambia con el idioma.
- Mezcla de idiomas en pantalla: la actividad, las notas del hub y los textos de los agentes siguen en español aunque el panel esté en inglés. Se declara en el README y en Preguntas abiertas.
- `localStorage` bloqueado (modo privado estricto): `readStoredLang` y `storeLang` capturan el error; el idioma vale para la sesión y no se recuerda.
- Los planes 2 y 3 van después y el rastreo de D8 les exige escribir en el diccionario desde el primer commit (D10). Ya lo tienen previsto; si uno de ellos se saltara la regla, `bun run test` lo señala con la línea exacta.

## Verificación

Automática, en el clon (`CLAUDE.md:15-18`):

```sh
bun run typecheck                 # hub y ui: en.ts completo, sin constantes huérfanas
bun run test                      # hub + ui/test/i18n.test.ts
cd ui && bun test                 # solo i18n
bun run build
```

Manual, con un hub aislado (`CLAUDE.md:18`), sin `bun run setup` (`CLAUDE.md:11`; además `hub/src/setup.ts:53-56` registraría el clon como marketplace de los hooks de todas las sesiones, y las dos variables no aíslan eso) y sin `bun run dev:ui` (su proxy apunta al hub real en 4747, `ui/vite.config.ts:60-61`). La key se crea a mano: `readKey` solo lee y recorta (`hub/src/config.ts:246`). `bun hub/src/main.ts` sale como regla `ask` en un clon (`plugin/settings/clone-permissions.json:15`) y el usuario la aprueba en el panel.

El `config.json` **tiene que fijar `docsRepo`** a una carpeta temporal: sin él, el valor por defecto es `~/Projects/office-docs` (`hub/src/config.ts:103`) y `office.start()` (`hub/src/main.ts:73`) lanza `sync.cleanup` (`hub/src/office.ts:281`), que recorre `redaccion/.fuentes/*` y, con la base de datos temporal vacía, borra con `git worktree remove --force` y `rmSync` todas las fotos de los planes en curso (`hub/src/sync.ts:200-209`), incumpliendo `CLAUDE.md:12`. Apagar los departamentos no lo evita; con `docsRepo` en `$H/docs` sí es seguro encenderlos (`cleanup` solo recorre `$H/docs/redaccion/.fuentes`), y hacen falta para ver Redacción, Mantenimiento, el anexo y los documentos. Un plan y una skill sembrados a mano en las rutas de `hub/src/documents.ts:7-8` (`titleOf` saca el título del `#` o del `name:`) dan Entregables que abrir.

```sh
H=$(mktemp -d); C=$(mktemp -d); D=$(mktemp -d)
openssl rand -hex 32 > $H/key
echo '{"port":4799,"docsRepo":"'$H'/docs","departments":{"redaccion":true,"mantenimiento":true},"floors":{"demo":{"path":"'$D'","stack":"node","managed":true,"baseBranch":"main"}}}' > $H/config.json
mkdir -p "$H/docs/redaccion/planes" "$H/docs/taller/skills/demo"
printf '# Plan demo\n' > "$H/docs/redaccion/planes/demo.md"
printf -- '---\nname: demo\n---\n' > "$H/docs/taller/skills/demo/SKILL.md"
bun run build
AGENT_OFFICE_HOME=$H AGENT_OFFICE_CLAUDE_HOME=$C bun hub/src/main.ts &
KEY=$(cat $H/key); U='http://127.0.0.1:4799'
until curl -sf "$U/health" >/dev/null; do sleep 0.2; done     # el hub tarda en abrir el puerto
post() { curl -s -X POST "$U/$1" -H "X-Office-Key: $KEY" -H "X-Office-Role: ${ROLE:-office-lead-demo}" -H "X-Office-Name: ${NAME:-lead-demo}" -H 'Content-Type: application/json' -d "$2"; }
post events '{"session_id":"demo-1","cwd":"'$D'","hook_event_name":"SessionStart"}'
ROLE=office-redactor NAME=redactor-demo post events '{"session_id":"demo-2","cwd":"'$H'/docs/redaccion","hook_event_name":"SessionStart"}'
# … pruebas 1-6 …
kill %1; rm -rf "$H" "$C" "$D"     # el hub queda en segundo plano ocupando el 4799
```

1. Abrir `http://127.0.0.1:4799`; `lead-demo` está en la planta `demo` y `redactor-demo` en Redacción. Poner `English` en el selector: pestañas, estado, Tabla (leyenda, cabeceras, chips, estados, `Planes`/`Skills` con sus `title` de `ronda`, `nota` y estado, alertas), panel con `lead-demo` seleccionado, Ajustes completo, placas 2D y, en `?view=3d`, rótulos y navegación cambian sin recargar. Repetir en sentido inverso.
2. Recargar: el idioma se mantiene. En la consola, `localStorage.getItem('agent-office.lang')` y `document.documentElement.lang` coinciden con el selector. En una ventana privada nueva, el panel sale en español y `localStorage.getItem('agent-office.lang')` es `null` hasta tocar el selector.
3. Con cada idioma, recorrer Tabla y Ajustes buscando texto del otro idioma; en Ajustes, cada rol, el bloque de alias y esfuerzos, cada destino de permisos, la planta `demo` y los dos datos del hub muestran su ayuda sin ratón. Pasar el ratón por columnas, estados y chips para comprobar los `title`.
4. Con el panel visible, en inglés y con `lead-demo` seleccionado (la tarjeta solo sale para el agente elegido, `question-form.ts:197-202`), `post permission '{"session_id":"demo-1","cwd":"'$D'","hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"rm -rf build"}}'` (el curl espera): aparece la tarjeta `Pending permission`. Pulsar `Allow`: en la pestaña Red, el cuerpo de `POST /api/answers/<id>` lleva `"Permitir"` y el curl devuelve `"behavior":"allow"` (`hub/src/questions.ts:125-131`).
5. Entregables y anexo: en la Tabla, clic en la fila del plan `demo` abre el visor; con el visor abierto, cambiar de idioma cambia sus botones (`Descartar`/`Cerrar`), la cabecera y el aviso de contenido; seleccionar `redactor-demo` muestra `Entregables · Planes` y sus tarjetas en el idioma activo. En `?view=3d`, la lista de plantas tiene `Anexo`/`Annex`, la placa de Mantenimiento cambia de subtítulo y el rótulo del tejado del anexo cambia de texto al cambiar idioma.
6. Replay (`?replay=/replays/demo.json`, `README.md:104`; la grabación está en `ui/public/replays/demo.json`): los controles (incluidos los `title` de velocidad y reinicio) y el aviso de órdenes desactivadas salen en el idioma activo.

## Preguntas abiertas

- Los textos que genera el hub (actividad, notas de guardado, errores, alertas) quedan en español. Traducirlos pediría que el hub reciba el idioma (cabecera en las peticiones o un ajuste en `config.json`) y mantenga su propio diccionario; propongo un plan posterior si se quiere un panel 100% inglés.
- La leyenda de la Tabla arranca abierta la primera vez y recuerda si se cierra. Si se prefiere cerrada por defecto, es un valor inicial.

## Historial de revisión

- Ronda 1: versión inicial.
- Ronda 2 (nota 6/10, 3 bloqueantes y 9 menores, todos aplicados):
  - Bloqueantes: la prueba manual ya no ejecuta `bun run setup` ni `dev:ui` (key con `openssl`, `config.json` con departamentos apagados y una planta `demo`, `bun hub/src/main.ts` con las dos variables y nota de la regla `ask`); el módulo i18n no toca `localStorage` ni `document` al importarse y el test prueba `createTranslator`/`interpolate` puros (D1, D8); la ayuda deja de depender de `title`: la leyenda de la Tabla cubre chips, `? pregunta pendiente`, `Último test` y los seis estados de documento con `docStatus.hint.*`, y Ajustes tiene una línea visible bajo la cuadrícula de roles para alias, `inherit`, `Otro…` y esfuerzos (D6, D7).
  - Menores: CSS del selector con `width: auto; flex: none` (D3); leyenda montada una vez fuera del `render()` con el `toggle` ampliado (D6); inventario completado con `memory.ts:54`, `deliverables.ts:222`, `Canvas 2D no disponible` en cuatro ficheros, `orders.ts:24`, `relabel()` para `report.ts:168` y `memory.ts:54`, `'lang'` en `deliverables.ts:265` y `orders.ts:140` (D4); constantes de `labels.ts` conservadas hasta el Paso 6 para que cada paso pase `typecheck` (D5, Pasos); test con excepciones por clave, comprobación de marcadores, `import.meta.dir` y nombres de idioma dentro de `i18n/` (D1, D8); `applyLang` separado de `storeLang`, `<html lang>` fijado al cargar y español por defecto sin consultar `navigator.language`, decidido en el plan (D1); coordinación corregida a `ajustes-gestion-proyectos-2` y `avisos-escritorio` con sus ficheros (D10); opciones de modelo aclaradas, origen de las ayudas de rol, `outcome` se limpia al cambiar idioma, repositorio de documentos incluye las skills (D7, D4); `## Uso`, `AgentLabel`, riesgo de `plateTitle` y `startsWith` retirados, verificación del permiso por la pestaña Red con el `curl` de `/permission`, `node.json:4` (D5, D9, Verificación).
- Entre rondas (jefe de Redacción, orden fijado para los tres planes): 1º este plan, 2º `ajustes-gestion-proyectos-2`, 3º `avisos-escritorio`. Se revierte la inversión de orden de la ronda 2 en D10, se quita el paso condicional de migrar constantes de texto ajenas, y se indica que los planes 2 y 3 añaden sus claves a `es.ts`/`en.ts` con sus prefijos y deben pasar `ui/test/i18n.test.ts`. Ajustados Alcance y Riesgos en consecuencia.
- Ronda 3 (nota 8/10, 1 bloqueante y 7 menores, todos aplicados):
  - Bloqueante: la receta manual fija `docsRepo` a `$H/docs` y explica por qué (`sync.cleanup` borraría las fotos de `~/Projects/office-docs` con la base de datos vacía); además cierra con `kill %1` y limpieza de temporales (Verificación).
  - Menores: nombre y ayuda de cada rol en un `div.role-name-cell` que respeta las tres columnas de `.role-grid` y anula la negrita (D7, Paso 7); `readStoredLang` valida contra `LANGS` (D1); test 3 con claves reales, test 1 comprueba `*.one`/`*.other` y el rastreo declara que lee el fichero entero (D8); fuentes de `state.hint.*` (`state-machine.ts`, `README.md:103`) y `docStatus.hint.*` (`README.md:75-78`) (D6); avisos de `loadContent` del visor, `title` de los controles de replay y botón de preguntas del topbar repintados al cambiar idioma (D4); verificación 4 con `lead-demo` seleccionado y `"behavior":"allow"`; nombre único `SAME_KEYS` para la lista de claves iguales, avisado al jefe para alinear `ajustes-gestion-proyectos-2` (que la llama `SAME_IN_BOTH`).
- Ronda 4 (nota 8/10, 2 bloqueantes y 5 menores, todos aplicados):
  - Bloqueantes: la receta manual enciende los departamentos (seguro con `docsRepo` temporal), siembra un plan y una skill en las rutas de `hub/src/documents.ts:7-8` y un `redactor-demo` en Redacción, y añade la prueba 5 (visor abierto al cambiar idioma, Entregables, `Anexo`, placa y tejado en 3D); el rótulo del tejado del anexo (`buildings.ts:599`) entra en D4 con `t('floor.mantenimiento')` y la firma de `Site.update` incluye el idioma.
  - Menores: fuente real de `docStatus.hint.*` en `statusOf` (`documents.ts:257-265`) (D6); el rastreo cubre `'`, `"` y backticks, con su expresión y un caso de prueba (D8, Paso 8); `deliverables.ts` mete `store.lang` en `signature` en vez de vaciarla (D4); espera a `/health` y replay concreto `?replay=/replays/demo.json` (Verificación); `Hub` y `Roles` en `SAME_KEYS`, y `SAME_IN_BOTH` de los otros dos planes declarado como la misma lista (D1).
