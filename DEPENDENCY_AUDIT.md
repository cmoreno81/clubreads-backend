# Auditoría de dependencias — 2026-08-09

## Estado inicial

`npm audit --omit=dev` encontró 6 vulnerabilidades de producción:

- 1 alta: `fast-uri` 3.1.3.
- 5 moderadas: `hono` 4.12.28, `@hono/node-server` 1.19.11,
  `valibot` 1.2.0, `@prisma/dev` 0.24.3 y `prisma` 7.8.0.

La cadena comprobada con `npm explain` era:

- `prisma` → `@prisma/dev` → `@prisma/streams-local` → `ajv` →
  `fast-uri`.
- `prisma` → `@prisma/dev` → `hono`, `@hono/node-server` y `valibot`.

## Actualización aplicada

Se actualizaron conjuntamente los tres paquetes Prisma desde 7.8.0 hasta la
versión estable 7.9.1:

- `prisma` 7.9.1.
- `@prisma/client` 7.9.1.
- `@prisma/adapter-pg` 7.9.1.

No se utilizó `npm audit fix` ni `--force`.

## Estado posterior

`npm audit --omit=dev` informa 0 vulnerabilidades de producción. La nueva
cadena contiene `fast-uri` 3.1.5 y `valibot` 1.4.2; `hono` y
`@hono/node-server` ya no están instalados. Prisma Client se regeneró con la
versión 7.9.1.

`prisma validate` confirma que el esquema es válido. `prisma migrate status`
se repitió con una URL explícita al PostgreSQL local de `docker-compose.yml`,
pero no llegó a obtener el estado debido a un error del motor de esquema. No se
aplicó ni generó ninguna migración y el comando no propuso cambios destructivos.

La compilación y la selección de pruebas de autenticación y servicios Prisma
terminaron con 100 pruebas aprobadas, 5 omitidas y 0 fallos. La suite completa
terminó con 134 aprobadas, 5 omitidas y los mismos 4 fallos preexistentes de
logros y Clubvisión observados antes de esta actualización.

Fuera del alcance de `--omit=dev`, la auditoría completa conserva 1 aviso alto
en `brace-expansion`, introducido únicamente por `nodemon` y `ts-node-dev`. No
se forzó una actualización ni un override transitivo; debe tratarse por separado
como actualización de herramientas de desarrollo.
