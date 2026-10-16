# Personajes de la oficina 3D

La vista 3D (`?view=3d`) pinta a cada agente con un personaje animado. Los modelos viven en `ui/public/assets/characters/` y `manifest.json` dice qué modelo lleva cada rol y qué clip corresponde a cada gesto.

## Pack incluido

`quaternius/` trae once personajes del pack **Ultimate Modular Men** de Quaternius, con licencia CC0 (dominio público; ver `quaternius/LICENSE.txt`). Todos comparten el mismo esqueleto de 62 huesos y las mismas 24 animaciones, entre ellas `Idle`, `Idle_Neutral`, `Walk`, `Run`, `Wave`, `Interact`, `HitRecieve` y `Death`. El pack no trae animaciones de sentarse ni de teclear: la oficina usa mesas altas y mueve los antebrazos por código para teclear.

| Rol | Modelo |
|---|---|
| Director | `business-man.glb` |
| Jefes | `casual.glb` |
| Desarrolladores | `hoodie.glb`, con el color de la sudadera distinto por agente |
| Testers | `worker.glb` |
| Revisores de código | `punk.glb` |
| Redactores | `adventurer.glb` |
| Revisores de planes | `adventurer.glb` con otros colores |
| Artesanos de skills | `farmer.glb` |
| Revisores de skills | `swat.glb` |
| Becarios (subagentes sin rol) | `beach.glb` |

Para cambiar la asignación, edita `roles` en `manifest.json`. Si un modelo no carga, la oficina dibuja un maniquí y sigue funcionando.

## Personajes propios con Mixamo

Si dejas en `custom/` un fichero `<rol>.glb`, la oficina lo usa para ese rol en lugar del pack. `<rol>` es el tipo de rol de la interfaz: `director`, `lead`, `dev`, `tester`, `reviewer`, `writer`, `planReviewer`, `skillwright`, `skillReviewer` o `intern`.

El GLB tiene que traer estos clips, con estos nombres: `idle`, `walk`, `sit`, `type`, `talk`, `wave` y `think`. Con `sit` y `type` el personaje trabaja sentado.

1. Entra en <https://www.mixamo.com> con una cuenta de Adobe.
2. Elige un personaje y descárgalo en **FBX Binary**, **With Skin**, en T-pose.
3. Con ese personaje seleccionado, descarga cada animación en **FBX Binary**, **Without Skin**, 30 fps. Sirven, por ejemplo: Idle, Walking, Sitting, Typing, Talking, Waving y Thinking. Para Walking marca **In Place**.
4. Convierte todo a un GLB con Blender 3.6 o superior:

   ```sh
   blender -b -P tools/fbx2glb.py -- personaje.fbx ui/public/assets/characters/custom/dev.glb \
     idle=Idle.fbx walk=Walking.fbx sit=Sitting.fbx type=Typing.fbx talk=Talking.fbx wave=Waving.fbx think=Thinking.fbx
   ```

5. Recarga la oficina con `?view=3d`.

Los personajes y animaciones de Mixamo se pueden usar en tus proyectos, pero no redistribuir como pack. Por eso `custom/` está en `.gitignore`: cada persona descarga los suyos.

## Comprobar la licencia del pack

El pack se descargó el 2026-10-16 de poly.pizza, que lo publica como CC0, igual que la página del pack en quaternius.com. Si Quaternius cambia la licencia de una versión nueva, conserva estos ficheros o revisa la licencia nueva antes de sustituirlos.
