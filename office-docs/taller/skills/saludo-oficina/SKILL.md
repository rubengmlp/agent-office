---
name: saludo-oficina
description: Responde con un saludo de una sola línea que nombra la carpeta del repositorio en el que se trabaja. Úsala cuando el usuario escriba "hola oficina" o una variante obvia ("Hola Oficina!", "hola, oficina"). No la uses con un "hola" a secas, "hola equipo", "abre la oficina", "saluda al usuario" ni con peticiones de código u otros saludos.
---

# saludo-oficina

Responde al saludo "hola oficina" con una sola línea que nombre la carpeta del repositorio actual.

## Qué hacer

1. Toma el directorio de trabajo actual que la sesión ya conoce y quédate con su último componente (el basename). Por ejemplo, de `/Users/ana/Projects/mi-app` sale `mi-app`.
2. Responde con una única línea, sin nada más antes ni después:

   `¡Hola, oficina! Hoy trabajamos en la carpeta <basename>.`

## Por qué así

- No ejecutes comandos ni scripts: el directorio de trabajo ya está en el contexto de la sesión, y esta skill es deliberadamente trivial.
- No uses la red.
- Una sola línea: sin listas, explicaciones ni preguntas de seguimiento.

## Cuándo no aplica

Solo se dispara con el saludo a la oficina. Un "hola" suelto, "hola equipo", "abre la oficina", "saluda al usuario" o cualquier petición de código u otro saludo se atienden de la forma habitual.
