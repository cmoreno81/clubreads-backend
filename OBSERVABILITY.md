# Logging y diagnóstico de rendimiento

El backend emite una línea JSON por petición mediante Pino. Railway debe recoger
la salida estándar existente; no se configura ningún transporte ni servicio de
logs externo. Cada evento `http_request` contiene `requestId`, método, acción o
ruta segura, estado, duración, entorno, tamaño de respuesta cuando Express lo
conoce y la marca `slow`. Nunca se incluyen el cuerpo, la query completa,
cookies, cabeceras de autenticación ni parámetros SQL.

`X-Request-ID` admite únicamente 1–100 caracteres alfanuméricos y `._:-`. Los
valores ausentes o no válidos se sustituyen por UUID y siempre se devuelven en
la respuesta. La correlación de usuaria solo se emite como `userRef`, HMAC
truncado del ID interno, cuando se configura `LOG_HASH_KEY`.

## Variables

- `LOG_LEVEL=info`: nivel mínimo de Pino.
- `LOG_HASH_KEY`: secreto aleatorio dedicado al HMAC de IDs internos. Si falta,
  no se registra ninguna referencia de usuaria.
- `SLOW_REQUEST_MS=1000`: umbral positivo en milisegundos.
- `PRISMA_SLOW_QUERY_MS=500`: umbral de consultas; se registra duración y target,
  nunca SQL, parámetros ni filas.

Las llamadas a Brevo, Google Books, Open Library y hosts de portadas emiten
`external_call` con proveedor, operación, duración, status y resultado de
timeout/error. No se registra la URL.

## Filtros útiles en Railway

Los filtros dependen de la interfaz vigente de Railway, pero pueden buscarse
estos pares JSON sin incluir datos personales:

```text
event:http_request slow:true
event:http_request action:dashboardGeneral
event:http_request status:500
event:prisma_slow_query
event:external_call outcome:timeout
requestId:<id-devuelto-en-X-Request-ID>
```

Los 400 de validación, 401/403 y 429 quedan clasificados respectivamente como
`validation`, `authentication_authorization` y `rate_limiting`; el evento de
petición se mantiene en nivel `info`. Los errores 5xx generan el evento seguro
del servidor y nunca devuelven stack al cliente.

Las métricas básicas se agregan en memoria por acción/ruta: número de
peticiones, errores, lentas, duración total, media y máxima. Son diagnósticas de
una sola réplica y se reinician con el proceso; para métricas globales entre
réplicas habrá que agregarlas desde los eventos de Railway, sin introducir aún
un servicio externo.
