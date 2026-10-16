# Agent Office: reglas para trabajar en este repositorio

Este repositorio es la propia oficina. De aquí salen el hub, los hooks que se ejecutan en todas las sesiones de Claude Code del usuario y las plantillas de todos los agentes. Un error aquí puede bloquear todas sus sesiones, también las de la oficina. Estas reglas valen para cualquiera que trabaje en este código, y sobre todo para los agentes de la oficina cuando la oficina trabaja sobre sí misma.

El director de la oficina arranca en `workspace/` de esta copia y no edita ni ejecuta nada: estas reglas no le impiden repartir encargos.

## Prohibido

1. **Editar, compilar o ejecutar nada en la copia de la que corre la oficina.** Es la carpeta registrada como marketplace `agent-office` en `~/.claude/settings.json` (`extraKnownMarketplaces.agent-office.source.path`; en este equipo, `~/Projects/agent-office`). Antes de tocar nada, compara `git rev-parse --show-toplevel` con esa ruta. Si coinciden, para y pide al usuario que el trabajo se haga en un clon. Los hooks se leen en vivo: un error en `plugin/hooks/` o en `hooks.json` afectaría al momento a todas sus sesiones. Un `bun run build` aquí cambiaría la interfaz que está usando.
2. **Trabajar en un worktree de esta copia en vez de en un clon.** La oficina asigna los worktrees a la planta de la copia principal, así que el trabajo aparecería en el sitio equivocado.
3. **Ejecutar los comandos que administran la oficina real:** `bun run setup`, `bun run floor …`, `bun run hub`, `bun run office`, `bun run dev:hub`, `bun run rotate-key`, `sh ~/.config/agent-office/office.sh`, ni los scripts de `hub/src` directamente (`main.ts`, `setup.ts`, `floor-cli.ts`). Usan la configuración real de `~/.config/agent-office` (key, base de datos y plantas), escriben en `~/.claude/agents` y ocupan el puerto 4747 del hub en marcha.
4. **Tocar** `~/.config/agent-office`, `~/.claude/agents`, `~/.claude/settings.json`, `~/Projects/office-docs` ni los repositorios de otras plantas.
5. **Hacer push, merge o cambiar de rama** fuera de la rama de tu encargo. El usuario revisa los cambios y los trae a la copia en vivo.

## Permitido

- `bun run test` (tests del hub, que trabajan en carpetas temporales), `bun run typecheck` y `bun run build` en el clon.
- Si hace falta un hub para probar algo, arráncalo solo con `AGENT_OFFICE_HOME` y `AGENT_OFFICE_CLAUDE_HOME` apuntando a carpetas temporales, con un `config.json` propio en otro puerto. Nunca sin esas dos variables.

## Cómo se prepara el clon

Lo hace el usuario, en su terminal y desde la copia en vivo:

```sh
git clone ~/Projects/agent-office ~/Projects/agent-office-dev
cd ~/Projects/agent-office-dev && bun install
cd ~/Projects/agent-office && bun run floor add ~/Projects/agent-office-dev
```

Los cambios vuelven, tras revisarlos, con `git -C ~/Projects/agent-office pull ~/Projects/agent-office-dev <rama>`.

## Cómo se hace cumplir

`.claude/settings.json` deniega en Claude Code los comandos de la regla 3 y las escrituras de la regla 4, en esta copia y en cualquier clon. Las reglas 1, 2 y 5 dependen de que leas este fichero.
