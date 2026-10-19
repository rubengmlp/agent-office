# Instantánea del repositorio de documentos

Esta carpeta es una **instantánea** (sin historial de git) del repositorio de documentos de la oficina de su autor, tomada el 2026-10-19 en el commit que la añade a este repositorio.

## Cómo usa el hub un repositorio de documentos

El hub lee la ruta del repositorio de documentos de la clave `docsRepo` de `config.json` (por defecto `~/Projects/office-docs`). `bun run setup` lo crea si no existe, con:

- `redaccion/planes/`: planes escritos por Redacción y revisados por rondas.
- `redaccion/historial/`: el historial de rondas de cada plan.
- `taller/skills/`: skills creadas por Mantenimiento antes de instalarlas.

El hub hace un commit por ronda de revisión en ese repositorio. `redaccion/.fuentes/` (fotos de las plantas mientras se escribe un plan) no se versiona y no está aquí.

## Qué es esta carpeta (y qué no)

- Es **material de referencia y ejemplo, de solo lectura**: planes reales, su historial y una skill de ejemplo (`taller/skills/saludo-oficina`).
- **No** es el repositorio de documentos en vivo. Con la configuración por defecto, el hub no la usa para nada: no es una planta, no la resuelve como Redacción ni como Mantenimiento y los tests no la leen. Para usarla como repositorio real tendrías que copiarla fuera de este repositorio y apuntar `docsRepo` a la copia.
- Los planes citan rutas y nombres de la copia de trabajo del autor (`agent-office-dev`, `~/Projects/...`); léelos como ejemplos, no como instrucciones para tu equipo.

## Qué se dejó fuera a propósito

- El plan sobre la aplicación móvil de la empresa del autor (`flow-test-otp-incorrecto`) y su historial: citan código de tests de esa aplicación y no se comparten.
- `.git/`, `redaccion/.fuentes/` y las carpetas `.claude/` (datos de sesión).
