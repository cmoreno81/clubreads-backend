# Docker y despliegue

## Separación entre arranque y migraciones

`npm start` ejecuta únicamente `node dist/server.js`. Nunca aplica migraciones. `npm run migrate:deploy` ejecuta explícitamente `prisma migrate deploy` y debe lanzarse **una sola vez**, como paso controlado anterior al despliegue de las réplicas web.

No se debe ejecutar una migración desde el comando de inicio de Railway, un healthcheck ni cada réplica: varias instancias arrancando a la vez pueden competir y una migración fallida no debe confundirse con un reinicio de la aplicación.

## Imagen

El Dockerfile compila TypeScript y genera Prisma Client en una etapa de build. Después elimina dependencias de desarrollo y copia a la imagen final únicamente `dist`, dependencias de producción, el esquema/directorio de migraciones y la configuración Prisma. El proceso se ejecuta como el usuario no privilegiado `node` con `NODE_ENV=production`.

Se conservan `@prisma/client`, `@prisma/adapter-pg`, `pg` y `prisma`/sus motores. Los tres primeros son necesarios en runtime; el CLI y sus motores permiten usar la misma imagen para el paso controlado `npm run migrate:deploy`.

`.dockerignore` impide enviar al contexto `.env`, Git, `data/`, CSV/TSV, tests, informes, logs, artefactos y `node_modules` locales.

## Docker Compose local

Compose es exclusivamente para desarrollo local. PostgreSQL y pgAdmin publican únicamente en `127.0.0.1`; pgAdmin solo se inicia con el profile `tools`. Las contraseñas no tienen valores predeterminados y deben definirse localmente:

```bash
POSTGRES_PASSWORD='valor-local-aleatorio' \
PGADMIN_DEFAULT_PASSWORD='otro-valor-local-aleatorio' \
docker compose up -d postgres
POSTGRES_PASSWORD='valor-local-aleatorio' \
PGADMIN_DEFAULT_PASSWORD='otro-valor-local-aleatorio' \
docker compose --profile tools up -d
```

El servicio PostgreSQL incluye healthcheck. pgAdmin espera el estado saludable y ambos comparten una red interna.

## Salud y cierre

- `GET /health` confirma únicamente que el proceso HTTP responde.
- `GET /ready` ejecuta `SELECT 1`; devuelve 503 genérico si PostgreSQL no está disponible.

Ambos endpoints son públicos, tienen rate limiting por IP y no muestran versiones, configuración, URL de conexión ni trazas. SIGTERM y SIGINT dejan de aceptar conexiones, cierran conexiones HTTP inactivas, esperan como máximo 10 segundos y ejecutan `prisma.$disconnect()`.

## Railway

- Build: `npm run build` si Railway construye directamente, o construir el Dockerfile.
- Pre-deploy: `npm run migrate:deploy`, configurado como job único y revisado antes de ejecutarse.
- Start: `npm start`.
- Healthcheck: `/health` para liveness. Usar `/ready` cuando el despliegue deba esperar también a PostgreSQL.

`DATABASE_URL` y demás secretos se configuran solo como variables de Railway; nunca se incorporan a la imagen. Antes de ejecutar el pre-deploy debe existir una copia de seguridad restaurable y revisarse el plan de migración.

## Job programado de portadas

El servidor web no busca portadas ni inicia temporizadores. Tras construir la imagen, una ejecución manual o un cron de Railway puede lanzar una sola pasada acotada:

```bash
npm run covers:scheduled -- --limit 50
```

El comando termina al completar el lote, emite una única línea JSON con `examined`, `added`, `omitted`, `failures` y `durationMs`, y desconecta Prisma. Un advisory lock no bloqueante de PostgreSQL impide dos ejecuciones simultáneas; si otra está activa, el segundo job termina correctamente con `skipped: true` y `reason: "LOCKED"`.

Configuración propuesta para Railway, sin crearla todavía:

- servicio Cron basado en la misma imagen del backend;
- comando `npm run covers:scheduled -- --limit 50`;
- expresión semanal `0 4 * * 1` (lunes a las 04:00 UTC);
- las mismas variables `DATABASE_URL` y `GOOGLE_BOOKS_API_KEY`, sin start command web ni pre-deploy de migraciones.

Con `limit=50`, cada ejecución hace una consulta para seleccionar el lote, hasta 50 actualizaciones condicionadas y dos consultas de advisory lock. Cada libro puede generar normalmente 1–2 solicitudes y, en el peor caso, hasta 4 intentos externos: Google por ISBN, Google por título/autora, comprobación de portada Open Library por ISBN y búsqueda Open Library. El coste máximo aproximado es por tanto 53 consultas PostgreSQL y 200 llamadas HTTP; suele ser sensiblemente menor porque una coincidencia temprana evita los proveedores posteriores. Los resultados de proveedores, URLs encontradas, títulos y credenciales no se registran.
