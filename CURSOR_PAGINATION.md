# Transición a paginación por cursor

La paginación es una ampliación opt-in. Mientras existan APK antiguas, una
petición sin `limit` ni `cursor` conserva exactamente la respuesta histórica.
Cuando aparece cualquiera de esos parámetros, el endpoint valida la petición y
responde:

```json
{
  "items": [],
  "nextCursor": "cursor-opaco-o-null",
  "hasMore": false
}
```

`limit` es un entero entre 1 y 50 (20 por defecto cuando solo se envía cursor).
El cursor es opaco para el cliente, versionado y contiene fecha más ID. Un
cursor o límite inválido produce HTTP 400 con `error: INVALID_PAGINATION`.
Cada consulta pide `limit + 1`; no se ejecuta `COUNT(*)`.

## Endpoints adaptados

| Acción | Filtro adicional | Orden del modo paginado | Respuesta antigua |
| --- | --- | --- | --- |
| `notificaciones` | identidad Bearer | `createdAt DESC, id DESC` | `{notificaciones, noLeidas}`, limitado a 50 |
| `comentariosLectura` | `libro`, `capitulo`, club activo | comentarios raíz por `createdAt ASC, id ASC` | `{ok, capitulo, comentarios}`, sin límite en el mismo orden |
| `conversacionesLibro` | `libro`, club activo | `startedAt DESC, id DESC` | array de todas las lecturas del libro |
| `catalogoGeneral` | identidad Bearer | `createdAt DESC, id DESC` | `{ok, libros}`, máximo 30 por popularidad/fecha |
| `librosFinalizados` | club activo | `finishedAt DESC, id DESC` | array completo ordenado por libro/usuaria |
| `historialClubvision` | club activo | `createdAt DESC, id DESC` | array completo ordenado por edición |
| `perfilUsuario` | `perfil`, visibilidad en club | `finishedAt DESC, id DESC` | objeto de perfil completo |

En `perfilUsuario`, el modo paginado representa exclusivamente la colección de
finalizaciones (`terminados`). Los metadatos y colecciones pequeñas del perfil
siguen disponibles mediante la llamada antigua durante la transición.

## Colecciones revisadas que ya estaban limitadas

- `notificaciones`: 50, aunque antes no permitía navegar a registros anteriores.
- `catalogoGeneral`: 30, sin navegación.
- `buscarCatalogoGeneral`: 20 coincidencias locales y hasta 20 del proveedor
  externo. No se pagina en esta fase porque Google Books/Open Library no ofrecen
  un cursor compatible con el cursor estable de PostgreSQL. Se mantiene el tope
  actual; mezclar offsets externos dentro de un cursor local produciría saltos.
- Actividad de mood: 60 comentarios, 10 finalizaciones.
- Dashboard general: varias secciones con topes propios (4, 6 y 100) y finalidad
  de resumen, no de historial navegable.

No se paginan integrantes del club ni otras listas pequeñas/acotadas.

## Índices comprobados y propuestas

Los índices actuales empiezan por los filtros principales, pero no incluyen el
ID usado para desempatar el cursor. No se incluye ninguna migración en este
cambio. Antes de activar tráfico paginado significativo conviene medir con
`EXPLAIN (ANALYZE, BUFFERS)` y, solo si se confirma la necesidad, crear:

- `Notification(userId, createdAt DESC, id DESC)`: sustituye para esta consulta
  al índice parcial actual `(userId, createdAt)` y cubre filtro, orden y cursor.
- `Comment(conversationId, parentId, deletedAt, createdAt ASC, id ASC)`: cubre
  comentarios raíz visibles de una conversación; los índices actuales no
  incluyen `parentId`, `deletedAt` ni el desempate.
- `Reading(clubId, bookId, startedAt DESC, id DESC)`: historial de conversaciones
  de un libro dentro del club. Antes conviene resolver el libro a `bookId` para
  evitar ordenar después del join por título.
- `Library(status, finishedAt DESC, id DESC)`: historial finalizado del club. La
  pertenencia al club sigue resolviéndose mediante `ClubMember`; debe validarse
  el plan porque la selectividad de `status` dependerá del volumen real.
- `ReadingCompletion(userId, finishedAt DESC, id DESC)`: amplía el índice actual
  `(userId, finishedAt)` para el historial de perfil sin ordenar aparte IDs con
  la misma fecha.
- `ClubvisionResult(clubId, createdAt DESC, id DESC)`: el índice único actual por
  `(clubId, edition)` sirve al contrato legado, no al nuevo orden temporal.
- `Book(createdAt DESC, id DESC)`: catálogo local cronológico paginado.

## Retirada futura del modo legado

1. Publicar Flutter con consumo incremental de todas las acciones anteriores.
2. Medir adopción y registrar llamadas sin paginación por versión de cliente.
3. Cuando no queden APK soportadas, eliminar las ramas legadas y hacer `limit`
   obligatorio o conservar el valor por defecto.
4. Separar `comentariosLectura` de la escritura `ConversationRead`; hoy ambos
   modos conservan ese efecto por compatibilidad.
