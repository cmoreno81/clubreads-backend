# Paginación cursor-based

La paginación es una ampliación compatible. Una petición sin `limit` ni `cursor` sigue usando el servicio y el contrato históricos. Una petición que incluya cualquiera de esos parámetros recibe:

```json
{
  "items": [],
  "nextCursor": null,
  "hasMore": false
}
```

`limit` admite enteros de 1 a 50 y, si se omite al continuar con `cursor`, vale 20. Cada consulta solicita `limit + 1`; no ejecuta `COUNT(*)`. `nextCursor` es opaco y contiene la fecha de ordenación y el ID de desempate. Flutter no debe construirlo ni interpretarlo.

## Acciones disponibles

| Acción | Parámetros adicionales | Orden paginado | Contrato sin parámetros |
| --- | --- | --- | --- |
| `notificaciones` | `limit`, `cursor` | `createdAt DESC, id DESC` | `{ notificaciones, noLeidas }`, limitado a 50 |
| `comentariosLectura` | `libro`, `capitulo`, `limit`, `cursor` | `createdAt ASC, id ASC` | `{ ok, capitulo, comentarios }`, sin límite y en el mismo orden cronológico |
| `conversacionesLibro` | `libro`, `limit`, `cursor` | `startedAt DESC, id DESC` | array de conversaciones, sin límite |
| `catalogoGeneral` | `limit`, `cursor` | `createdAt DESC, id DESC` | `{ ok, libros }`, limitado a 30 |
| `librosFinalizados` | `limit`, `cursor` | `finishedAt DESC, id DESC` | array, sin límite |
| `historialClubvision` | `limit`, `cursor` | `createdAt DESC, id DESC` | array, sin límite |
| `perfilUsuario` | `perfil`, `limit`, `cursor` | `finishedAt DESC, id DESC` | perfil completo con historiales, sin límite |

La acción `buscarCatalogoGeneral` ya está acotada a un máximo de 20 coincidencias locales y 20 del proveedor externo. No se pagina todavía: Google Books y OpenLibrary no ofrecen un cursor común estable y mezclar sus páginas podría duplicar u omitir obras. `lecturasActivas`, integrantes, rankings, retos, sagas y candidatas de Clubvisión son listas pequeñas o acotadas por su dominio y permanecen sin paginar.

## Índices revisados

Los índices actuales ayudan parcialmente: `Notification(userId, createdAt)`, `Comment(conversationId, createdAt)`, `ReadingCompletion(userId, finishedAt)` y los índices de `Library` por estado/usuaria. No incluyen siempre el ID de desempate, y catálogo, lecturas e historial de Clubvisión carecen del compuesto exacto.

Antes de crear una migración conviene medir con `EXPLAIN (ANALYZE, BUFFERS)` usando volúmenes representativos. Si aparecen ordenaciones costosas, los índices candidatos concretos son:

- `Notification(userId, createdAt, id)` para `notificaciones`;
- `Comment(conversationId, createdAt, id)` para `comentariosLectura`;
- `Book(createdAt, id)` con condición para libros no eliminados, para `catalogoGeneral`;
- `Reading(clubId, bookId, startedAt, id)` para `conversacionesLibro` (la consulta actual filtra el libro por título y podría requerir resolver primero su ID);
- `ReadingCompletion(userId, finishedAt, id)` para el historial del perfil;
- `ClubvisionResult(clubId, createdAt, id)` para `historialClubvision`;
- un índice de `Library(status, finishedAt, id)` para `librosFinalizados`, sujeto a comprobar el plan de la unión con membresías del club.

No se ha creado ninguna migración ni índice en esta fase.

## Migración de Flutter

Flutter debe añadir `limit` a la primera petición y reutilizar literalmente `nextCursor` en la siguiente. Debe concatenar `items`, detenerse cuando `hasMore` sea `false` y descartar el cursor al cambiar de usuaria, club, libro, capítulo o perfil. Durante la transición puede seguir usando las respuestas legacy omitiendo ambos parámetros.

En `comentariosLectura`, las páginas avanzan desde el comentario más antiguo al
más reciente. Actualmente `guardarComentarioLectura` solo responde `{ ok: true
}` y no devuelve el comentario creado. Por tanto, tras publicar, Flutter debe
conservar las páginas ya cargadas y pedir continuaciones desde el último cursor
hasta alcanzar la última página (o mantener temporalmente el comentario local
hasta reconciliarlo por ID en una ampliación futura del contrato). Recargar
únicamente la primera página no mostrará un comentario nuevo cuando existan
varias páginas. La UI debe deduplicar por `id` al concatenar y mantener/anclar
el scroll al final; sustituir toda la lista por la primera página provocaría un
salto al principio.
