# Agent Office v2 — modelos por rol, memoria, Redacción, Mantenimiento y oficina 3D

## Contexto

Agent Office v1 está construida y probada en vivo (rama local `build/v1` de `~/Projects/agent-office`, 101 tests): plugin de hooks, hub Bun + SQLite, plantas por repositorio con jefe, desarrollador, tester y revisor, puerta de tests con `HECHO:`, preguntas y órdenes desde el panel, y una oficina 2D en PixiJS.

Pides cinco cosas nuevas:

1. Elegir por rol el modelo y su nivel de esfuerzo por defecto.
2. Una planta de Redacción: redactores que escriben planes, revisores de la misma planta que devuelven mejoras, en bucle hasta que no queda nada que mejorar, y entonces el plan sube al jefe y se te muestra.
3. Cada agente, al seleccionarlo, con un informe de lo que ha hecho y una memoria para no repetir errores.
4. Un edificio anexo, Mantenimiento, cuyo equipo crea skills.
5. Oficina en 3D con personajes de videojuego, más realistas que el pixel art.

### Hallazgos que condicionan el diseño (docs y pruebas del 2026-10-16)

- **Memoria nativa de agentes.** El frontmatter `memory: user|project|local` da a un agente una carpeta persistente (`~/.claude/agent-memory/<agente>/`) cuyo `MEMORY.md` se carga al arrancar. Depende de la memoria automática y la doc de agent teams no lo lista entre los campos que se aplican a los compañeros de equipo. No sirve como única memoria: la oficina lleva la suya, uniforme para todos los roles y visible en el panel.
- **Los hooks pueden inyectar contexto.** `SubagentStart` admite `hookSpecificOutput.additionalContext` ("String added to the subagent's context at the start of its conversation"); `SessionStart` y `UserPromptSubmit` también, por JSON o por stdout. La doc pide redactarlo como hechos, no como órdenes. Es el canal para dar a cada agente su memoria al empezar sin que lea ficheros fuera de su repositorio.
- **Modelo y esfuerzo.** El frontmatter de un agente acepta `model: sonnet|opus|haiku|fable|<id>|inherit` y `effort: low|medium|high|xhigh|max`. En la prueba en vivo el `model` del agente se aplicó a las sesiones arrancadas con `--agent` (director en Opus, jefes en Sonnet). Para un compañero de equipo manda el modelo que nombre el prompt de spawn, después el de su definición. La lista `tools:` de la definición de un compañero sí le limita; la del jefe limita a toda la sesión y por eso el jefe no lleva lista.
- **Sin herramientas de tareas.** Sigue sin haber `TaskCreate`/`TaskUpdate`; la puerta vive en el aviso `HECHO:` (hook `PreToolUse` sobre `SendMessage`). Las nuevas plantas usan el mismo mecanismo con otro veredicto.
- **`--add-dir` concede lectura y escritura**, no solo lectura. Por eso Redacción no lo usa: lee fotos de la rama base de cada planta en worktrees propios dentro de su carpeta. Solo Mantenimiento lo lleva, sobre `~/.claude/skills`, y un hook vigila esas escrituras.
- **Skill `skill-creator`.** Está sincronizada a nivel de usuario (`~/.claude/skills/synced/…/skill-creator`), así que cualquier sesión puede invocarla. Mantenimiento la usa para escribir skills. Sus scripts escriben por Bash, que los hooks de Edit/Write no ven.
- **Personajes 3D.** No hay personajes realistas gratuitos descargables por script. Lo más cercano con licencia clara es el pack "Ultimate Modular Men" de Quaternius: 11 personajes low-poly con ropa de oficina (Business Man, Casual, Hoodie, Worker, SWAT, Punk, Astronaut…), 24 animaciones, GLB, CC0 según su página, poly.pizza y Patreon (una guía de terceros habla de una licencia QAL nueva; se comprueba en el spike). La descarga es un botón JavaScript sin URL fija. Personajes realistas de Mixamo son gratuitos para usarlos en una app, pero se descargan a mano con cuenta de Adobe en FBX y no se pueden redistribuir como pack.
- **Three.js 0.186** con `GLTFLoader`, `AnimationMixer`, `SkeletonUtils.clone` (para repetir un personaje) y `CSS2DRenderer` (etiquetas y bocadillos en HTML sobre la escena) cubre lo que hace falta. El retargeting de animaciones entre esqueletos distintos no está bien resuelto en Three.js: cada pack de personajes trae sus propias animaciones y no se mezclan.
- **`marked` 18** para pintar planes, skills y memoria en el panel.

## Decisiones

- **Todos los agentes se generan desde plantillas** en `~/.claude/agents/office-*.md`, también director y revisor. Así el modelo y el esfuerzo de cada rol salen de la configuración y `floor add --all` los regenera. El plugin se queda con hooks, perfiles, plantillas y la skill de protocolo. Las plantillas de jefe prohíben nombrar un modelo al lanzar compañeros: manda Ajustes.
- **Redacción y Mantenimiento son departamentos** con repositorio propio: `setup` crea `~/Projects/office-docs` (ruta en `docsRepo`) con `git init` y las carpetas `redaccion/` y `taller/`; el hub las resuelve por ruta antes que por raíz git, como hoy `workspace/` → Dirección. **Los commits de cada ronda los hace el hub** en ese repo con `git add <ruta> && git commit --only -- <ruta>`, así nunca arrastran tu staging ni caen en la rama de desarrollo de la oficina. Subirlo a GitHub es decisión tuya. El jefe de Redacción no lleva `--add-dir`: los redactores leen una foto de la rama base de cada planta en un worktree dentro de `redaccion/.fuentes/` (ver Fuentes de Redacción); el de Mantenimiento arranca con `--add-dir ~/.claude/skills` para instalar.
- **Un veredicto por tipo de planta, con una referencia de cambio distinta.** La puerta del `HECHO:` exige: en plantas de código, tests en verde del tester posteriores al último Edit/Write del desarrollador; en Redacción y Mantenimiento, `APROBADO:` del revisor posterior al **último cambio del documento**, porque el artesano escribe por Bash y los hooks no lo ven. Para un plan es el mtime del fichero; para una skill, el mtime máximo de los ficheros de `taller/skills/<nombre>/`, recorriendo la carpeta de forma recursiva (nunca `stat` sobre la carpeta, cuyo mtime solo cambia al crear o borrar entradas). Misma tabla `verdicts` y mismo hook.
- **Rondas con bloqueantes y menores.** El revisor clasifica cada punto como `bloqueante` o `menor`. Aprueba cuando no quedan bloqueantes; la nota es informativa. Si en la ronda `maxRounds` quedan bloqueantes, contesta `SIN ACUERDO:` y el jefe manda `BLOQUEADO:` al director o a ti en vez de aprobar. Cada ronda la revisa un revisor nuevo que lee el historial de revisión del documento, y por defecto redactor y revisor usan modelos distintos.
- **Guardia de permisos.** Un hook `PreToolUse` sobre Edit, Write, MultiEdit, NotebookEdit y Bash consulta al hub, que bloquea las escrituras de los roles de un departamento fuera de su carpeta (salvo la instalación de skills del jefe de Mantenimiento). Para Edit y Write es exacta; para Bash es **parcial** (detecta rutas en el comando, pero no `cd`, variables, rutas relativas ni scripts que escriben por su cuenta), y el artesano es justo quien tiene Bash. Red de seguridad por huellas: cuando arranca un agente de departamento, el hub guarda la huella (`git hash-object`, o mtime y tamaño si es más rápido) de cada fichero que `git status --porcelain --untracked-files=all` lista en cada planta gestionada (sin `--untracked-files=all` una carpeta nueva sale como una sola línea `?? carpeta/` y no tiene huella), y al terminar vuelve a listar y comparar. De los ficheros nuevos o con huella distinta descarta los que algún agente de esa planta tocó con Edit o Write en el intervalo, que el hub ya conoce por sus eventos. Lo que queda sale en el panel y en la actividad como **alerta** si en ese intervalo no trabajó ningún agente de la planta, y como **posible** si trabajó alguno, porque sus comandos Bash (codegen, builds) no se pueden atribuir. Los departamentos nunca trabajan sin guardia: sus lanzadores comprueban `GET /health` del hub y no abren la sesión si no responde.
- **Memoria de la oficina, no nativa.** Lecciones por planta y rol, guardadas en el hub, inyectadas por hook al empezar cada agente con un tope de caracteres, capturadas de mensajes `LECCIÓN:` con poda y sin duplicados, y editables desde el panel. Un informe por agente generado por el hub a partir de sus eventos, más su mensaje de cierre.
- **La oficina 3D convive con la 2D hasta estar a la par.** Three.js entra en `ui/src/scene/`; PixiJS sigue disponible con `?view=2d` (y por defecto hasta que la 3D cumpla los criterios de paridad). Tabla, panel y replay se mantienen.
- **Personajes:** el pack CC0 de Quaternius por defecto y una carpeta `custom/` donde dejas modelos de Mixamo que descargues tú; la oficina prefiere los tuyos cuando existen. Si el spike confirma CC0, los GLB se commitean en el repo privado (LFS si pasan de 10 MB) y no hay script de descarga; si la licencia resulta ser QAL, se lee qué dice de redistribución antes de decidir.
- **Instalación de skills aprobadas:** el jefe de Mantenimiento pregunta cada vez con `AskUserQuestion` entre `~/.claude/skills/<nombre>` y `.claude/skills/<nombre>` del repositorio de una planta; la pregunta sale en el panel si está abierto. Antes de encargar una skill comprueba que el nombre no choca con las instaladas ni con las sincronizadas.
- **Esquema v2 sin migración de datos, y es la última vez.** `verdicts` sustituye a `test_runs`; con 14 días de retención, los datos viejos se descartan: `PRAGMA user_version` 1 → 2 borra y recrea las tablas. A partir de v2 las lecciones y los informes tienen valor, así que las migraciones siguientes solo añaden tablas o columnas y nunca borran; `db.ts` deja esa regla escrita junto al número de versión.

## Configuración (`~/.config/agent-office/config.json`)

```json
{
  "floors": { "mobile": { "path": "…", "stack": "flutter", "managed": true, "baseBranch": "develop" } },
  "roles": {
    "director":        { "model": "opus",   "effort": "high" },
    "lead":            { "model": "sonnet", "effort": "medium" },
    "dev":             { "model": "opus",   "effort": "medium" },
    "tester":          { "model": "sonnet", "effort": "medium" },
    "reviewer":        { "model": "sonnet", "effort": "medium" },
    "redactor":        { "model": "opus",   "effort": "high" },
    "revisor-planes":  { "model": "sonnet", "effort": "xhigh" },
    "artesano":        { "model": "sonnet", "effort": "medium" },
    "revisor-skills":  { "model": "opus",   "effort": "medium" }
  },
  "docsRepo": "~/Projects/office-docs",
  "departments": { "redaccion": true, "mantenimiento": true },
  "review": { "maxRounds": 4 },
  "memory": { "maxLessons": 30, "maxLessonsPerSession": 3, "maxContextChars": 4000 },
  "blockedAfterMinutes": 5, "retentionDays": 14, "port": 4747
}
```

Se edita desde la pestaña **Ajustes** de la oficina (`POST /api/settings`): el hub guarda, regenera los agentes y los lanzadores (`regenerateAll` y `writeOfficeScripts`, ya existentes en `hub/src/floor-cli.ts` y `hub/src/office-sh.ts`) y avisa de que se aplica a las sesiones y equipos nuevos. Los lanzadores pasan además `--model` y `--effort` a director y jefes.

## Roles

| Rol | Agente generado | Herramientas | Qué hace |
|---|---|---|---|
| Director | `office-director` | sin lista (sesión principal) | Igual que hoy; además encarga planes a Redacción y skills a Mantenimiento |
| Jefe de planta | `office-lead-<planta>` | sin lista | Igual que hoy; no nombra modelo al lanzar |
| Desarrollador, tester, revisor | `office-dev-<planta>`, `office-tester-<planta>`, `office-reviewer` | como hoy | Igual que hoy |
| Jefe de Redacción | `office-lead-redaccion` | sin lista | Recibe el encargo, sincroniza las fuentes, escribe el brief, lanza redactor y un revisor por ronda, entrega |
| Redactor | `office-redactor` | Read, Grep, Glob, WebFetch, WebSearch, Write, Edit, SendMessage | Investiga en `redaccion/.fuentes/<slug>/`, escribe `redaccion/planes/<slug>.md`, aplica las mejoras |
| Revisor de planes | `office-revisor-planes` | Read, Grep, Glob, SendMessage | Devuelve `MEJORAR:` con puntos clasificados, `APROBADO:` o `SIN ACUERDO:`; nunca edita |
| Jefe de Mantenimiento | `office-lead-mantenimiento` | sin lista | Comprueba nombres, lanza artesano y revisor, pregunta dónde instalar, instala |
| Artesano | `office-artesano` | Read, Grep, Glob, Write, Edit, Bash, Skill, SendMessage | Invoca `skill-creator`, escribe `taller/skills/<nombre>/` |
| Revisor de skills | `office-revisor-skills` | Read, Grep, Glob, SendMessage | Revisa frontmatter, disparo, estructura, longitud, secretos y los scripts incluidos (comandos, red, rutas fuera del repo) |

`scope.ts` amplía `roleKind` con `writer`, `planReviewer`, `skillwright` y `skillReviewer`; `FloorKind` añade `redaccion` y `mantenimiento`; `FloorView` añade `building: 'principal' | 'mantenimiento'`.

Nombres de los compañeros, únicos aunque haya varios encargos a la vez: `redactor-<slug>`, `revisor-planes-<slug>-rN`, `artesano-<nombre>`, `revisor-skills-<nombre>-rN`. Las plantillas de jefe los imponen.

## Mensajes del protocolo

Todos llevan la ruta del documento como primer token, relativa al repo `office-docs`:

- `REVISAR: <ruta> ronda N` (redactor o artesano → revisor)
- `MEJORAR: <ruta> ronda N — nota X/10` seguido de una lista numerada donde cada punto empieza por `bloqueante:` o `menor:`
- `APROBADO: <ruta> ronda N — nota X/10 — <motivo>`
- `SIN ACUERDO: <ruta> ronda N — <bloqueantes que quedan>`
- `HECHO: <ruta> aprobado en N rondas — <resumen>` (jefe → director)
- `LECCIÓN: <qué pasó y cómo evitarlo>` (cualquiera → su jefe), `BLOQUEADO:` como hoy

El hub registra `MEJORAR:` y `SIN ACUERDO:` como veredictos negativos y `APROBADO:` como positivo, los tres ligados a la ruta, y commitea el documento en cada `REVISAR:` y `APROBADO:` con el mensaje `redaccion: <slug> ronda N` o `taller: <nombre> ronda N`.

## Flujos

### Redacción

1. El director (o tú) manda el encargo a `lead-redaccion`.
2. El jefe sincroniza las fuentes de las plantas implicadas con `plugin/scripts/office-sync.sh` (lee la key del hub y llama a `POST /api/redaccion/sync`), escribe un brief (objetivo, alcance, plantas, base `mobile develop @ abc1234` y cambios desde el último plan, criterios) y lo envía al redactor.
3. El redactor investiga en `redaccion/.fuentes/<slug>/` con las herramientas de lectura y escribe el plan con estructura fija: Contexto (con la base), Objetivo, Alcance, Diseño, Pasos, Riesgos, Verificación, Preguntas abiertas, Historial de revisión. Envía `REVISAR:`.
4. El jefe lanza un revisor nuevo para la ronda (`revisor-planes-<slug>-rN`), que lee el plan y su historial y contesta `MEJORAR:` con puntos `bloqueante:`/`menor:`, `APROBADO:` si no quedan bloqueantes, o `SIN ACUERDO:` si es la ronda `maxRounds` y quedan.
5. Con `MEJORAR:` el redactor aplica los puntos, anota la ronda en el historial y vuelve al paso 3.
6. Con `APROBADO:` el redactor avisa `HECHO:` al jefe y el jefe `HECHO:` al director (o a ti) con el resumen ejecutivo. La puerta comprueba que hay un `APROBADO:` de esa ruta posterior al mtime del fichero. Con `SIN ACUERDO:` el jefe manda `BLOQUEADO:` con los puntos que quedan y el plan sigue abierto, con su foto, hasta que decidas. Con `HECHO:` el hub retira los worktrees de sus fuentes.
7. El panel muestra el plan: la planta Redacción tiene una sección **Entregables** con cada plan, su estado (borrador, en revisión ronda N, aprobado, sin acuerdo), la base sobre la que se escribió y cuánto ha avanzado `develop` desde entonces, y el markdown pintado.

### Fuentes de Redacción (develop al día)

- Cada encargo nuevo trabaja sobre una foto reciente de la rama base de cada planta implicada, nunca sobre la copia de trabajo viva. Rama base en `floors.<planta>.baseBranch` (por defecto `develop`).
- Antes de escribir el brief, el jefe llama a `POST /api/redaccion/sync` con `{"slug": "…", "floors": ["mobile"], "ref": opcional}`. Por cada planta, el hub:
  1. `git fetch origin <baseBranch>`, sin tocar la copia de trabajo ni la rama activa.
  2. `git worktree add --detach <docsRepo>/redaccion/.fuentes/<slug>/<planta> origin/<baseBranch>`. Desacoplado, para no bloquear `develop` en ningún otro worktree.
  3. Devuelve el SHA, la fecha y los commits nuevos desde el último plan sobre esa planta: `git log --oneline <último sha visto>..origin/<baseBranch>`, hasta 30 líneas, con un `--stat` resumido.
- El jefe pega en el brief la base (`mobile develop @ abc1234`) y los cambios desde el último plan. El redactor la anota en Contexto.
- Redactor y revisores leen `redaccion/.fuentes/<slug>/…`, que ya está dentro de su carpeta. El jefe de Redacción deja de arrancar con `--add-dir` de las plantas. La guardia bloquea escrituras en `.fuentes/`, y `.fuentes/` va en el `.gitignore` de `office-docs`.
- La foto queda fija durante todas las rondas, para que el revisor juzgue contra el mismo código que leyó el redactor. Al `APROBADO:` el hub registra el veredicto, responde al hook y lanza el `fetch` aparte, fuera del hook, para que un `fetch` lento no retrase el mensaje ni agote el tiempo del hook; cuando termina, si `develop` ha avanzado, Entregables muestra "aprobado sobre abc1234 — develop va N commits por delante", con los ficheros tocados. Las huellas al terminar un agente de departamento se calculan igual, fuera del hook.
- Si el `fetch` falla (sin red, sin credenciales), el hub usa el último `origin/<baseBranch>` que tenga y lo indica ("develop a fecha de …"); el jefe lo traslada al brief. Si la rama no existe en esa planta, devuelve un error claro y el jefe pregunta.
- Los worktrees se retiran (`git worktree remove` y `git worktree prune`) solo con `HECHO:`, cuando descartas el plan desde el panel, o cuando pasan `retentionDays` sin actividad en él. Un `BLOQUEADO:` por `SIN ACUERDO:` conserva la foto: lo normal es que decidas tú y haya otra ronda sobre la misma base.
- Al arrancar, el hub retira los worktrees de `.fuentes/` que no pertenezcan a un plan abierto y hace `prune` en cada planta, para que una sesión muerta no deje worktrees huérfanos registrados en el repo de la planta.
- La tabla `floor_sync` guarda el último SHA visto por planta y los worktrees abiertos por plan.
- Un encargo sobre una rama concreta pasa `"ref": "feature/x"` en el sync.
- Los redactores no ven trabajo que aún no esté en la rama base; para un plan sobre una rama en curso está el `ref`. La foto tampoco tiene lo que está en `.gitignore`: en Flutter, los ficheros generados (`*.g.dart`, freezed) ni las dependencias de `pub`. Los redactores leen las anotaciones, no el código generado; la plantilla del redactor lo dice.

### Mantenimiento

1. Encargo a `lead-mantenimiento`: del director, de un jefe que en su `HECHO:` deja "pendiente: haría falta una skill para…", o tuyo.
2. El jefe comprueba que el nombre no existe en `~/.claude/skills`, en `synced/` ni en el `.claude/skills` de la planta destino, y lanza a `artesano-<nombre>`.
3. El artesano invoca `skill-creator` y escribe la skill en `taller/skills/<nombre>/`. Envía `REVISAR:`.
4. Mismo bucle que Redacción, con `revisor-skills-<nombre>-rN` nuevo por ronda que además lee los scripts incluidos.
5. Con `APROBADO:`, el jefe pregunta con `AskUserQuestion` dónde instalarla, copia la carpeta al destino y avisa `HECHO:` al director. Sin aprobación no instala.
6. Al terminar el artesano, el hub compara las huellas de las plantas gestionadas con las del arranque y avisa de lo que no pueda atribuir (ver Permisos).
7. El panel muestra las skills del taller con su estado y dónde están instaladas. `documents.ts` solo cuenta como skill una carpeta de `taller/skills/` con `SKILL.md` dentro e ignora las de trabajo que deje `skill-creator` (por ejemplo `<nombre>-workspace/`); la instalación copia únicamente `taller/skills/<nombre>/`.

### Permisos (guardia)

- `plugin/hooks/guard.sh` en `PreToolUse` para Edit, Write, MultiEdit, NotebookEdit y Bash: manda el evento a `POST /guard`; el hub responde `block:<motivo>` o `pass`; el script sale 2 con el motivo cuando bloquea y 0 en cualquier otro caso, también con el hub apagado.
- Regla del hub: si el rol del agente es de Redacción, las escrituras tienen que quedar dentro de `redaccion/` y fuera de `redaccion/.fuentes/`, que nadie escribe; si es de Mantenimiento, dentro de `taller/`, salvo el jefe de Mantenimiento, que además puede escribir en `~/.claude/skills/` y en `<planta>/.claude/skills/`. Los roles de plantas de código no se tocan.
- Bash: se bloquea un comando de rol de departamento que nombre una ruta de una planta gestionada o de `~/.claude` fuera de lo permitido. Es protección parcial y queda documentada como tal; la red de seguridad es la comparación de huellas de las plantas al terminar cada agente de departamento, con atribución por los eventos de Edit y Write y dos niveles de aviso (alerta y posible).
- Los lanzadores de `lead-redaccion` y `lead-mantenimiento` hacen `curl -sf http://127.0.0.1:<puerto>/health` y, si el hub no responde, imprimen el motivo y no arrancan la sesión.
- El rol se resuelve como en la memoria (ver abajo); si el hub no lo conoce, no bloquea.

### Memoria

- **Captura.** Cualquier agente envía `LECCIÓN:` a su jefe cuando algo salió mal o aprendió algo que cambia cómo trabajar; las plantillas piden que no se manden lecciones rutinarias y limitan a `maxLessonsPerSession` por agente. El hub guarda la lección para la pareja planta y rol del remitente, descarta duplicados (texto normalizado: minúsculas, sin tildes ni espacios repetidos) y poda las más antiguas de origen agente cuando se pasa de `maxLessons`; las que añades tú desde el panel no se podan.
- **Resolución del rol** de un compañero recién nacido, por orden: el `agent_type` del evento si ya es un nombre `office-…`; el `members[].agentType` del `config.json` del equipo; la llamada `Agent` anterior con el mismo `name` (las plantillas exigen nombres únicos); el prefijo del nombre (`dev-`, `tester-`, `redactor`, `revisor-`). El spike 2 fija cuál de las fuentes llega a tiempo con dos lanzamientos en paralelo.
- **Inyección.** `emit.sh` imprime la respuesta del hub cuando no está vacía. Para `SubagentStart` el hub responde `additionalContext` con las lecciones del rol en esa planta (más recientes primero) y una línea por cada uno de los tres últimos informes, recortado a `maxContextChars`; para `SessionStart`, lo mismo para director y jefes. Redactado como hechos ("Lecciones registradas por el rol X en la planta Y: …").
- **Panel.** Sección **Memoria** del agente seleccionado: lecciones (borrar, añadir) e historial de informes del rol. Solo en plantas gestionadas y departamentos; en plantas observadas no se captura texto.

### Informes

- El hub calcula el informe de cada agente a partir de sus eventos: inicio y fin, encargos (`HECHO:`, `BLOQUEADO:`), ficheros cambiados, tests y veredictos, mensajes enviados y recibidos, preguntas, y el mensaje de cierre (`last_assistant_message` de `SubagentStop`/`SessionEnd`).
- Se muestra en vivo en la sección **Informe** del panel y se guarda en `reports` al terminar el agente, con un resumen de una línea que es lo que entra en la memoria.

## Oficina 3D

- `ui/src/scene/`: `scene.ts` (renderer, luces, cámara, bucle), `buildings.ts` (edificio principal con plantas apiladas en corte tipo casa de muñecas: Dirección arriba, luego Redacción, luego las plantas gestionadas y las observadas; anexo Mantenimiento al lado, más bajo, unido por un pasillo), `furniture.ts` (mesas, monitores, banco de laboratorio, mesa de reuniones, café, mesa de redacción, banco de taller; geometría procedural), `characters.ts` (carga de GLB, un clon por agente, `AnimationMixer`, variante de modelo por rol), `labels.ts` (nombre, estado, bocadillo "?", candado y check con `CSS2DRenderer`), `camera.ts` (`OrbitControls` acotados, presets por planta, seguir al seleccionado), `picking.ts` (selección por `Raycaster`), `assets.ts` (manifiesto de modelos y clips, y maniquíes procedurales de respaldo).
- **Estados → animaciones:** libre: idle con taza; trabajando: sentado tecleando (si el pack no trae clip de teclear, pose procedural de brazos sobre el idle sentado); leyendo: idle con carpeta; en tests: camina al laboratorio y vuelve, con barra encima; revisando: sello; pregunta: mano levantada y bocadillo; hablando: gesto de hablar y línea al destinatario; bloqueado: cabeza baja, tinte rojo y candado; terminado: saludo y desvanecido. Reuniones: los dos caminan a la mesa de reuniones de la planta anfitriona.
- **Personajes por rol:** director Business Man; jefes Casual; desarrolladores Hoodie con color por agente; testers Worker; revisores con gafas (material); redactores y revisores de planes con chaleco; artesanos con delantal (material); becarios camiseta lisa.
- **Assets:** `ui/public/assets/characters/` con los GLB del pack (commiteados si el spike confirma CC0) y su fichero de licencia; carpeta `custom/` para modelos propios: `<rol>.glb` con clips `idle, walk, sit, type, talk, wave, think`; `docs/assets.md` explica el flujo Mixamo (descargar personaje y animaciones en FBX, convertir a GLB con el script de Blender `tools/fbx2glb.py`, copiar a `custom/`). Sin ningún asset la oficina pinta maniquíes y sigue funcionando.
- **Paridad con la 2D** (criterios para hacerla vista por defecto y retirar PixiJS): todos los estados y roles visibles, selección y panel sincronizados, reuniones, plantas al vuelo, replay, 30 agentes fluidos, capturas sin pantalla en verde.

## Cambios por paquete

- **hub**: esquema v2 (`PRAGMA user_version`; `verdicts` sustituye a `test_runs`; nuevas `lessons`, `reports`, `documents`; regla de migraciones aditivas desde v2); `config.ts` con `roles`, `docsRepo`, `departments`, `review`, `memory` y `baseBranch` por planta; `floors.ts` resuelve `<docsRepo>/redaccion` y `<docsRepo>/taller` antes que la raíz git (también los worktrees de `.fuentes/`, cuya raíz git es la planta); `sync.ts` (`fetch`, `worktree add --detach`, log desde el último SHA, tabla `floor_sync`, `worktree remove` y `prune` al `HECHO:`, al descartar desde el panel o por antigüedad, limpieza de huérfanos al arrancar, `fetch` tras `APROBADO:` fuera del hook y aviso de rama por delante); `gate.ts` decide por tipo de planta y referencia de cambio (eventos o mtime de fichero o de carpeta); `state-machine.ts` reconoce `REVISAR:`, `MEJORAR:`, `APROBADO:`, `SIN ACUERDO:`, `LECCIÓN:` y extrae la ruta; `memory.ts` (captura, duplicados, poda, texto de inyección con tope); `reports.ts`; `documents.ts` (escaneo y `fs.watch` de `redaccion/planes` y `taller/skills`, mtime, estado por veredictos, commits por ronda con `git commit --only` en `docsRepo`); `guard.ts` (reglas de escritura por rol; huellas de los ficheros listados por `git status` al arrancar y terminar agentes de departamento, atribución por eventos y avisos alerta/posible); `server.ts` con `/health`, `/api/settings`, `/api/memory/:floor/:role`, `/api/reports/:agent`, `/api/documents`, `/api/redaccion/sync`, `/guard`, y respuestas con `additionalContext` en `/events` para `SessionStart` y `SubagentStart`; `office-sh.ts` abre `lead-redaccion` (sin `--add-dir`) y `lead-mantenimiento` (con `--add-dir ~/.claude/skills`) según `departments`, con comprobación de `/health`, `--model` y `--effort`; `setup.ts` crea `docsRepo` con `.fuentes/` en su `.gitignore`.
- **plugin**: `emit.sh` imprime la respuesta del hub; `guard.sh` nuevo y su entrada en `hooks.json`; `scripts/office-sync.sh` para que el jefe de Redacción pida la sincronización; plantillas nuevas (`director`, `reviewer`, `lead-redaccion`, `redactor`, `revisor-planes`, `lead-mantenimiento`, `artesano`, `revisor-skills`) y las existentes con `{{model}}`, `{{effort}}`, la regla de `LECCIÓN:` y la prohibición de nombrar modelo al lanzar; `plugin/agents/` desaparece; `office-protocol` documenta los mensajes nuevos.
- **ui**: pestaña Ajustes; panel con Informe, Memoria y Entregables (markdown con `marked`); escena 3D en `scene/` junto a `office/`, selector `?view=2d|3d` y ajuste de vista por defecto; `three` y `marked` entran en las dependencias; la grabación de demo se amplía con Redacción y Mantenimiento.
- **repos**: `office-docs` nuevo (lo crea `setup`) con `redaccion/planes/` y `taller/skills/`; en `agent-office`, `docs/assets.md`, `tools/fbx2glb.py` y los assets commiteados según el spike.

## Fases

### Fase 0 — Spikes (medio día)
1. **Assets.** Conseguir el pack de Quaternius (Chrome sin pantalla o a mano), listar personajes y nombres de los 24 clips, confirmar un solo esqueleto, leer la página de licencia del sitio y decidir entre commitear los GLB o documentar la descarga manual. Decidir la pose de teclear.
1b. **`skill-creator`.** Crear una skill de prueba con ella en una carpeta temporal y anotar qué deja en disco además de `<nombre>/SKILL.md` (carpetas de trabajo, evaluaciones), para que `documents.ts` y la instalación las ignoren.
2. **Inyección y rol en vivo.** Un jefe lanza dos compañeros a la vez; comprobar qué trae `agent_type` en sus `SubagentStart`, si el `config.json` del equipo ya lista a cada uno con `agentType` en ese momento, y que un `additionalContext` devuelto por el hook llega: el compañero debe citar su memoria al preguntarle. Lo mismo con `SessionStart` en un jefe.
3. **Fuentes, `fetch` desde el hub y guardia.** El hub arrancado en segundo plano (tmux) hace `git fetch origin develop` en mobile sin intervención; puede faltarle `SSH_AUTH_SOCK` o el credential helper de tu terminal, y si falla hay que decidir cómo hereda el entorno. Medir cuánto tarda `git worktree add --detach` de mobile. Un redactor lanzado por el jefe lee `redaccion/.fuentes/<slug>/mobile` y un intento de Write ahí lo bloquea el hook con el motivo; el jefe de Mantenimiento, con `--add-dir ~/.claude/skills`, sí puede escribir allí.
4. **`--model` y `--effort` en sesiones `--agent`.** Confirmar en `/status` el esfuerzo aplicado y qué gana cuando el `--model` del lanzador y el `model:` del agente no coinciden.

### Fase 1 — Modelos por rol y Ajustes (1 día)
Configuración `roles`, plantillas con modelo y esfuerzo, generación de director y revisor, lanzadores con `--model`/`--effort`, endpoint y pestaña Ajustes, migración de los agentes actuales.

### Fase 2 — Memoria e informes (1-2 días)
Esquema v2, captura de `LECCIÓN:` con poda y duplicados, inyección por `SubagentStart`/`SessionStart` con tope, informes en vivo y guardados, secciones Informe y Memoria del panel, plantillas con la regla de lecciones.

### Fase 3 — Redacción (2 días y medio)
Repo `office-docs`, departamento, fuentes (`sync.ts`, `office-sync.sh`, worktrees y su limpieza), plantillas, veredictos con bloqueantes, puerta por mtime, guardia de permisos y red de huellas, commits por ronda, documentos y sección Entregables, prueba real con un plan pequeño sobre mobile que necesite al menos dos rondas. Punto de decisión al final: si las revisiones de Sonnet salen superficiales frente a un redactor en Opus, se invierten los modelos por defecto (redactor Sonnet, revisor Opus) y se repite la prueba.

### Fase 4 — Mantenimiento (1 día)
Departamento y anexo, plantillas con `skill-creator` y revisión de scripts, comprobación de nombres, instalación con confirmación, prueba real creando una skill trivial en el taller.

### Fase 5 — Oficina 3D (3-5 días)
Escena, edificios, muebles, personajes y animaciones, etiquetas, cámara y selección, replay de demo ampliado, capturas sin pantalla; `?view=2d` disponible todo el tiempo.

### Fase 6 — Retirada de PixiJS
Solo cuando la 3D cumpla los criterios de paridad: vista 3D por defecto y borrado de `office/`, `sprites/` y `pixi.js`.

## Verificación

- `bun test` en `hub/` con tests nuevos: veredictos por tipo de planta y puerta por mtime de fichero y de carpeta en Redacción y Mantenimiento, incluido `SIN ACUERDO:`; captura, duplicados y poda de lecciones; texto de inyección con tope y respuesta de `/events`; resolución de rol con lanzamientos en paralelo y nombres con slug; guardia (redactor bloqueado fuera de `redaccion/`, jefe de Mantenimiento instalando en `~/.claude/skills`, hub apagado no bloquea; huellas: un fichero ya modificado que cambia de contenido se detecta, un cambio hecho por Edit de un desarrollador de la planta no genera aviso, un cambio sin atribuir sale como alerta sin agentes de la planta activos y como posible con ellos); mtime de skill recursivo (editar un script existente mueve la referencia); informes; documentos, estado y commit por ronda con `--only` en un repo con staging ajeno; fuentes (sync con `fetch` fallido usa el último `origin/develop` y lo indica, rama inexistente da error claro, dos planes en paralelo crean worktrees distintos, `HECHO:` los retira y hace `prune` mientras `BLOQUEADO:` los conserva, al arrancar se retiran los huérfanos, el `fetch` tras `APROBADO:` no bloquea la respuesta del hook, y después sale el aviso de rama por delante con los ficheros); `/api/settings` regenera agentes con el modelo elegido; migración de esquema y rechazo de migraciones destructivas desde v2.
- `bun run typecheck` y `bun run build`.
- En vivo: cambiar el modelo del desarrollador en Ajustes y ver el frontmatter regenerado; un compañero nuevo cita una lección añadida desde el panel; Redacción entrega un plan aprobado en más de una ronda y el panel lo muestra; un redactor no puede escribir en `redaccion/.fuentes/`; Mantenimiento crea e instala una skill con confirmación; capturas de la oficina 3D con y sin assets y de la 2D con `?view=2d`.

## Fuera de alcance
- Retargeting de animaciones entre esqueletos distintos.
- Memoria nativa (`memory:`) de agentes.
- Herramientas de tareas: la puerta sigue en `HECHO:`.
- Edición de planes o skills desde el panel.

## Cambios respecto a la primera versión de este plan
- Puerta de departamentos por mtime del documento, no por eventos de herramienta; mensajes con la ruta como primer token.
- Puntos `bloqueante:`/`menor:`, aprobación sin bloqueantes, `SIN ACUERDO:` en la última ronda, revisor nuevo por ronda y modelos distintos por defecto para redactor y revisor.
- El hub commitea cada ronda.
- Guardia de permisos para `--add-dir` y listas `tools:` sin Bash para redactor y revisores; el revisor de skills revisa scripts y el jefe comprueba nombres.
- Resolución del rol por cadena de fuentes, probada con lanzamientos en paralelo; tope de caracteres en la inyección, resúmenes de informes, duplicados y poda definidos, tope de lecciones por sesión; los jefes no nombran modelo al lanzar.
- PixiJS se mantiene con `?view=2d` hasta la paridad; assets commiteados si son CC0 en vez de script de descarga.
- Esquema v2 descarta los datos de `test_runs`; spike 4 cubre el choque entre `--model` y `model:`.

## Cambios de la tercera revisión
- Planes y skills viven en un repo aparte, `office-docs`, y el hub commitea con `--only` para no arrastrar staging ni tocar la rama de desarrollo.
- Nombres únicos por encargo: `redactor-<slug>`, `revisor-planes-<slug>-rN`, `artesano-<nombre>`, `revisor-skills-<nombre>-rN`.
- La referencia de cambio de una skill es el mtime más reciente de toda su carpeta.
- La guardia de Bash queda documentada como parcial; red de seguridad con `git status` de las plantas antes y después de cada agente de departamento.
- Los lanzadores de departamentos comprueban `/health` y no arrancan sin hub.
- Desde v2 las migraciones son aditivas; v1 → v2 es la única destructiva.
- La fase 3 termina con un punto de decisión sobre invertir los modelos de redactor y revisor.

## Cambios de la cuarta revisión
- La red de seguridad compara huellas de contenido (`git hash-object`, o mtime y tamaño), descarta los cambios atribuibles a Edit y Write de agentes de la planta y distingue alerta de posible según hubiera agentes de la planta activos.
- El mtime de una skill es el máximo de sus ficheros, recorrido recursivo, nunca el de la carpeta.
- `documents.ts` solo reconoce carpetas con `SKILL.md` e ignora las de trabajo de `skill-creator`; la instalación copia solo la carpeta de la skill. El spike 1b comprueba qué deja `skill-creator` en disco.

## Cambios de la quinta revisión
- Redacción lee fotos de la rama base de cada planta en worktrees desacoplados bajo `redaccion/.fuentes/<slug>/`, creados por el hub con `fetch` (nunca `pull` ni `checkout`); el jefe de Redacción deja de llevar `--add-dir` y el riesgo de `--add-dir` queda solo en Mantenimiento. Base y cambios desde el último plan van al brief; la foto es fija durante las rondas; tras `APROBADO:` se avisa si la rama avanzó; al cerrar se retiran los worktrees.
- Spike 3 pasa a comprobar el `fetch` sin intervención desde el hub en segundo plano y el tiempo de crear el worktree de mobile.
- Las huellas usan `git status --porcelain --untracked-files=all`.
- Fase 3 crece medio día.

## Cambios de la sexta revisión
- Los worktrees de un plan solo se retiran con `HECHO:`, al descartar el plan desde el panel o por `retentionDays` sin actividad; un `BLOQUEADO:` conserva la foto para la ronda siguiente.
- Al arrancar, el hub retira los worktrees huérfanos de `.fuentes/` y hace `prune` en cada planta.
- El `fetch` tras `APROBADO:` y las huellas al terminar un agente de departamento se ejecutan fuera del hook; Entregables se actualiza cuando terminan.
- La prueba en vivo de la guardia pasa a ser que el redactor no escribe en `.fuentes/`.
- La foto no incluye lo ignorado por git (código generado de Flutter, dependencias de `pub`); la plantilla del redactor lo advierte.
