import { prisma } from '../prisma.js';
import { backgroundError } from '../logging/logger.js';
import { amistadesQueComparten } from './amistades-ver.service.js';
import { notifyProgresoComentario } from './notifications.service.js';
import {
  MAX_COMENTARIOS_PROGRESO_POR_DIA,
  MAX_COMENTARIOS_PROGRESO_POR_MINUTO,
  MAX_COMENTARIOS_PROGRESO_VISIBLES,
  crearLimitador,
  limpiarComentarioProgreso,
} from './amistades-core.js';

const puedeComentar = crearLimitador(MAX_COMENTARIOS_PROGRESO_POR_MINUTO);

const SIN_ACCESO = 'No puedes ver los comentarios de esta lectura.';

/// La lectura es mía, o de una amistad que enseña lo que lee. Si no, no hay acceso.
async function lecturaAccesible(yo: string, libraryId: string) {
  const lectura = await prisma.library.findUnique({
    where: { id: String(libraryId ?? '').trim() },
    select: {
      id: true,
      userId: true,
      book: { select: { id: true, title: true } },
    },
  });
  if (!lectura) return null;
  if (lectura.userId === yo) return lectura;
  const amistades = await amistadesQueComparten(yo);
  const dueña = amistades.find((a) => a.id === lectura.userId);
  return dueña?.friendsSeeReading ? lectura : null;
}

async function bloqueadasConmigo(userId: string) {
  const filas = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  return new Set(filas.map((f) => (f.blockerId === userId ? f.blockedId : f.blockerId)));
}

export async function getComentariosProgreso(yo: string, libraryId: string) {
  const lectura = await lecturaAccesible(yo, libraryId);
  if (!lectura) return { ok: false, mensaje: SIN_ACCESO };
  const bloqueadas = await bloqueadasConmigo(yo);
  const filas = await prisma.progressComment.findMany({
    where: { libraryId: lectura.id, deletedAt: null, userId: { notIn: [...bloqueadas] } },
    select: {
      id: true,
      text: true,
      createdAt: true,
      userId: true,
      user: { select: { name: true, avatarUrl: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_COMENTARIOS_PROGRESO_VISIBLES,
  });
  const soyDueña = lectura.userId === yo;
  return {
    ok: true,
    titulo: lectura.book.title,
    soyDuena: soyDueña,
    comentarios: filas.reverse().map((c) => ({
      id: c.id,
      autor: c.user.name,
      avatarUrl: c.user.avatarUrl ?? '',
      texto: c.text,
      fecha: c.createdAt.toISOString(),
      esMio: c.userId === yo,
      puedoBorrar: c.userId === yo || soyDueña,
    })),
  };
}

export async function comentarProgreso(yo: string, libraryId: string, texto: unknown) {
  const limpio = limpiarComentarioProgreso(texto);
  if (!limpio) return { ok: false, mensaje: 'Escribe algo para comentar.' };
  if (!puedeComentar(yo)) {
    return { ok: false, mensaje: 'Vas muy rápido. Espera un momento y vuelve a intentarlo.' };
  }
  const [lectura, autor] = await Promise.all([
    lecturaAccesible(yo, libraryId),
    prisma.user.findUnique({ where: { id: yo }, select: { id: true, name: true } }),
  ]);
  if (!lectura || !autor) return { ok: false, mensaje: SIN_ACCESO };

  const hoy = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const hoyCount = await prisma.progressComment.count({
    where: { userId: yo, createdAt: { gte: hoy } },
  });
  if (hoyCount >= MAX_COMENTARIOS_PROGRESO_POR_DIA) {
    return { ok: false, mensaje: 'Hoy ya has comentado mucho. Sigue mañana 💜' };
  }

  const creado = await prisma.progressComment.create({
    data: { libraryId: lectura.id, userId: yo, text: limpio },
    select: { id: true, createdAt: true },
  });

  if (lectura.userId !== yo) {
    await notifyProgresoComentario({
      aUserId: lectura.userId,
      deNombre: autor.name,
      deUserId: yo,
      libraryId: lectura.id,
      bookId: lectura.book.id,
      bookTitle: lectura.book.title,
      texto: limpio,
    }).catch(backgroundError('progress_comment_notify_failed'));
  }
  return { ok: true, id: creado.id };
}

/// Borra (de forma suave) un comentario: puede quien lo escribió o la dueña de la lectura.
export async function borrarComentarioProgreso(yo: string, id: string) {
  const comentario = await prisma.progressComment.findUnique({
    where: { id: String(id ?? '').trim() },
    select: { id: true, userId: true, deletedAt: true, library: { select: { userId: true } } },
  });
  if (!comentario || comentario.deletedAt) return { ok: false, mensaje: 'Ese comentario ya no existe.' };
  if (comentario.userId !== yo && comentario.library.userId !== yo) {
    return { ok: false, mensaje: 'No puedes borrar este comentario.' };
  }
  await prisma.progressComment.update({ where: { id: comentario.id }, data: { deletedAt: new Date() } });
  return { ok: true };
}
