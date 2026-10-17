# Agent Office

Oficina visual para los agentes de Claude Code. Cada repositorio es una planta; en ella se ve quién trabaja, quién pregunta, quién está bloqueado y quién pasa los tests. Un director reparte el trabajo entre los jefes de planta, cada jefe dirige su equipo (desarrollador, tester, revisor) y desde el panel puedes contestar preguntas y dar órdenes.

Dos departamentos completan la oficina: **Redacción** escribe planes que un revisor nuevo devuelve ronda a ronda hasta aprobarlos, y **Mantenimiento**, en un edificio anexo, crea skills de Claude Code y las instala donde decidas. Cada rol tiene su modelo y su esfuerzo, elegidos en la pestaña Ajustes, y cada agente tiene un informe de lo que ha hecho y una memoria de lecciones que hereda quien ocupe su puesto.

Diseños aprobados: [v1](docs/plan.md) y [v2](docs/plan-v2.md). Resultados de los spikes: [docs/spikes.md](docs/spikes.md). Personajes 3D: [docs/assets.md](docs/assets.md).

## Requisitos

- [Bun](https://bun.sh) 1.4 o superior (`brew install oven-sh/bun/bun`).
- Claude Code 2.1.290 o superior en la terminal (`brew upgrade --cask claude-code`). Con versiones anteriores funciona la observación, pero `TaskCreated`, `TaskCompleted` y `TeammateIdle` llegan sin `agent_id`.
- `git` y `curl`. Para abrir las sesiones: tmux si está instalado; si no, Terminal de macOS.

## Puesta en marcha

```sh
bun install
bun run setup      # key, configuración, plugin y plantas
bun run build      # compila la interfaz en hub/public
bun run office     # hub + oficina en el navegador + sesiones del director, los jefes y los departamentos
bun run panel      # vuelve a abrir el panel (--print solo imprime el enlace)
```

`bun run setup` pregunta antes de cada paso con efecto fuera del repositorio:

- Crea `~/.config/agent-office/` con la key y el fichero de cabeceras `headers` (permisos 600), `config.json` y el puerto.
- Registra este repositorio como marketplace local e instala el plugin `office` a nivel de usuario. Sus hooks se ejecutan en todas tus sesiones de Claude Code; si el hub no está arrancado, salen al momento sin escribir nada. Un marketplace de directorio local lee el plugin en vivo: un cambio en `plugin/` vale en la siguiente sesión o tras `/reload-plugins`.
- Ofrece convertir `~/Projects/mobile` y `~/Projects/backend` en plantas gestionadas, lo que escribe tres agentes por planta en `~/.claude/agents/`.
- Crea el repositorio de documentos `~/Projects/office-docs` (`docsRepo` en `config.json`) con `redaccion/planes/`, `redaccion/historial/` y `taller/skills/`, y un primer commit.
- Escribe en `~/.claude/agents/office-*.md` todos los agentes de la oficina (director, revisor y departamentos incluidos) con el modelo y el esfuerzo de su rol. Una configuración de v1 se completa con los valores por defecto sin perder sus plantas.

Aparte de las dos entradas que escribe `claude plugin` en `~/.claude/settings.json`, el marketplace en `extraKnownMarketplaces` y el plugin en `enabledPlugins`, no toca tu configuración. Agent teams y la caché de una hora se activan solo en las sesiones que abre `office.sh`.

## Plantas

| | Observada | Gestionada |
|---|---|---|
| Cómo nace | Sola, con el primer evento de un repositorio nuevo | `bun run floor add <ruta>` |
| Qué tiene | Agentes pintados en gris, sin contenido de herramientas | Jefe de planta, equipo, puerta de tests y preguntas en el panel |

```sh
bun run floor add ~/Projects/mobile             # detecta el stack y genera office-{lead,dev,tester}-mobile
bun run floor add ~/otra/ruta/mobile --slug mobile-2
bun run floor add --all                         # regenera todos los agentes tras cambiar un perfil o una plantilla
bun run floor remove mobile                     # vuelve a observada y borra sus agentes
bun run floor list
```

También se dan de alta y se borran desde **Ajustes → Proyectos**, sin reiniciar el hub. El panel exige la carpeta raíz de un repositorio git; `bun run floor add` es más permisivo y acepta cualquier carpeta. Borrar desde el panel elimina la planta de `config.json`, sus agentes y su lanzador, todo lo que la oficina guarda de ella en `office.db` y sus fotos de Redacción; el repositorio no se toca. Se rechaza mientras haya sesiones abiertas en la planta.

Los perfiles por stack (skill, comandos de test y de revisión) están en `plugin/profiles/` y las plantillas de los agentes en `plugin/templates/`. Cada planta gestionada tiene una rama base (`baseBranch`, por defecto `develop` si existe en `origin`) que es la que lee Redacción.

## Ajustes: modelo y esfuerzo por rol y por planta

La pestaña **Ajustes** edita `config.json`: el modelo (`opus`, `sonnet`, `haiku`, `fable`, `inherit` o un id completo) y el esfuerzo (`low` a `max`) de cada rol, los departamentos activos, el número máximo de rondas de revisión, el tamaño de los planes y las lecturas de cada revisor, los topes de la memoria, los encargos por orden y los minutos hasta dar a un jefe por parado (sección Oficina; 0 desactiva cada tope) y la rama base de cada planta. Al guardar, el hub regenera los agentes de `~/.claude/agents/` y los lanzadores; vale para las sesiones y los equipos nuevos, y las sesiones abiertas siguen igual hasta que las reinicias con `bun run office`.

| Rol | Por defecto | Por qué |
|---|---|---|
| Director | fable · xhigh | Reparte entre plantas y fija los contratos que comparten: un error se propaga a todas. Es una sola sesión larga. |
| Jefes (plantas y departamentos) | sonnet · medium | Coordinan, reparten piezas ya decididas y vigilan las puertas. |
| Desarrolladores | opus · high | Cambios en varios ficheros de código real, donde un fallo cuesta de detectar. |
| Testers | sonnet · medium | Ejecutan los tests que pide el jefe y resumen el resultado. |
| Revisores de código | opus · high | Buscan fallos y problemas de seguridad que se escaparían. |
| Redactores | opus · high | Diseñan el plan, que es la decisión de la que depende todo lo demás. |
| Revisores de planes | sonnet · medium | Otro modelo que el redactor, sin contexto previo: gastan lo mismo por turno que Opus y su veredicto no fue peor. |
| Artesanos de skills | sonnet · medium | Siguen `skill-creator` sobre un brief cerrado. |
| Revisores de skills | opus · high | Revisan scripts que se instalarán en tus sesiones: es revisión de seguridad. |

El esfuerzo sigue el que tienes por modelo en `~/.claude/settings.json` (xhigh para Fable, high para Opus, medium para el resto). Fable va solo donde una mala decisión se propaga a todo lo demás: el director. Haiku no es el valor por defecto de ningún rol. Todo se puede cambiar en Ajustes.

Una configuración guardada con los valores por defecto anteriores los cambia una sola vez al arrancar (`configVersion: 3`): rondas máximas 4 → 2, caracteres de memoria 4000 → 2500, revisor de planes `opus · medium` → `sonnet · medium` y redactor `fable · xhigh` → `opus · high`. Lo que hubieras cambiado tú se queda como está.

Esa tabla son los valores por defecto (sección «Modelos por defecto»). Debajo, Ajustes tiene una sección por planta gestionada, por Redacción y por Mantenimiento con los roles de ese destino (planta: jefe, desarrollador y tester; Redacción: jefe, redactor y revisor de planes; Mantenimiento: jefe, artesano y revisor de skills). «Por defecto» hereda el valor global; al elegir un modelo o un esfuerzo se crea una anulación solo para ese destino, con el otro valor copiado, y volver a «Por defecto» la borra. En `config.json` son un mapa disperso, y lo que no está en él hereda de `roles`:

```json
"floorRoles": {
  "mobile":    { "dev": { "model": "fable", "effort": "xhigh" } },
  "redaccion": { "revisor-planes": { "model": "sonnet", "effort": "medium" } }
}
```

El director y el revisor de código siguen siendo globales.

Los lanzadores pasan además `--model` y `--effort` al director y a los jefes (cada jefe con el de su planta o departamento), y los jefes no nombran modelo al lanzar compañeros: manda el agente generado.

## Encargos, carpetas y comprobaciones

Cada encargo de una planta gestionada **con carpetas por encargo** es una **tarjeta del Tablero** con su propia rama y su propia carpeta. Es un interruptor por planta, **desactivado por defecto**: se activa en Ajustes → Proyectos («Carpetas y comprobaciones por encargo») o con `"delivery": true` en la planta de `config.json`, y las plantas que no lo activan siguen trabajando como antes del Tablero (sin tarjeta, sin carpeta, con la puerta del tester). El flujo:

1. Nace una tarjeta cuando el director manda un `ENCARGO: <título corto> — <qué> — criterios — fuera` a `lead-<planta>` y el tope de encargos lo deja pasar, cuando ejecutas un plan (una tarjeta pendiente por planta, que adopta el `ENCARGO:` de esa planta) o desde **Nuevo encargo** (directo al jefe o a través del director). El título es lo que hay antes del primer « — ».
2. El hub crea la carpeta `<planta>/.claude/worktrees/office-<slug>` con la rama `encargo/<slug>` a partir de `origin/<base>` (tras un `fetch`; si falla, de la rama local y con la marca «base sin actualizar»), prepara las dependencias y manda al jefe `[Agent Office] CARPETA: encargo/<slug> → <ruta> (base …; dependencias: …)`. El jefe entra con `EnterWorktree` antes de lanzar a nadie; sus compañeros nacen ya dentro. Nadie cambia de rama ni hace commit: los puntos de control los hace el hub.
3. La tarjeta pasa a **En curso** con el primer evento dentro de la carpeta. Cuando el desarrollador dice `listo` en el chat, el hub guarda un punto de control y ejecuta las comprobaciones de la planta 20 segundos después; el jefe recibe `COMPROBACIONES encargo/<slug> en verde @<sha>` o el primer rojo con las últimas líneas de su salida. También puede pedirlas con `plugin/scripts/office-encargo.sh comprobar`, o tú desde el cajón de la tarjeta.
4. El `HECHO: encargo/<slug> — …` del jefe pasa la puerta si hay una ejecución en verde sobre el `HEAD` actual y nada sin comprobar; si no, no sale, el hub lanza lo que falte y el jefe repite el `HECHO:` cuando llega el aviso. Un `HECHO:` aceptado lleva la tarjeta a **Hecho** y **crea el aviso de fin**.

Cualquier salida de Hecho (la flecha ← de la tarjeta) la reabre como En curso y empieza un ciclo nuevo; el aviso de fin es uno por encargo y ciclo (o por plan, cuando termina la última de sus tarjetas), y un `HECHO:` repetido en el mismo ciclo no crea otro. Mover a Hecho a mano crea el aviso marcado «a mano»; con las comprobaciones en rojo pide confirmación.

- **Aviso de finalización.** Un popup que no se cierra solo, con el título, la planta, la rama, el resumen del `HECHO:`, las comprobaciones y la PR si existe; si llegan varios se encolan («1 de 3») y sobreviven a una recarga hasta que los cierras. En Ajustes → Avisos de escritorio eliges ventana, aviso de escritorio o ambos.
- **Comprobaciones por planta.** Por defecto las del stack: flutter `flutter analyze` y `flutter test`; node los scripts `test`, `typecheck` y `lint` de `package.json` con el gestor de su lockfile; laravel `php artisan test` y `vendor/bin/pint --test`; el stack genérico ninguna. Ajustes → Proyectos → *Entrega* cambia las comprobaciones (hasta 8, un comando por línea de 300 caracteres), la preparación de la carpeta (`flutter pub get`, `<gestor> install`, `composer install`), las carpetas que se enlazan en vez de reinstalar y la **puerta**: *comprobaciones* (por defecto si hay alguna), *comprobaciones y tester* o *solo tester* (la puerta de siempre, por defecto si no hay comprobaciones). Los comandos los ejecuta el hub con `/bin/sh -c` en la carpeta del encargo, con `CI=1`, en su propio grupo de procesos (el tiempo máximo —`checksConfig.timeoutMinutes`, 15— y Cancelar matan todo el árbol), con tope de comprobaciones a la vez (`maxParallel`, 2) y guardando el final de la salida (`tailBytes`).
- **Si el encargo cambia cómo se comprueba** (`tsconfig*.json`, `vitest.config.*`, `eslint.config.*`, los `scripts` de `package.json` o `composer.json`, `analysis_options.yaml`, `phpunit.xml*`…, más los `checkFiles` de la planta; nunca los lockfiles ni `pubspec.yaml`), el `HECHO:` espera a que lo confirmes en el cajón de la tarjeta (vale solo para ese `HEAD`) y el aviso lo señala.
- **Puntos de control.** Antes de cada ejecución el hub hace `git add` de los ficheros del `status` y un commit `encargo(<slug>): …` en la rama del encargo. Los ficheros de más de `checkpoints.maxFileKb` (1 024 KB) o que casen `checkpoints.skipGlobs` (`*.log`, `*.dump`, `*.sqlite`, capturas) se dejan fuera, se avisa y no bloquean la puerta mientras no cambien. Si un hook de commit falla, las comprobaciones corren sobre `HEAD-dirty` y no valen para el `HECHO:`. El cajón de la tarjeta lista los puntos en la pestaña Puntos.
- **Carpetas.** Se crean con la marca del hub en el directorio de administración de git, `/.claude/worktrees/` en `info/exclude` y los ficheros literales de `.worktreeinclude` que `git check-ignore` confirme. Un tope de `worktrees.maxActivePerFloor` (4) abiertas por planta; al arrancar se retiran las carpetas del hub sin tarjeta y limpias (las sucias y las ajenas solo se avisan); cada día se retiran las de encargos hechos y fusionados, o descartados, pasados `worktrees.retentionDays` (3) si están limpias, y los **hechos sin fusionar** quedan «pendientes de decidir» en Ajustes → Proyectos (Borrar o Conservar) con un aviso diario. Todas cuentan para el aviso de tamaño total (`worktrees.warnTotalGb`, 20). Borrar una planta con carpetas sucias pide confirmación.
- **Herramientas que recorren `.claude/worktrees/**` desde la copia principal** (jest, `flutter analyze`…) verán las carpetas de los encargos: excluye esa ruta en su configuración.
- Por ahora no hay diff, comentarios, PR ni fusión desde el panel: la revisión del resultado sigue haciéndose en la rama del encargo.

## Departamentos

**Redacción** (`lead-redaccion`, en `office-docs/redaccion`):

1. El director o tú le encargáis un plan. El jefe prepara las fuentes con `plugin/scripts/office-sync.sh <slug> <planta>…`: el hub hace `git fetch` de la rama base de cada planta y crea un worktree desacoplado en `redaccion/.fuentes/<slug>/<planta>/`. Nunca hace `pull` ni `checkout` en tu copia de trabajo. El hub deja en `redaccion/.fuentes/<slug>/.office` su id (`~/.config/agent-office/id`) y al arrancar solo retira fotos con su id; las de otro hub o sin marcador las deja y lo avisa en la actividad.
2. El redactor escribe `redaccion/planes/<slug>.md` y lleva el historial de rondas aparte, en `redaccion/historial/<slug>.md`. Pide `REVISAR:` a su jefe. Un revisor nuevo por ronda, que solo lee el plan y las fuentes (ni brief, ni historial, ni lecciones), contesta `MEJORAR:` con 6 puntos como mucho, `bloqueante:` o `menor:`, `APROBADO:` en una línea cuando no quedan bloqueantes o `SIN ACUERDO:` en la última ronda. Las rondas no pasan de `review.maxRounds` (2): la puerta de `REVISAR:` bloquea la siguiente y un `SIN ACUERDO:` ya no abre otras; para seguir, decides tú y subes «Rondas máximas» en Ajustes.
3. **Longitud**: un plan ocupa como mucho `review.maxPlanBytes` (20 000 bytes) si es de una planta, la mitad más por cada planta de su foto hasta el doble, y el doble si es un análisis. La puerta de `REVISAR:` rechaza uno más largo con su tamaño en KB, sin abrir ronda ni hacer commit; el redactor lo mide antes y lo condensa. Si el trabajo tiene fases que se ejecutan por separado, el redactor pide `PARTIR: <ruta> — fases: …`: el hub solo lo anota en la actividad, el jefe te pregunta y, si aceptas, abre un encargo por fase (`<padre>-fase-N`) y mueve el plan padre a `redaccion/historial/<padre>.partido.md`, con lo que sale de **Planes** y su foto se retira en la siguiente limpieza.
4. Cada revisor da **un solo veredicto**: cuenta el primero que manda al redactor (la copia al jefe no), los siguientes se ignoran con una nota y el revisor se retira en cuanto lo emite, aunque luego lo despierten. Por eso ves un revisor por ronda (r1, r2…) y ninguno vuelve. Lee el plan una vez y comprueba como mucho 8 afirmaciones; tras `review.maxReviewerReads` (30) lecturas (`Read`, `Grep`, `Glob` o `Bash`) el hub le deniega la siguiente y le pide el veredicto con lo leído, y un revisor retirado ya no puede leer. La denegación viaja en la respuesta de `/hook` al `PreToolUse` que `office-hook.sh` ya imprime, sin hook nuevo.
5. Si el redactor necesita una decisión tuya, escribe `PREGUNTA: … — opciones: …` a su jefe, que te la hace con `AskUserQuestion` (sale en el panel) y le devuelve la respuesta. Mientras, el redactor aparece preguntando.
6. El hub hace un commit del plan y de su historial en `office-docs` en cada ronda, con `git commit --only` para no arrastrar lo que tengas preparado.
7. El `HECHO:` del redactor y el del jefe solo salen si hay un `APROBADO:` de esa ruta posterior al último cambio del fichero. Antes del `HECHO:` al director, el jefe avisa con `PLAN: <ruta> — <resumen>` al jefe de cada planta implicada, que lo lee (los jefes de planta se abren con `--add-dir` de `redaccion/planes`, sin permiso de escritura) y espera. Tras la aprobación el hub avisa si la rama base ha avanzado.
8. El `HECHO:` del jefe **entrega** el plan: el hub retira los worktrees, guarda las plantas y su base, y el plan queda en la pestaña **Planes** pendiente de tu decisión: **Ejecutar** manda al director la orden de repartirlo entre los jefes, **Aparcar** lo deja para más tarde (también deshace un Ejecutar; el hub no avisa al director), **Cerrar** cuando el director te confirma que las plantas terminaron, y **Descartar** y **Descargar** el `.md`. Al descartar, un aviso de 10 segundos ofrece **Deshacer**: el hub retira las fuentes del plan pasado ese plazo, y restaurarlo quita la marca del `.md` y lo deja como estaba. Si el documento es un análisis (`> Tipo: análisis` bajo el título), el botón es **Encargar planes…**: el director te pregunta qué planes encargar a Redacción y en qué orden antes de encargar nada.

**Mantenimiento** (`lead-mantenimiento`, en `office-docs/taller`, edificio anexo):

1. El jefe comprueba que el nombre de la skill está libre y lanza un artesano, que la escribe con la skill `skill-creator` en `taller/skills/<nombre>/`.
2. Mismo bucle de rondas con un revisor de skills, que además lee los scripts incluidos, también da un solo veredicto y tiene el mismo tope de lecturas.
3. Con la aprobación, el jefe te pregunta dónde instalarla (`~/.claude/skills/<nombre>` o `.claude/skills/<nombre>` de una planta) y copia solo esa carpeta.

Los lanzadores de los departamentos comprueban `GET /health` y no abren la sesión sin hub, porque sin hub no hay guardia.

## Memoria e informes

- Un agente que aprende algo envía `LECCIÓN: …` a su jefe. El hub la guarda para la pareja planta y rol, sin duplicados y con tope por sesión, y poda las más antiguas de origen agente; las que añades desde el panel no se podan.
- Al arrancar, cada agente de la oficina recibe por hook las lecciones de su puesto y una línea de cada uno de los tres últimos informes, como contexto y con un tope de caracteres. El revisor de planes es la excepción: no recibe memoria ni guarda informe. Los revisores de planes y de skills no escriben `LECCIÓN:`, y si alguno llega el hub lo descarta en silencio.
- El panel muestra el **Informe** del agente seleccionado (ficheros, tests, veredictos, mensajes, preguntas, bloqueos, lecciones y cierre) y la **Memoria** de su puesto, donde puedes añadir y borrar lecciones.

## Uso

- La oficina vive en <http://127.0.0.1:4747> y se abre con `bun run panel` (o `bun run office`), que da un enlace de un solo uso. Pestañas **Oficina**, **Tabla**, **Tablero**, **Planes**, **Chat** y **Ajustes**; el panel de la derecha muestra el agente seleccionado. La oficina 3D está en <http://127.0.0.1:4747/?view=3d>; la 2D (PixiJS) sigue siendo la vista por defecto hasta que la 3D esté a la par.
- **Idioma**: el selector de la cabecera cambia todo el panel entre español e inglés al momento. La elección se guarda en el navegador (`localStorage`); sin elegir, el panel sale en español. Los textos del hub (actividad, detalle de cada agente, pregunta de permiso, informes, notas y errores de Ajustes y de la API) siguen el idioma del panel y cambian sin reiniciar el hub; los mensajes de los agentes, sus preguntas y los títulos de documentos se muestran como los escribieron. Los informes guardados antes de este cambio también se traducen cuando su resumen lo escribió el hub.
- **Ayuda**: la Tabla tiene una leyenda desplegable con las columnas, los estados, los chips, los estados de los documentos y las alertas, y recuerda si la cierras. En Ajustes, cada rol, el bloque de modelos y esfuerzos, cada destino de permisos, cada planta y cada dato del hub llevan una línea que explica para qué sirven.
- **Panel**: arriba, una lista plegable por planta con cada agente en orden de equipo: color de su estado, rol, una frase corta de lo que hace («Editando office.ts», «Pasando tests (bun test)», «Hablando con lead-mobile», «Esperando encargo») y el tiempo en ese estado. Se abre la planta del seleccionado. Los que se fueron a casa o terminaron quedan al final, bajo «Fuera de la oficina», atenuados y seleccionables para ver su informe. Del seleccionado se ve primero la tarjeta **Ahora** (estado, qué hace, herramienta, fichero, último test, su encargo y sus últimos cinco pasos); después pregunta, entregables, informe, memoria y la línea de tiempo plegada.
- **A casa**: un compañero de equipo libre durante `leaveAfterMinutes` (5 por defecto; Ajustes, sección Oficina) sale del edificio salvo que su jefe esté trabajando, y un agente terminado sale en cuanto termina, tras saludar. En la 3D baja en ascensor hasta la acera (desde el anexo, por la escalera y el pasillo); en la 2D sale por el ascensor de la planta de abajo hacia la derecha. Su mesa queda libre, y cuando vuelve a recibir trabajo entra andando desde la calle. El hub olvida a los terminados a los 10 minutos y entonces desaparecen del panel; su informe sigue en la memoria del puesto.
- **Entregables**: al seleccionar un agente de Redacción o Mantenimiento, el panel lista sus planes o skills con estado, ronda, nota, base y avance de la rama, los abre en un visor de markdown y los descarga.
- **Planes**: los planes por estado (pendientes de decisión, aparcados, en ejecución, en redacción, cerrados y descartados), con su contador en la pestaña y los botones Ver, Ejecutar, Aparcar, Cerrar, Descartar y Descargar según el estado. La descarga se hace en el navegador, sin poner la key en ninguna URL.
- **Preguntas**: con la oficina abierta en el navegador, aunque la pestaña esté tapada por otra ventana, las `AskUserQuestion` de las sesiones de la oficina esperan en el panel hasta una hora en vez de salir en la terminal. "Devolver al terminal" las suelta al momento. Sin ningún panel abierto salen en la terminal como siempre, y si cierras la última pestaña las que esperaban vuelven a la terminal a los 30 segundos.
- **Órdenes**: el cuadro de órdenes escribe en el inbox de la sesión elegida (por defecto el director). Llegan con el prefijo `[Agent Office]`. Solo llegan a sesiones de la oficina; las tuyas no salen en el selector, ni tienen Pedir estado o Relanzar.
- **Puerta de tests**: en una planta con tarjetas del Tablero la puerta mira las comprobaciones del hub (ver «Encargos, carpetas y comprobaciones»); en el resto, y en `gateMode: tester`, es la de siempre. El jefe de planta avisa al director con un mensaje que empieza por `HECHO:`. Si el desarrollador cambió ficheros (con Edit, con Bash o según la huella `git status` de su turno; los ignorados por `.gitignore` no cuentan) y no hay tests en verde de un tester de la planta posteriores, el mensaje no sale y el jefe recibe el motivo con los ficheros. El verde se decide por el resultado (código de salida y resumen del ejecutor), no por el texto del comando, y un `|| true` no cuenta. Con herramientas de tareas, completar una tarea pasa por la misma comprobación.
- **Permisos**: con la oficina abierta en el navegador, las peticiones de permiso de las sesiones de la oficina también salen en el panel, con Permitir, Denegar y Devolver al terminal. La terminal sigue mostrando el diálogo: vale la primera respuesta.
- **Modo de permisos**: en Ajustes eliges con qué modo se abre cada sesión: el director, cada planta y cada departamento. Los modos son automático, manual, aceptar ediciones, plan o no preguntar, y su equipo lo hereda.
- **Avisos de escritorio**: en Ajustes → Avisos de escritorio, el panel avisa en macOS de permisos y preguntas pendientes, `BLOQUEADO:`, entregas `HECHO:` de los jefes, planes y skills aprobados o sin acuerdo, planes pendientes de decisión en **Planes**, alertas de la guardia y el límite de uso al 80 % y al 95 %, aunque esté oculto o en otro escritorio. Un clic en el aviso trae el panel y selecciona al agente o abre el documento; cada evento avisa una vez y no se avisa si el panel está delante. Los avisos solo llevan un título corto (el agente, la herramienta del permiso o el título del documento): el comando, la pregunta y el texto de un `BLOQUEADO:` o un `HECHO:` solo se ven en el panel, para que no salgan en la pantalla bloqueada ni en el Centro de notificaciones. Vienen apagados; la preferencia y el permiso son de cada navegador. "Probar" comprueba que macOS los muestra (Concentración y los permisos del navegador en Ajustes del Sistema pueden ocultarlos). Sin ningún panel abierto no hay avisos.
- **Bloqueos**: un agente que envía `BLOQUEADO: <qué falta> — necesito <qué> de <quién>` se pinta bloqueado hasta que vuelve a trabajar. Una pregunta sin respuesta durante 5 minutos también.
- **Límite de uso**: la tarjeta «Límite de uso» muestra el porcentaje gastado de la ventana de 5 horas y de la semanal con la cuenta atrás hasta su reinicio: bajo el botón «Edificio» en la 3D y arriba a la izquierda en la 2D. Los datos salen de la entrada JSON de la línea de estado de Claude Code (`rate_limits`): las sesiones de la oficina arrancan con una línea de estado propia (`plugin/scripts/office-statusline.sh`, cada 60 s) que la manda a `POST /usage`; la última muestra de cualquier sesión gana y el hub guarda una por ventana y minuto (porcentaje y reinicio, nada más) durante 8 días para predecir el límite. Límites: solo llega mientras haya una sesión de la oficina abierta que ya haya respondido una vez, y solo en cuentas Pro/Max (con clave de API no hay `rate_limits` y la tarjeta dice «sin datos aún»). Con la oficina parada la tarjeta atenúa la última muestra y dice de cuándo es. Esa línea de estado sustituye a la tuya solo en las sesiones de la oficina.
- **Predicción del límite**: bajo cada ventana, la tarjeta dice «se agota ~15:40 (+12 %/h)», «no se agota antes del reinicio» o «pocas muestras». Sale de un ajuste por mínimos cuadrados sobre las muestras del mismo reinicio (±90 s) de los últimos 45 minutos (5 h) o 6 horas (semana); hacen falta al menos 3 puntos repartidos en 10 minutos (2 horas en la semana) y por debajo de 0,1 %/h se da por seguro. Es una extrapolación lineal: un parón o una ráfaga la desvían. Además, con los avisos de escritorio activados, el panel avisa al llegar al 80 % y al 95 % de cada ventana, una vez por ventana (al abrir el panel, los umbrales ya pasados no avisan).
- **Contexto por agente**: cada agente vivo muestra cuánto de su ventana de contexto ocupa: una barra de 2 px bajo su fila en Plantas (verde bajo el 60 %, ámbar hasta el 80 %, roja por encima), una fila en la tarjeta **Ahora** con el porcentaje, los tokens y las compactaciones, una barra bajo la etiqueta en la 3D (se oculta lejos), una barra de 12×2 en la 2D, y la taza del café del que espera se va vaciando. Las sesiones principales lo toman de la línea de estado (`context_window`; si es de hace menos de 2 minutos manda sobre la transcripción) y los compañeros y subagentes del último turno de su transcripción (`input + cache_read + cache_create`). La ventana es de 200 K salvo que el modelo del rol lleve `[1m]`, que la línea de estado diga otra cosa o que se hayan visto más de 200 K. Una compactación es una caída de más del 40 % entre turnos, una línea `compact_boundary` de la transcripción o un `SessionStart` con origen `compact`; cuenta una sola vez y queda en la actividad («lead-mobile compactó su contexto (82 % → 6 %)»).
- **MCP de solo lectura**: las sesiones del director y de los jefes arrancan con un servidor MCP llamado `office` (`bun hub/src/mcp.ts`, por stdio y sin dependencias) con cuatro herramientas que no escriben nada: `office_state({floor?})` (plantas, agentes con su contexto, preguntas abiertas y encargos), `office_plans({status?})`, `office_usage({range?})` (consumo y ventanas del límite con su previsión) y `office_search({q, …})` (historial; dice «búsqueda no disponible» si el hub no tiene buscador). Lee la key de `~/.config/agent-office/key` (nunca va en la línea de comandos ni en la configuración) y llama a las rutas `/api/*` del hub; con el hub parado responde un error de herramienta, «El hub no responde». Los lanzadores pasan `--mcp-config` (sin `--strict-mcp-config`: tus servidores siguen cargando) y permiten las cuatro herramientas (`mcp__office__office_*`) sin preguntar; el director las lista además en su plantilla. Cambian los lanzadores y la plantilla del director: tras actualizar, ejecuta `bun run setup` para regenerarlos y relanza las sesiones abiertas (el panel las marca con «Relanzar»).
- **Te necesitan**: el botón de la cabecera cuenta lo que espera por ti y lo lista, lo más urgente primero: permisos, preguntas, agentes bloqueados, agentes parados, planes por decidir y checks por confirmar. Un agente sale una vez, bajo su motivo más urgente; los que se fueron a casa no salen. Al elegir uno se selecciona el agente, se abre su sección del panel y la cámara va a su planta. `N` y `Mayús+N` recorren la cola con un aviso («2/5 · Permiso de lead-mobile»).
- **Atajos**: las teclas sueltas no actúan mientras escribes en un campo ni con un diálogo abierto; `?` abre la lista.

  | Tecla | Acción |
  | --- | --- |
  | `Cmd/Ctrl+K` | Paleta de comandos (siempre) |
  | `1`-`6` | Pestañas, en el orden de la cabecera |
  | `N` / `Mayús+N` | Siguiente / anterior de «Te necesitan» |
  | `/` | Tabla › Historial, con el cuadro de búsqueda enfocado (en un replay, la búsqueda de la línea de tiempo) |
  | `O` | Escribir una orden |
  | `?` | Ayuda de atajos |
  | `Esc` | Cierra, por este orden, paleta, ayuda, menú y visor |

- **Paleta**: `Cmd/Ctrl+K` busca por letras sueltas, sin importar tildes, entre agentes, plantas, pestañas, planes y acciones (Responder, Pedir estado, Relanzar, Nuevo encargo, Cambiar idioma, Ver historial, Silenciar). En el replay no salen las acciones que escriben.
- **Búsqueda, Historial y replay**: el hub guarda cada línea de actividad (`activity_log`) y mantiene un índice de texto (SQLite FTS5, sin tildes ni mayúsculas, por prefijo y con hasta 8 palabras a la vez) de la actividad, los mensajes entre agentes y el chat; si la compilación de Bun no trae FTS5, busca por coincidencia simple. La sección **Línea de tiempo** del panel tiene un buscador (250 ms de retardo) sobre el agente seleccionado; en un replay filtra en el navegador lo que la grabación ya entregó. La pestaña **Tabla** tiene el conmutador **Ahora | Historial** (se recuerda): el Historial busca en toda la oficina con filtros de planta, agente, tipo (actividad, mensajes, chat, agentes) y fechas, carga más al bajar, selecciona el agente al hacer clic y **Reproducir sesión** abre `?replay=/api/replay/<sesión>&compress=1` (conserva `view=3d`). El hub reconstruye la sesión desde los eventos guardados con una `Office` en memoria, sin guardia, documentos, medidor, sincronización, chat ni git; las plantas observadas, que no guardan contenido, salen en gris con lo que sí se guarda (herramienta y fichero). Los silencios de más de 60 s duran 5 s, y una sesión de más de 20 000 eventos no se reproduce (413). Las rutas son `GET /api/search` (`q`, `floor`, `agent`, `kind`, `from`, `to`, `before`, `limit` ≤ 100) y `GET /api/replay/:sessionId`, ambas con credencial de panel. Los mensajes de plantas observadas no se indexan, y la retención (`retentionDays`) y el borrado de una planta se llevan también el índice.
- **Pizarras**: cada planta tiene una pizarra con lo que le toca: Dirección, el consumo de hoy y los límites; una planta, sus agentes y el encargo del jefe; Redacción, los planes por estado; Mantenimiento, las skills. Se repintan cada 10 s solo si se ven y han cambiado, y un clic abre la pestaña que corresponde. El consumo de hoy se pide cada minuto solo con la pestaña Oficina activa; en el replay sale «—».
- **Demo sin sesiones**: <http://127.0.0.1:4747/?replay=/replays/demo.json> (añade `&view=3d` para la 3D).

## Arquitectura

```
plugin/   plugin "office": hook único (office-hook.sh), office-sync.sh, office-chat.sh, office-encargo.sh, protocolo, perfiles y plantillas de todos los agentes
hub/      Bun + Hono + SQLite: estado de los agentes, puertas, guardia, memoria, informes, documentos y fuentes de Redacción, y el ciclo de entrega (tarjetas, carpetas, comprobaciones y puntos de control)
shared/   los textos hub.* (es y en), sin dependencias: los importan la interfaz y el hub, que nunca importa `ui/`
ui/       Vite + TypeScript: tabla, tablero, oficina 2D (PixiJS) y 3D (Three.js), panel, ajustes y replay
```

Cada evento ejecuta `plugin/hooks/office-hook.sh` una vez: un solo POST a `/hook` (`curl -m 2`, conexión en 0,3 s) en el que el hub registra el evento, aplica la guardia a las escrituras de los departamentos y la puerta a `TaskCompleted`. La key sale de `~/.config/agent-office/headers` y el socket, el token, el rol y el nombre de la sesión de un fichero 600 de la carpeta de la oficina que el hook borra al salir: nada de eso pasa por la línea de comandos. El hook imprime lo que el hub devuelve tras `pass` (la memoria de `SessionStart` y `SubagentStart`, el aviso del chat o la denegación de una lectura de un revisor por encima de su tope) y sale con código 2 y el motivo ante un `block:`; con el hub apagado sale 0. `AskUserQuestion` (`/ask`, hasta 15 minutos), `PermissionRequest` (`/permission`) y los `HECHO:` de `SendMessage` (`/gate-message`) mantienen una entrada propia con su tope de tiempo: 17 comandos en `hooks.json`.

### Seguridad

Una orden del panel acaba en una sesión con Bash, así que el hub se trata como ejecución remota de código:

- Escucha solo en `127.0.0.1` y comprueba la cabecera `Host` en todas las rutas (DNS rebinding).
- La key nunca llega al navegador. `bun run panel` (y `bun run office`) abre `/?t=<enlace>`: un enlace firmado con la key que vale 10 minutos y una sola vez. El panel lo cambia en `POST /api/panel/claim` por un token de panel (HMAC con la key, 30 días), lo guarda en el navegador y quita el enlace de la barra de direcciones. La página se sirve sin secretos y con `Referrer-Policy: no-referrer`; no hay CORS.
- Las rutas de los hooks y los scripts (`/events`, `/hook`, `/guard`, `/gate*`, `/ask`, `/permission`, `/usage`, `/chat`, `/encargo`) exigen `X-Office-Key`; `/api/*` y el WebSocket aceptan la key o un token de panel. El WebSocket comprueba `Origin` y exige la credencial en el primer mensaje antes de 1 segundo. Un token caducado o rechazado deja el panel bloqueado hasta el siguiente `bun run panel`. Las peticiones tienen tope de tamaño: 8 MB en las rutas de los hooks y del chat, 1 MB en el resto de `/api/*` (413 `hub.api.bodyTooLarge`) y 16 KB por mensaje del WebSocket. El chat identifica a quien firma por el token de su sesión (`X-Office-Token`): `--de` solo vale para la propia sesión o sus compañeros, y sin token se rechaza.
- Alcance real: protege frente a quien llega al puerto sin poder leer `~/.config/agent-office` (otros usuarios del equipo, páginas web que pasen el control de `Host`), no frente a un proceso tuyo, que sigue pudiendo ejecutar `bun run panel`.
- Key, `headers` y base de datos con permisos 600. Los scripts pasan la key con `curl -H @headers`, así que no aparece en `ps`. El hub reescribe `headers` al arrancar, y `setup` y `rotate-key` también. `bun run rotate-key` genera otra key e invalida todos los enlaces y tokens del panel; los hooks la leen de `headers` en cada evento.
- **Guardia de los departamentos.** Redacción solo escribe en `office-docs/redaccion` (nunca en `.fuentes/`) y Mantenimiento en `office-docs/taller`, salvo el jefe de Mantenimiento al instalar una skill aprobada. Con Edit y Write, cada redactor solo escribe `redaccion/planes/<slug>.md` y `redaccion/historial/<slug>.md` de su encargo, y cada artesano `taller/skills/<nombre>/`; los jefes conservan toda la carpeta y en Bash rige la carpeta del departamento. Para Edit y Write la regla es exacta. Para Bash es parcial: detecta rutas escritas en el comando, pero no `cd`, variables ni scripts que escriben por su cuenta. Como red de seguridad, el hub guarda una huella de los ficheros que `git status` lista en cada planta gestionada mientras trabaja un agente de departamento y, al acabar su turno, avisa en el panel de los cambios que no puede atribuir a un Edit o Write de la planta: **alerta** si nadie de la planta trabajaba y **posible** si alguien sí.

### Privacidad

En plantas observadas, y en tus sesiones que no son de la oficina dentro de una planta gestionada (sin rol `office-*` y sin un jefe de la oficina en su equipo), el hub guarda solo estado, herramienta, ruta, el título de la sesión y el asunto de las tareas; nunca el contenido de las herramientas, los prompts ni los mensajes, y no hay informe, memoria ni lecciones. Los eventos se borran a los 14 días (`retentionDays` en `config.json`), y también los informes sin rol. Las lecciones, los informes de la oficina y los veredictos de los documentos se conservan: desde el esquema v2 las migraciones de la base de datos solo añaden tablas o columnas.

## Probado en vivo

La v2 se probó el 2026-10-16 con Claude Code 2.1.292:
- Ajustes regenera los agentes.
- La memoria llega a compañeros lanzados en paralelo.
- La guardia bloquea al redactor fuera de su carpeta.
- Redacción entrega un plan sobre mobile en dos rondas, con commits por ronda y las fuentes retiradas al acabar.
- Mantenimiento crea una skill y la instala solo donde se le indica.

Los detalles y los hallazgos corregidos están en [docs/spikes.md](docs/spikes.md). El hub anota en `~/.config/agent-office/hub.log` (modo 600, rota a `hub.log.1` al llegar a 1 MB) cada arranque, los errores que no captura, las tareas en segundo plano que fallan, los 500 de la API y la señal que lo para. Una sesión sin socket y sin eventos durante 30 minutos (4 horas si tiene una herramienta a medias, como un build largo) se da por terminada y revive con el siguiente evento.

La v1 se probó el 2026-10-15, con Claude Code 2.1.292, en una planta de pruebas y en mobile y backend con tareas de solo lectura. Funcionaron la observación de sesiones, el equipo con desarrollador y tester, la puerta con `HECHO:` en ambos sentidos, las preguntas en el panel y su vuelta a la terminal, las órdenes desde el panel, el bloqueo y su respuesta, el encargo del director a una planta, la promoción de una planta en caliente y el hub apagado. Los detalles están en [docs/spikes.md](docs/spikes.md).

## Desarrollo

Para que la oficina trabaje sobre su propio código, sigue [CLAUDE.md](CLAUDE.md). El trabajo se hace en un clon, nunca en la copia de la que corre la oficina, y sin los comandos que administran la oficina real. El jefe de una planta que sea un clon de Agent Office se abre con esos comandos como reglas `ask` (`plugin/settings/clone-permissions.json`), y la pregunta de permiso sale en el panel para que la permitas o la deniegues. Tus sesiones normales de Claude no llevan esas reglas.

```sh
bun run test                         # tests del hub
bun run typecheck                    # hub y ui
bun run dev:hub                      # hub aceptando el origen de Vite
bun run dev:ui                       # Vite en :5173 con proxy al hub
AGENT_OFFICE_RAW=1 bun run hub       # guarda cada evento crudo en hub/test/fixtures/raw/ (no versionado)
AGENT_OFFICE_RECORD=grabacion.json bun run hub   # graba lo emitido para reproducirlo con ?replay=
```

## Cambios respecto al plan

- **Hooks `command` en vez de `http`.** Los hooks `http` funcionan (probado en 2.1.236 y 2.1.300), pero `office-hook.sh` lee la key del fichero de cabeceras `headers` (600) sin tocar el `env` de los settings, falla en silencio con el hub apagado y siempre recibe el socket y el token de mensajería.
- **Un solo hook y la key fuera de `argv`.** `emit.sh`, `gate.sh` y `guard.sh` pasaban la key y el token de mensajería como argumentos de `curl` y lanzaban hasta tres peticiones por llamada a herramienta; `office-hook.sh` hace una. Al actualizar la copia en vivo: `git pull`, reiniciar el hub (escribe `headers`) y abrir las sesiones; hasta reiniciarlo los hooks salen en silencio.
- **Sin `office.sh --dev`.** El plan suponía que el marketplace local copia el plugin a caché; la documentación dice que con `source` relativo lo lee en vivo. Cargarlo además con `--plugin-dir` duplicaría los hooks.
- **Variables por sesión.** `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, `CLAUDE_CODE_ENABLE_TODO_TOOLS`, `--teammate-mode in-process` y `subagentPromptCacheTtl` van en el lanzador de cada sesión de la oficina, no en `~/.claude/settings.json`. Activar agent teams globalmente cambia cómo delega Claude en todas tus sesiones.
- **Puerta con `HECHO:`.** En Claude Code 2.1.292 los modelos actuales no tienen `TaskCreate` ni `TaskUpdate` con ninguna de las vías documentadas, así que `TaskCompleted` no llega nunca. La puerta se comprueba en un hook `PreToolUse` sobre `SendMessage` cuando el jefe avisa con `HECHO:`.
- **Jefe sin lista `tools`.** Una lista `tools:` en el agente del jefe limitaba también a sus compañeros de equipo, y el desarrollador no podía escribir. El jefe no edita por instrucción, no por permisos.
- **tmux.** Si está instalado, `office.sh` abre las sesiones en `tmux attach -t agent-office`; si no, en ventanas de Terminal.
- **Preguntas de permisos.** El plan dejaba como opcional retener también `PermissionRequest`; está hecho, ver la entrada «Permisos» de la lista de arriba.
