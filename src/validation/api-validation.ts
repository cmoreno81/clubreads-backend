import type { Request, Response } from 'express';
import { z } from 'zod';
export {
  formatSchema,
  prioritySchema,
  reactionSchema,
  readingTypeSchema,
  statusSchema,
} from './api-enums.js';
import {
  formatSchema,
  prioritySchema,
  reactionSchema,
  readingTypeSchema,
  statusSchema,
} from './api-enums.js';

const MAX_TEXT = 4_000;
const MAX_LONG_TEXT = 20_000;
const MAX_URL = 2_048;

export const identifierSchema = z.string().trim().min(1).max(200);
export const emailSchema = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
export const shortTextSchema = z.string().trim().min(1).max(200);
export const textSchema = z.string().max(MAX_TEXT);
export const longTextSchema = z.string().max(MAX_LONG_TEXT);
export const urlSchema = z.union([z.literal(''), z.string().trim().url().max(MAX_URL)]);

const finiteNumber = z.number().finite();
const decimalString = z.string().trim().regex(/^-?(?:\d+|\d+\.\d+|\.\d+)$/);
export const compatibleNumberSchema = z.union([finiteNumber, decimalString]);
export const integerSchema = compatibleNumberSchema.refine(
  (value) => Number.isSafeInteger(Number(value)),
  'Debe ser un número entero válido',
);
export const positiveIntegerSchema = integerSchema.refine((value) => Number(value) >= 1, 'Debe ser mayor que cero');
export const pageSchema = integerSchema.refine((value) => Number(value) >= 0 && Number(value) <= 100_000, 'Página fuera de rango');
export const progressSchema = compatibleNumberSchema.refine((value) => Number(value) >= 0 && Number(value) <= 100, 'Progreso fuera de rango');
export const ratingSchema = z.union([
  z.literal(''),
  compatibleNumberSchema.refine((value) => Number(value) >= 0 && Number(value) <= 5, 'Valoración fuera de rango'),
]);
export const dateSchema = z.string().trim().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  const datePart = value.slice(0, 10);
  const date = new Date(`${datePart}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== datePart) return false;
  return !value.includes('T') || !Number.isNaN(new Date(value).valueOf());
}, 'Fecha inválida');
export const optionalDateSchema = z.union([z.literal(''), dateSchema]).optional();

export const commentTypeSchema = z.enum(['COMMENT', 'QUOTE']);
export const importSourceSchema = z.enum(['GOODREADS', 'BOOKMORY']);
export const legacyBooleanSchema = z.union([z.boolean(), z.literal(1), z.literal(0), z.literal('1'), z.literal('0')]);

function datesAreOrdered(start?: string, end?: string) {
  if (!start || !end) return true;
  return new Date(start.length === 10 ? `${start}T00:00:00.000Z` : start).valueOf()
    <= new Date(end.length === 10 ? `${end}T00:00:00.000Z` : end).valueOf();
}

const body = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();
const emptyBody = body({});
const idBody = (field = 'id') => body({ [field]: identifierSchema } as Record<string, typeof identifierSchema>);
const bookBody = body({ libro: identifierSchema });
const commentIdBody = body({ comentarioId: identifierSchema.optional(), id: identifierSchema.optional() }).refine(
  (value) => Boolean(value.comentarioId || value.id), { path: ['comentarioId'], message: 'Identificador obligatorio' },
);
const replyIdBody = body({ respuestaId: identifierSchema.optional(), id: identifierSchema.optional() }).refine(
  (value) => Boolean(value.respuestaId || value.id), { path: ['respuestaId'], message: 'Identificador obligatorio' },
);

const emailBody = body({ email: emailSchema });
const codePasswordBody = body({ email: emailSchema, codigo: z.string().trim().min(4).max(12), password: z.string().min(8).max(200) });
const bookMutationFields = {
  autor: shortTextSchema.optional(), genero: shortTextSchema.optional(),
  saga: z.string().max(200).optional(), portada: urlSchema.optional(), portadaUrl: urlSchema.optional(),
  prioridad: prioritySchema.optional(), formato: formatSchema.optional(), estado: statusSchema.optional(), paginas: pageSchema.optional(),
  valoracion: ratingSchema.optional(), reflexion: longTextSchema.optional(), resena: longTextSchema.optional(),
};
const goodreadsRowSchema = z.object({
  sourceRowId: z.string().max(500).optional(), rowId: z.string().max(500).optional(), id: z.string().max(500).optional(),
  title: z.string().min(1).max(500), author: z.string().max(500).optional(), isbn: z.string().max(32).optional(),
  isbn13: z.string().max(32).optional(), rating: ratingSchema.optional(), dateRead: optionalDateSchema,
  dateAdded: optionalDateSchema, review: longTextSchema.optional(),
}).passthrough();
const goodreadsRowsSchema = z.array(goodreadsRowSchema).max(2_000);
const importResolutionsSchema = z.union([
  z.array(z.object({ index: integerSchema, bookId: identifierSchema }).passthrough()).max(2_000),
  z.record(z.string().regex(/^\d+$/), identifierSchema),
]);

export const actionBodySchemas: Record<string, z.ZodType> = {
  solicitarActivacion: emailBody,
  activarCuenta: codePasswordBody,
  solicitarRegistro: body({ nombre: shortTextSchema, email: emailSchema }),
  completarRegistro: codePasswordBody,
  login: body({ email: emailSchema, password: z.string().min(1).max(200) }),
  solicitarResetPassword: emailBody,
  resetPassword: codePasswordBody,
  refreshToken: body({ refreshToken: z.string().min(1).max(4_096) }),
  logout: emptyBody,
  cambiarPassword: body({ passwordActual: z.string().min(1).max(200), passwordNueva: z.string().min(8).max(200) }),
  setSeriesOverride: body({ seriesId: identifierSchema, posicion: positiveIntegerSchema, tipo: z.enum(['LEIDO_EXTERNO', 'OMITIDO']) }),
  removeSeriesOverride: body({ seriesId: identifierSchema, posicion: positiveIntegerSchema }),
  ocultarSaga: idBody('sagaId'), mostrarSaga: idBody('sagaId'), eliminarSaga: idBody('sagaId'),
  marcarLeida: idBody(), marcarTodasLeidas: emptyBody, eliminarNotificacion: idBody(), eliminarTodasNotificaciones: emptyBody,
  importarLibroCatalogo: body({ origen: z.enum(['CLUBREADS', 'GOOGLE', 'OPENLIBRARY']), id: identifierSchema.optional(), titulo: shortTextSchema.optional(), autores: z.array(shortTextSchema).max(20).optional(), isbn: z.string().max(32).optional(), coverUrl: urlSchema.optional(), anioPublicacion: positiveIntegerSchema.optional(), ...bookMutationFields }),
  previsualizarImportacionGoodreads: body({ libros: goodreadsRowsSchema, source: importSourceSchema }),
  confirmarImportacionGoodreads: body({ libros: goodreadsRowsSchema, resoluciones: importResolutionsSchema.optional(), source: importSourceSchema }),
  vincularVolumenSaga: body({ sagaId: identifierSchema, numero: compatibleNumberSchema.refine((v) => Number(v) > 0), origen: z.enum(['CLUBREADS', 'GOOGLE', 'OPENLIBRARY']), titulo: shortTextSchema, autores: z.array(shortTextSchema).max(20).optional(), id: identifierSchema.optional(), ...bookMutationFields }),
  actualizarNumeroVolumenSaga: body({ bookId: identifierSchema, numero: compatibleNumberSchema.refine((v) => Number(v) > 0) }),
  actualizarEstadoEditorialSaga: body({ sagaId: identifierSchema, estadoEditorial: z.enum(['UNKNOWN', 'ONGOING', 'COMPLETED']), totalPrevisto: positiveIntegerSchema.optional() }),
  crearClub: body({ nombre: shortTextSchema, descripcion: textSchema.optional() }),
  crearEspacioPersonal: emptyBody,
  doCheckin: emptyBody,
  unirseClub: body({ codigo: z.string().trim().min(1).max(100) }),
  seleccionarClub: idBody('clubId'), invitacionClub: idBody('clubId'), salirClub: idBody('clubId'),
  editarClub: body({ clubId: identifierSchema, nombre: shortTextSchema.optional(), descripcion: textSchema.optional(), avatarUrl: urlSchema.optional() }),
  crearLibro: body({ libro: shortTextSchema.optional(), titulo: shortTextSchema.optional(), title: shortTextSchema.optional(), author: shortTextSchema.optional(), isbn: z.string().max(32).optional(), totalPages: pageSchema.optional(), confirmarNuevo: z.boolean().optional(), ...bookMutationFields }).refine((v) => Boolean(v.libro || v.titulo || v.title), { path: ['titulo'], message: 'Título obligatorio' }),
  editarLibro: body({ bookId: identifierSchema.optional(), id: identifierSchema.optional(), ...bookMutationFields }).refine((v) => Boolean(v.bookId || v.id), { path: ['bookId'], message: 'Identificador obligatorio' }),
  anadirLibroExistente: body({ libro: identifierSchema, prioridad: prioritySchema, formato: formatSchema.optional() }),
  actualizarPreferenciasLibro: body({ libro: identifierSchema, prioridad: prioritySchema, formato: formatSchema.optional() }),
  quitarLibroPendientes: bookBody, iniciarLectura: bookBody,
  actualizarEstado: body({ libro: identifierSchema, estado: statusSchema, valoracion: ratingSchema.optional(), reflexion: longTextSchema.optional(), motivoPausa: textSchema.optional(), fechaInicio: optionalDateSchema, fechaFin: optionalDateSchema, formato: formatSchema.optional() }).refine((v) => datesAreOrdered(v.fechaInicio, v.fechaFin), { path: ['fechaFin'], message: 'La fecha final no puede ser anterior a la inicial' }),
  actualizarProgresoLectura: body({ libro: identifierSchema, progreso: progressSchema, comentario: textSchema.optional(), paginaActual: pageSchema.optional(), paginasTotales: pageSchema.optional() }).refine((v) => v.paginaActual === undefined || v.paginasTotales === undefined || Number(v.paginaActual) <= Number(v.paginasTotales), { path: ['paginaActual'], message: 'La página actual supera el total' }),
  toggleProgressReaction: body({ libraryId: identifierSchema, reaccion: reactionSchema.optional() }),
  actualizarValoracion: body({ libro: identifierSchema, valoracion: ratingSchema }),
  actualizarPaginaLibrary: body({ bookId: identifierSchema, paginaActual: pageSchema }),
  enviarVotacion: body({ v1: identifierSchema, v2: identifierSchema, v3: identifierSchema, v4: identifierSchema, v5: identifierSchema }),
  crearLectura: body({ libro: identifierSchema, capitulos: integerSchema.refine((v) => Number(v) >= 0, 'Debe ser mayor o igual a cero'), prologo: legacyBooleanSchema.optional(), epilogo: legacyBooleanSchema.optional(), paginas: pageSchema.optional(), tipo: readingTypeSchema.optional() }),
  guardarComentarioLectura: body({ libro: identifierSchema, capitulo: z.union([identifierSchema, integerSchema]), comentario: textSchema.optional(), texto: textSchema.optional(), tipo: commentTypeSchema.optional(), color: z.string().max(32).optional() }).refine((v) => Boolean(v.comentario || v.texto), { path: ['comentario'], message: 'Comentario obligatorio' }),
  responderComentario: body({ comentarioId: identifierSchema, respuesta: textSchema }),
  toggleLikeComentario: commentIdBody.and(body({ reaccion: reactionSchema.optional() })),
  editarComentario: commentIdBody.and(body({ comentario: textSchema.min(1) })), eliminarComentario: commentIdBody,
  editarRespuesta: replyIdBody.and(body({ respuesta: textSchema.min(1) })), eliminarRespuesta: replyIdBody,
  marcarConversacionVista: body({ libro: identifierSchema, capitulo: z.union([identifierSchema, integerSchema]) }),
  actualizarFechasLectura: body({ libraryId: identifierSchema, completionId: identifierSchema.optional(), fechaInicio: optionalDateSchema, fechaFin: optionalDateSchema, valoracion: ratingSchema.optional(), resena: longTextSchema.optional() }).refine((v) => datesAreOrdered(v.fechaInicio, v.fechaFin), { path: ['fechaFin'], message: 'La fecha final no puede ser anterior a la inicial' }),
  actualizarAvatarPerfil: body({ avatarUrl: urlSchema }), registrarMoodClub: body({ mood: z.enum(['HOOKED', 'SHOCKED', 'CRYING', 'ANGRY', 'LAUGHING', 'BLOCKED']) }),
  toggleFavorito: body({ bookId: identifierSchema }),
  reemplazarFavorito: body({ bookIdActual: identifierSchema, bookIdNuevo: identifierSchema }),
  saveUserSeriesOrder: body({ seriesId: identifierSchema, order: z.array(z.object({ bookId: identifierSchema, posicion: positiveIntegerSchema }).passthrough()).max(1_000) }),
  setReadingChallenge: body({ target: integerSchema.refine((v) => Number(v) >= 0 && Number(v) <= 10_000, 'Objetivo fuera de rango') }),
  guardarSeleccionLibroDelAnio: body({ anio: positiveIntegerSchema, mes: integerSchema.refine((v) => Number(v) >= 1 && Number(v) <= 12), bookId: identifierSchema }),
  elegirDueloLibroDelAnio: body({ anio: positiveIntegerSchema, fase: z.enum(['MONTH_PAIR', 'SEMIFINAL']), posicion: positiveIntegerSchema, bookId: identifierSchema }),
  elegirLibroDelAnio: body({ anio: positiveIntegerSchema, bookId: identifierSchema }),
  iniciarLibroDelAnioClub: body({ anio: positiveIntegerSchema }),
  votarClasificacionLibroDelAnioClub: body({ anio: positiveIntegerSchema, candidateIds: z.array(identifierSchema).min(1).max(3) }),
  cerrarClasificacionLibroDelAnioClub: body({ anio: positiveIntegerSchema }),
  abrirRondaLibroDelAnioClub: body({ anio: positiveIntegerSchema, roundId: identifierSchema }),
  votarDueloLibroDelAnioClub: body({ anio: positiveIntegerSchema, duelId: identifierSchema, candidateId: identifierSchema }),
  cerrarRondaLibroDelAnioClub: body({ anio: positiveIntegerSchema, roundId: identifierSchema }),
  cancelarLibroDelAnioClub: body({ anio: positiveIntegerSchema }),
};

export const actionQuerySchemas: Record<string, z.ZodType> = {
  detalleReacciones: z.object({ action: z.literal('detalleReacciones'), targetType: z.enum(['COMMENT', 'PROGRESS']), targetId: identifierSchema }).passthrough(),
  libroPorId: z.object({ action: z.literal('libroPorId'), bookId: identifierSchema }).passthrough(),
  configuracionLectura: z.object({ action: z.literal('configuracionLectura'), libro: identifierSchema }).passthrough(),
  comentariosLectura: z.object({ action: z.literal('comentariosLectura'), libro: identifierSchema, capitulo: identifierSchema }).passthrough(),
  conversacionesLibro: z.object({ action: z.literal('conversacionesLibro'), libro: identifierSchema }).passthrough(),
  miLibroDelAnio: z.object({ action: z.literal('miLibroDelAnio'), anio: positiveIntegerSchema }).passthrough(),
  libroDelAnioPublico: z.object({ action: z.literal('libroDelAnioPublico'), perfil: identifierSchema, anio: positiveIntegerSchema }).passthrough(),
  librosDelAnioClub: z.object({ action: z.literal('librosDelAnioClub'), anio: positiveIntegerSchema }).passthrough(),
  libroDelAnioClub: z.object({ action: z.literal('libroDelAnioClub'), anio: positiveIntegerSchema }).passthrough(),
  prepararLibroDelAnioClub: z.object({ action: z.literal('prepararLibroDelAnioClub'), anio: positiveIntegerSchema }).passthrough(),
  historialLibroDelAnioClub: z.object({ action: z.literal('historialLibroDelAnioClub') }).passthrough(),
};

function invalidFields(error: z.ZodError) {
  return [...new Set(error.issues.map((issue) => issue.path.map(String).join('.')).filter(Boolean))].slice(0, 20);
}

export function validateActionInput(action: string, req: Request, res: Response) {
  const schema = req.method === 'POST' ? actionBodySchemas[action] : actionQuerySchemas[action];
  if (!schema) return null;
  const result = schema.safeParse(req.method === 'POST' ? req.body : req.query);
  if (!result.success) {
    return res.status(400).json({
      ok: false,
      error: 'VALIDATION_ERROR',
      mensaje: 'La petición contiene campos inválidos',
      campos: invalidFields(result.error),
    });
  }
  if (req.method === 'POST') req.body = result.data;
  return null;
}
