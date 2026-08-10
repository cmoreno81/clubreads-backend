# Contrato candidato Flutter / API

Fuente revisada: router, controladores, validadores Zod del backend candidato y
cliente Flutter `develop` (`b402e59ab488b51bad75ed40bfe0f9e743482419`).

Todas las acciones se invocan sobre `/api?action=ACCION`. Salvo las marcadas
como públicas, exigen `Authorization: Bearer ACCESS_TOKEN`. Los `POST` usan
`Content-Type: application/json`; los campos de identidad enviados por Flutter
no se aceptan como sustituto del token. Un `GET` sobre una acción mutadora
responde `405 METHOD_NOT_ALLOWED` y `Allow: POST`.

## Autenticación

| Acción | Método | Auth | Cuerpo | Respuesta principal | Paginación |
| --- | --- | --- | --- | --- | --- |
| `solicitarActivacion` | POST | Pública | `{email}` | `{ok,mensaje}` | No |
| `activarCuenta` | POST | Pública | `{email,codigo,password}` | sesión: `accessToken`, `refreshToken`, usuaria | No |
| `solicitarRegistro` | POST | Pública | `{nombre,email}` | `{ok,mensaje}` | No |
| `completarRegistro` | POST | Pública | `{email,codigo,password}` | sesión y usuaria | No |
| `login` | POST | Pública | `{email,password}` | sesión y usuaria | No |
| `solicitarResetPassword` | POST | Pública | `{email}` | `{ok,mensaje}` | No |
| `resetPassword` | POST | Pública | `{email,codigo,password}` | `{ok,mensaje}` | No |
| `refreshToken` | POST | Pública | `{refreshToken}` | nueva pareja rotada de tokens | No |
| `logout` | POST | Bearer | `{}` | `{ok:true}`; revoca la sesión | No |
| `cambiarPassword` | POST | Bearer | `{passwordActual,passwordNueva}` | `{ok,mensaje}` | No |

## Clubes, dashboard y comunidad

| Acción | Método | Auth | Entrada | Respuesta principal | Paginación |
| --- | --- | --- | --- | --- | --- |
| `misClubes` | GET | Bearer | — | membresías y club activo | No |
| `crearClub` | POST | Bearer | `{nombre,descripcion?}` | club y selección activa | No |
| `unirseClub` | POST | Bearer | `{codigo}` | membresía y club activo | No |
| `seleccionarClub` | POST | Bearer | `{clubId}` | `{ok,club}` | No |
| `invitacionClub` | POST | Bearer + rol | `{clubId}` | código/datos de invitación | No |
| `salirClub` | POST | Bearer | `{clubId}` | `{ok}` | No |
| `editarClub` | POST | Bearer + rol | `{clubId,nombre?,descripcion?,avatarUrl?}` | club actualizado | No |
| `miembrosClub` | GET | Bearer | — | miembros visibles del club activo | No |
| `usuarios` | GET | Bearer | — | nombres públicos del club activo | No |
| `dashboard` | GET | Bearer | — | dashboard del club; `lecturaActual.ultimaActividad` es ISO o `null` | No |
| `dashboardGeneral` | GET | Bearer | — | dashboard global, incluidas sagas en curso/pendientes | No |
| `afinidadDetalle` | GET | Bearer | `miembroId` | libros comunes y afinidad | No |
| `ranking` | GET | Bearer | `anio?` | ranking del club | No |
| `achievements` | GET | Bearer | `year?` | logros de la usuaria | No |
| `clubAchievementsRecent` | GET | Bearer | — | logros recientes del club | No |
| `getClubChallenges` | GET | Bearer | — | retos lectores | No |
| `setReadingChallenge` | POST | Bearer | `{target}` | reto actualizado | No |

## Biblioteca, catálogo y sagas

| Acción | Método | Auth | Entrada | Respuesta principal | Paginación |
| --- | --- | --- | --- | --- | --- |
| `libros` | GET | Bearer | — | biblioteca personal | No |
| `librosFinalizados` | GET | Bearer | `limit?,cursor?` | legado: array; paginado: `{items,nextCursor,hasMore}` | Sí |
| `crearLibro` | POST | Bearer | título (`libro`, `titulo` o `title`) y metadatos opcionales | libro/biblioteca creados | No |
| `editarLibro` | POST | Bearer | `bookId` o `id`, más campos editables | libro actualizado | No |
| `anadirLibroExistente` | POST | Bearer | `{libro,prioridad,formato}` | entrada de biblioteca | No |
| `actualizarPreferenciasLibro` | POST | Bearer | `{libro,prioridad,formato}` | preferencias actualizadas | No |
| `quitarLibroPendientes` | POST | Bearer | `{libro}` | `{ok}` | No |
| `iniciarLectura` | POST | Bearer | `{libro}` | lectura iniciada | No |
| `actualizarEstado` | POST | Bearer | `{libro,estado,valoracion?,reflexion?,motivoPausa?,fechaInicio?,fechaFin?,formato?}` | estado/historial actualizado | No |
| `actualizarProgresoLectura` | POST | Bearer | `{libro,progreso,comentario?,paginaActual?,paginasTotales?}` | progreso actualizado | No |
| `toggleProgressReaction` | POST | Bearer | `{libraryId,reaccion?}` | reacción actual | No |
| `actualizarValoracion` | POST | Bearer | `{libro,valoracion}` | valoración actualizada | No |
| `actualizarPaginaLibrary` | POST | Bearer | `{bookId,paginaActual}` | página actualizada | No |
| `catalogoGeneral` | GET | Bearer | `limit?,cursor?` | legado: `{ok,libros}`; paginado: `{items,nextCursor,hasMore}` | Sí |
| `buscarCatalogoGeneral` | GET | Bearer | consulta de búsqueda | coincidencias locales/externas acotadas | No |
| `importarLibroCatalogo` | POST | Bearer | origen, título y metadatos del catálogo | libro importado | No |
| `librosPorAutor` | GET | Bearer | `autorId` | libros de la autora | No |
| `previsualizarImportacionGoodreads` | POST | Bearer | `{libros,source}` | previsualización y candidatas | No |
| `confirmarImportacionGoodreads` | POST | Bearer | `{libros,resoluciones?,source}` | resumen de importación | No |
| `seriesOverrides` | GET | Bearer | — | ajustes personales de saga | No |
| `setSeriesOverride` | POST | Bearer | `{seriesId,posicion,tipo}` | `{ok}` | No |
| `removeSeriesOverride` | POST | Bearer | `{seriesId,posicion}` | `{ok}` | No |
| `sagasOcultas` | GET | Bearer | — | sagas ocultas propias | No |
| `ocultarSaga` | POST | Bearer | `{sagaId}` | `{ok}` | No |
| `mostrarSaga` | POST | Bearer | `{sagaId}` | `{ok}` | No |
| `eliminarSaga` | POST | Bearer | `{sagaId}` | `{ok}` | No |
| `vincularVolumenSaga` | POST | Bearer | saga, número, origen, título y metadatos | volumen vinculado | No |
| `actualizarNumeroVolumenSaga` | POST | Bearer | `{bookId,numero}` | volumen actualizado | No |
| `actualizarEstadoEditorialSaga` | POST | Bearer | `{sagaId,estadoEditorial,totalPrevisto?}` | saga actualizada | No |
| `saveUserSeriesOrder` | POST | Bearer | `{seriesId,order:[{bookId,posicion}]}` | `{ok}` | No |

Los enums públicos aceptados incluyen `PENDIENTE`, `LEYENDO`, `PAUSADO`,
`FINALIZADO`, `ABANDONADO`, `RELECTURA`/`RELEYENDO`; formatos `FISICO`,
`DIGITAL`, `AUDIOLIBRO`; prioridades `BAJA`, `MEDIA`, `ALTA`; y tipos de
lectura `LIBRE`, `OFICIAL`. El backend los normaliza a los enums Prisma.

## Clubvisión

| Acción | Método | Auth | Entrada | Respuesta principal | Paginación |
| --- | --- | --- | --- | --- | --- |
| `clubvision` | GET | Bearer | — | estado, candidatas, ganadora y portadas | No |
| `enviarVotacion` | POST | Bearer | `{v1,v2,v3,v4,v5}` | `{ok}`/resultado de votación | No |
| `miVoto` | GET | Bearer | — | voto propio | No |
| `comoVotaron` | GET | Bearer | — | resultados visibles | No |
| `historialClubvision` | GET | Bearer | `limit?,cursor?` | legado: array; paginado: `{items,nextCursor,hasMore}` | Sí |

## Lecturas, capítulos y comentarios

| Acción | Método | Auth | Entrada | Respuesta principal | Paginación |
| --- | --- | --- | --- | --- | --- |
| `lecturasActivas` | GET | Bearer | — | lecturas activas; actividad ISO o `null` | No |
| `crearLectura` | POST | Bearer | `{libro,capitulos,prologo?,epilogo?,paginas?,tipo?}` | `{ok}` | No |
| `configuracionLectura` | GET | Bearer | `{libro}` en query | configuración de capítulos | No |
| `comentariosLectura` | GET | Bearer | `libro,capitulo,limit?,cursor?` | legado: `{ok,capitulo,comentarios}`; paginado: `{items,nextCursor,hasMore}` | Sí, ascendente |
| `guardarComentarioLectura` | POST | Bearer | `{libro,capitulo,comentario|texto,tipo?,color?}` | `{ok,comentario}` | No |
| `responderComentario` | POST | Bearer | `{comentarioId,respuesta}` | respuesta creada | No |
| `toggleLikeComentario` | POST | Bearer | `{comentarioId|id,reaccion?}` | reacción actual | No |
| `editarComentario` | POST | Bearer | `{comentarioId|id,comentario}` | comentario actualizado | No |
| `eliminarComentario` | POST | Bearer | `{comentarioId|id}` | `{ok}` | No |
| `editarRespuesta` | POST | Bearer | `{respuestaId|id,respuesta}` | respuesta actualizada | No |
| `eliminarRespuesta` | POST | Bearer | `{respuestaId|id}` | `{ok}` | No |
| `conversacionesLibro` | GET | Bearer | `libro,limit?,cursor?` | legado: array; paginado: `{items,nextCursor,hasMore}` | Sí |
| `marcarConversacionVista` | POST | Bearer | `{libro,capitulo}` | `{ok}` | No |

Los comentarios raíz y respuestas se ordenan por `createdAt ASC, id ASC`. El
cursor es opaco y debe reutilizarse literalmente; Flutter debe deduplicar por
`id` al concatenar páginas.

## Perfil, mood y notificaciones

| Acción | Método | Auth | Entrada | Respuesta principal | Paginación |
| --- | --- | --- | --- | --- | --- |
| `perfilUsuario` | GET | Bearer | `perfil,limit?,cursor?` | legado: perfil completo; paginado: finalizaciones en `{items,nextCursor,hasMore}` | Sí |
| `actualizarFechasLectura` | POST | Bearer | `{libraryId,completionId?,fechaInicio?,fechaFin?,valoracion?,resena?}` | lectura actualizada | No |
| `actualizarAvatarPerfil` | POST | Bearer | `{avatarUrl}` | perfil actualizado | No |
| `moodClub` | GET | Bearer | — | mood semanal del club | No |
| `registrarMoodClub` | POST | Bearer | `{mood}` | mood registrado | No |
| `tendenciasClub` | GET | Bearer | — | tendencias del club | No |
| `notificaciones` | GET | Bearer | `limit?,cursor?` | legado: `{notificaciones,noLeidas}`; paginado: `{items,nextCursor,hasMore}` | Sí |
| `marcarLeida` | POST | Bearer | `{id}` | `{ok}` | No |
| `marcarTodasLeidas` | POST | Bearer | `{}` | `{ok}` | No |
| `eliminarNotificacion` | POST | Bearer | `{id}` | `{ok}` | No |

## Acciones presentes en Flutter pero ausentes del backend

- `lecturaCompartida`: **no existe** en el router candidato ni en el backend
  desplegado. No fue renombrada de forma directa. La tarjeta equivalente se
  alimenta con `dashboard.lecturaActual`; para el detalle existen
  `lecturasActivas`, `configuracionLectura`, `conversacionesLibro` y
  `comentariosLectura`. Flutter debe eliminar esa llamada y componer la vista
  con esos contratos, o debe definirse un endpoint nuevo en otra entrega.
- `atmosferaClub`: **no existe** en el router candidato ni tiene controlador o
  servicio equivalente único. `moodClub` y `tendenciasClub` ofrecen datos
  relacionados, pero no garantizan el modelo `AtmosferaClub`. Flutter debe
  retirar/deshabilitar esa pantalla o acordar un contrato nuevo; no debe asumir
  que una de esas acciones es un reemplazo transparente.

## Errores comunes

- Sin sesión: `401 AUTHENTICATION_REQUIRED`.
- Token inválido/caducado: `401 INVALID_ACCESS_TOKEN`.
- Sin autorización de club: `403 FORBIDDEN`, mensaje seguro.
- Validación: `400 VALIDATION_ERROR` con nombres de campos, sin valores.
- Paginación inválida: `400 INVALID_PAGINATION`.
- Método incorrecto: `405 METHOD_NOT_ALLOWED` y `Allow: POST`.
- Error inesperado: `500 INTERNAL_ERROR`, sin detalles internos.
