import { NotificationType, ReadingStatus } from '@prisma/client';

import { prisma } from '../prisma.js';
import { contarReaccionesProgreso } from '../utils/reacciones.utils.js';
import { backgroundError } from '../logging/logger.js';
import { amistadesQueComparten } from './amistades-ver.service.js';
import { createNotification } from './notifications.service.js';

const DIAS_FEED = 30;
const MAX_FEED = 40;
const MAX_RESENA_FEED = 160;

type Persona = Awaited<ReturnType<typeof amistadesQueComparten>>[number];

/// Recorta una reseña para enseñarla en el feed (sin partir palabras).
export function resumenResena(texto: string | null | undefined, max = MAX_RESENA_FEED): string {
  const limpio = (texto ?? '').replace(/\s+/g, ' ').trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max - 1);
  const espacio = corte.lastIndexOf(' ');
  return `${(espacio > max * 0.6 ? corte.slice(0, espacio) : corte).trimEnd()}…`;
}

/// Lo que hacen tus amistades, más reciente primero: quién ha empezado un libro y
/// quién lo ha terminado (con su nota y un trozo de su reseña si la comparte y no
/// cuenta el final). Solo de amistades que dejan ver lo que leen. Cada evento lleva
/// el `libraryId`, así que se puede reaccionar y comentar con lo que ya existe.
export async function getFeedAmistades(yo: string) {
  const amistades = (await amistadesQueComparten(yo)).filter((a) => a.friendsSeeReading);
  if (amistades.length === 0) return { ok: true, items: [] };
  const porId = new Map<string, Persona>(amistades.map((a) => [a.id, a]));
  const ids = amistades.map((a) => a.id);
  const desde = new Date(Date.now() - DIAS_FEED * 24 * 60 * 60 * 1000);

  const filas = await prisma.library.findMany({
    where: {
      userId: { in: ids },
      book: { deletedAt: null },
      OR: [
        { status: { in: [ReadingStatus.READING, ReadingStatus.REREADING] }, startedAt: { gte: desde } },
        { status: ReadingStatus.FINISHED, finishedAt: { gte: desde } },
      ],
    },
    select: {
      id: true,
      userId: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      lastProgress: true,
      book: { select: { id: true, title: true, coverUrl: true, author: { select: { name: true } } } },
    },
    take: MAX_FEED * 2,
  });

  const terminadas = filas.filter((f) => f.status === ReadingStatus.FINISHED);
  const resenas = terminadas.length
    ? await prisma.review.findMany({
        where: {
          deletedAt: null,
          OR: terminadas.map((f) => ({ userId: f.userId, bookId: f.book.id })),
        },
        select: { userId: true, bookId: true, rating: true, review: true, containsSpoilers: true },
      })
    : [];
  const resenaDe = new Map(resenas.map((r) => [`${r.userId}:${r.bookId}`, r]));

  const libraryIds = filas.map((f) => f.id);
  const [reacciones, comentarios] = await Promise.all([
    prisma.progressReaction.findMany({
      where: { libraryId: { in: libraryIds } },
      select: { libraryId: true, userId: true, reaction: true },
    }),
    prisma.progressComment.groupBy({
      by: ['libraryId'],
      where: { libraryId: { in: libraryIds }, deletedAt: null },
      _count: { _all: true },
    }),
  ]);
  const comentariosDe = new Map(comentarios.map((c) => [c.libraryId, c._count._all]));

  const items = filas
    .map((f) => {
      const persona = porId.get(f.userId)!;
      const termino = f.status === ReadingStatus.FINISHED;
      const fecha = (termino ? f.finishedAt : f.startedAt) ?? new Date(0);
      const resena = termino ? resenaDe.get(`${f.userId}:${f.book.id}`) : undefined;
      const veResena = persona.friendsSeeReviews && resena;
      const deEsta = reacciones.filter((r) => r.libraryId === f.id);
      return {
        tipo: termino ? 'TERMINO' : f.status === ReadingStatus.REREADING ? 'RELEE' : 'EMPEZO',
        nombre: persona.name,
        avatarUrl: persona.avatarUrl ?? '',
        libraryId: f.id,
        bookId: f.book.id,
        titulo: f.book.title,
        autor: f.book.author?.name ?? '',
        coverUrl: f.book.coverUrl ?? '',
        fecha: fecha.toISOString(),
        valoracion: veResena ? resena.rating : null,
        // Con spoilers, el texto nunca sale (igual que en el perfil).
        resena: veResena && !resena.containsSpoilers ? resumenResena(resena.review) : '',
        contieneSpoilers: !!(veResena && resena.containsSpoilers && resena.review),
        reacciones: contarReaccionesProgreso(deEsta),
        miReaccion: deEsta.find((r) => r.userId === yo)?.reaction ?? null,
        comentarios: comentariosDe.get(f.id) ?? 0,
      };
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, MAX_FEED);
  return { ok: true, items };
}

/// Avisa a quien está leyendo ahora el mismo libro de que una amistad lo ha terminado.
/// Solo si la persona que termina deja ver lo que lee y la otra es su amistad aceptada
/// (y no hay bloqueo entre ellas).
export async function notificarAmistadesLibroTerminado(datos: {
  userId: string;
  nombre: string;
  bookId: string;
  bookTitle: string;
}) {
  const yo = await prisma.user.findUnique({
    where: { id: datos.userId },
    select: { friendsSeeReading: true },
  });
  if (!yo?.friendsSeeReading) return 0;
  const amistades = await amistadesQueComparten(datos.userId);
  if (amistades.length === 0) return 0;
  const leyendo = await prisma.library.findMany({
    where: {
      bookId: datos.bookId,
      userId: { in: amistades.map((a) => a.id) },
      status: { in: [ReadingStatus.READING, ReadingStatus.REREADING] },
    },
    select: { userId: true },
  });
  for (const { userId } of leyendo) {
    await createNotification({
      userId,
      tipo: NotificationType.AMISTAD_LIBRO_TERMINADO,
      titulo: '🎉 Tu amigo ha terminado tu lectura',
      mensaje: `${datos.nombre} ha terminado «${datos.bookTitle}», el libro que estás leyendo`,
      bookId: datos.bookId,
      extra: { de: datos.userId, nombre: datos.nombre, bookTitle: datos.bookTitle },
    }).catch(backgroundError('amistad_libro_terminado_notify_failed'));
  }
  return leyendo.length;
}

