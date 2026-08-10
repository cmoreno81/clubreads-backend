# Diagnóstico Prisma/PostgreSQL de solo lectura

## Reevaluación para despliegue (criterio estricto)

La revisión posterior exige duración o frecuencia observada, timeout atribuible
a la consulta, `Sequential Scan` costoso o sort costoso antes de preparar DDL.
Con ese umbral **no hay ningún índice demostrado como necesario antes del
despliegue**. No se crea migración y se retira la propuesta SQL manual anterior,
que nunca fue ejecutada.

| Endpoint | Consulta | Duración observada | Plan observado | Índice existente / cobertura | Cambio considerado | Clasificación |
| --- | --- | ---: | --- | --- | --- | --- |
| Comentarios de capítulo | raíces visibles por conversación, cursor `createdAt ASC, id ASC` | No disponible | `Index Scan` por `(conversationId, createdAt)` + `Incremental Sort` | `(conversationId, createdAt)` cubre filtro y primer campo de orden; PK cubre `id` por separado | parcial `(conversationId, createdAt ASC, id ASC)` | Útil pero no urgente; falta latencia/sort real |
| Notificaciones | usuaria, cursor `createdAt DESC, id DESC` | No disponible | `Index Scan` por `(userId, createdAt)` + `Incremental Sort` | `(userId, createdAt)` cubre filtro y primer campo; PK cubre `id` por separado | `(userId, createdAt DESC, id DESC)` | Útil pero no urgente; falta frecuencia y coste real |
| Perfil finalizaciones | usuaria, cursor `finishedAt DESC, id DESC` | No disponible | `Index Scan` por `(userId, finishedAt)` + `Incremental Sort` | `(userId, finishedAt)` cubre filtro/rango; también existe `(userId,isReread,finishedAt)` | `(userId, finishedAt DESC, id DESC)` | Útil pero no urgente; falta evidencia de sort costoso |
| Catálogo | activos, cursor `createdAt DESC, id DESC` | No disponible | `Seq Scan` + `Sort`, coste estimado 120,80 sobre unas 1.245 filas | no existe índice de cursor; PK y `Book(title)` no cubren filtro/orden | parcial `(createdAt DESC,id DESC) WHERE deletedAt IS NULL` | Útil pero no urgente; tabla pequeña y sin latencia medida |
| Historial Clubvisión | club, cursor `createdAt DESC, id DESC` | No disponible | `Seq Scan` + `Sort`, coste 1,09 sobre unas 4 filas | único `(clubId,edition)` no cubre fecha | índice de cursor por club | No justificada por tamaño/coste |
| Ranking de afinidad | miembros, `isReread=false`, rango anual | No disponible | `Index Scan`, sin sort | `(userId,isReread,finishedAt)` coincide con filtro; `(userId,finishedAt)` también es prefijo útil | índice adicional | No justificada; ya cubierto |
| Biblioteca | usuaria y estado | No disponible | `Index Scan` | `(userId,status)` exacto y único `(userId,bookId)` | añadir `bookId` al índice | No justificada; sin filas descartadas medidas |
| Usuarios por email/nombre | igualdad case-insensitive | No disponible | `Seq Scan`, coste 2,19 sobre 13 filas | únicos actuales son case-sensitive | funcional sobre `lower(...)` | No justificada por coste/tamaño |
| Búsqueda de títulos | `contains` case-insensitive | No disponible | `Seq Scan`, coste 117,67 | B-tree `title` no sirve para `%texto%` | `pg_trgm` + GIN | No justificada aún; requiere extensión y medición separada |

El timeout histórico de `dashboard` no se asignó a una consulta PostgreSQL
concreta. La optimización posterior eliminó cargas completas, agregó en
PostgreSQL y separó la sincronización de Clubvisión. Sin mediciones posteriores
no existe evidencia para vincular ese timeout a un índice.

### Comprobación de solapamientos

- `Notification(userId,createdAt,id)` y
  `ReadingCompletion(userId,finishedAt,id)` ampliarían índices existentes; no
  son duplicados exactos, pero sus prefijos ya resuelven filtro y rango.
- La PK por `id` no sustituye el desempate dentro del mismo índice, pero tampoco
  demuestra por sí sola que el `Incremental Sort` sea caro.
- El parcial de comentarios respetaría filtro y orden ascendente exactos, pero
  el índice actual ya evita escanear conversaciones ajenas.
- Afinidad y biblioteca ya están cubiertas por índices compuestos existentes.
- El único `(clubId,edition)` de Clubvisión no cubre el cursor temporal, pero
  cuatro filas no justifican coste de escritura adicional.

### Coste y validación pendiente

Los cuatro candidatos diferidos añadirían una entrada por inserción y trabajo
en actualizaciones de columnas indexadas; notificaciones y finalizaciones
crecerían con todo el historial, mientras comentarios/libros podrían ser
parciales. No se atribuyen tamaños ficticios: deben medirse en una copia con
`pg_relation_size` después de crear cada índice.

No hay comparación antes/después porque no existe una copia restaurada o base
temporal confirmada y, correctamente, no se creó ningún índice. Para reabrir la
decisión hacen falta logs agregados representativos o `pg_stat_statements` y
`EXPLAIN (ANALYZE, BUFFERS)` exclusivamente en esa copia. Solo entonces se debe
crear una migración nueva; si el índice es grande, usar un runbook separado con
`CREATE INDEX CONCURRENTLY` fuera de una transacción Prisma.

Fecha: 2026-08-09. La base configurada es remota y no está identificada como
desechable. Se usó una transacción `READ ONLY` y exclusivamente `EXPLAIN
(FORMAT JSON)`, nunca `ANALYZE`. No se ejecutaron DDL, migraciones ni consultas
de escritura. `pg_stat_statements` no está instalado, de modo que PostgreSQL no
puede aportar llamadas ni tiempos históricos agregados. Los logs locales
anteriores solo midieron el middleware y no constituyen latencia de negocio.

Estimaciones del catálogo: `Book` 1.245 filas, `ClubvisionResult` 4, `Comment`
349, `Library` 1.653, `Notification` 2.537, `ReadingCompletion` 1.278 y `User`
13. Son estimaciones de `pg_class`, no datos de filas.

## Inventario de consultas prioritarias

| Endpoint | Consulta | `where` | Orden | Relaciones / selección | Límite | Índice actual probable |
| --- | --- | --- | --- | --- | --- | --- |
| Entrada a capítulo | Resolver conversación | capítulo; lectura activa; club; título del libro | ninguno | solo `conversation.id` en modo paginado | 1 lógico | índices de lectura por club/libro/estado; no hay compuesto de conversación por título/lectura |
| Entrada a capítulo | Comentarios raíz | `conversationId`, `parentId IS NULL`, `deletedAt IS NULL`, cursor fecha/ID | `createdAt ASC, id ASC` | usuaria, likes y respuestas visibles; respuestas `ASC` | `limit + 1`, máximo 51 | `Comment(conversationId, createdAt)` |
| Dashboard general | Finalizaciones propias | `userId` | `finishedAt DESC` | libro completo en legacy | sin límite | `ReadingCompletion(userId, finishedAt)` |
| Dashboard general | Bibliotecas personales | `userId` más estado o rango de fechas | según bloque | libro/género y resúmenes | activa 4; populares 6; otros bloques sin límite | `Library(userId,status)`, único `(userId,bookId)` y otros índices parciales por filtro |
| Dashboard general | Aviso Clubvisión | clubes activos y edición; ganadoras anteriores; pendientes compartidos | ninguno | `_count`, `groupBy` | número de clubes de la usuaria | únicos/índices de Clubvisión y `Library(status)`; queda un `Promise.all` por club cuando falta edición |
| Catálogo | Página de libros activos | `deletedAt IS NULL`, cursor fecha/ID | `createdAt DESC, id DESC` | autora, género y biblioteca de la usuaria | `limit + 1`, máximo 51 | ninguno por fecha; `Book(title)` no ayuda |
| Búsqueda catálogo | Texto en título/ISBN/autora | `contains`, case-insensitive, con OR | ninguno | `bookInclude` | 20 locales + 20 externos | B-tree de título/autor no soporta `%texto%`; `pg_trgm` no está instalado |
| Notificaciones | Página personal | `userId`, cursor fecha/ID | `createdAt DESC, id DESC` | select escalar mínimo | `limit + 1`, máximo 51 | `Notification(userId,createdAt)` |
| Historial Clubvisión | Página del club | `clubId`, cursor fecha/ID | `createdAt DESC, id DESC` | ganadora directa mínima y una consulta masiva de libros para títulos | `limit + 1`, máximo 51 | único `(clubId,edition)` no cubre fecha |
| Perfil legacy | Biblioteca e historial | `userId`; comentarios visibles propios | finalización/actualización descendente | libro, género, saga con libros/autoras, reseñas y likes | sin límite | varios índices de prefijo; relaciones amplias |
| Perfil paginado | Finalizaciones | `userId`, cursor finalización/ID | `finishedAt DESC, id DESC` | libro/género; segunda consulta de bibliotecas con `bookId IN` de máximo 50 | `limit + 1`, máximo 51 | `ReadingCompletion(userId,finishedAt)` |
| Afinidad anual | Propias y resto del club | `userId`/`userId IN`, `isReread=false`, rango anual, `bookId IN` | ninguno | solo `userId`, `bookId`; miembros mínimos | miembros del club y libros propios; actualmente acotados por dominio | `(userId,isReread,finishedAt)` y `(userId,finishedAt)` |

## Evidencia de planes y decisiones

| Consulta | Plan observado | Decisión |
| --- | --- | --- |
| Comentarios paginados | `Index Scan` por `(conversationId,createdAt)` + `Incremental Sort` para fecha/ID | índice parcial de raíces visibles con ID; prioridad alta |
| Notificaciones paginadas | `Index Scan` por `(userId,createdAt)` + `Incremental Sort` para fecha/ID | ampliar con ID; prioridad alta |
| Perfil paginado | `Index Scan` por `(userId,finishedAt)` + `Incremental Sort` | ampliar con ID; prioridad alta |
| Afinidad anual | `Index Scan` por `(userId,finishedAt)`; sin sort | el índice existente `(userId,isReread,finishedAt)` cubre razonablemente; no añadir otro ahora |
| Biblioteca por usuaria/estado | `Index Scan` por el único/prefijo de usuaria-libro | ya existen `(userId,status)` y único `(userId,bookId)`; no duplicar con `(userId,status,bookId)` sin evidencia de filas descartadas |
| Historial Clubvisión | `Seq Scan` + `Sort`, coste 1,09, tabla estimada en 4 filas | diferir índice hasta crecimiento medible |
| Catálogo paginado | `Seq Scan` + `Sort`, coste 120,80 | índice parcial para libros activos y cursor; prioridad alta |
| `lower(email)` / `lower(name)` | `Seq Scan`, coste 2,19, 13 usuarias | diferir: coste despreciable; los índices únicos actuales son case-sensitive y no cubren `mode: insensitive` |
| `lower(title)` | `Seq Scan`, coste 117,67 | un B-tree funcional no ayuda a `contains`; evaluar `pg_trgm` y GIN en una tarea separada |

No se observaron sorts a disco porque `EXPLAIN` sin ejecución no informa memoria
real. Tampoco pueden calcularse llamadas repetidas ni tiempos sin
`pg_stat_statements`. El logger `prisma_slow_query` permitirá reunir duración de
consultas futuras, aunque Prisma/driver solo expone `target` y operación genérica
sin modelo de forma fiable; deliberadamente no registra SQL.

## N+1, relaciones y listas `IN`

- La afinidad anual ya hace una sola consulta masiva para el resto de miembros.
- Las portadas del historial de Clubvisión usan una sola consulta masiva por
  página.
- El perfil paginado usa un `IN` de como máximo 50 `bookId`; es razonable.
- El perfil legacy continúa cargando todos los historiales y relaciones de saga;
  debe retirarse tras migrar Flutter a la variante paginada.
- La búsqueda y el catálogo legacy usan relaciones más amplias que la página
  nueva, aunque están limitados a 20/30 libros.
- El aviso de Clubvisión del dashboard puede ejecutar una consulta de candidatas
  por club sin edición materializada. Hoy la cantidad de clubes por usuaria es
  pequeña; si crece, conviene sustituir ese `Promise.all` por agregación masiva.
- La afinidad usa `IN` con miembros y libros propios. Actualmente el club es
  pequeño; debe vigilarse el tamaño antes de introducir tablas temporales o
  otra estrategia.

## DDL

No se prepara migración normal ni procedimiento concurrente ejecutable. No se
edita ninguna migración aplicada. La búsqueda textual sigue siendo una línea de
investigación, no una propuesta: `pg_trgm`/GIN requiere evidencia propia.
