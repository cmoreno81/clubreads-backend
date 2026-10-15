import { FriendshipStatus, NotificationType, ReadingStatus } from '@prisma/client';

import { prisma } from '../prisma.js';
import { backgroundError } from '../logging/logger.js';
import { notifyLibroRecomendado } from './notifications.service.js';
import { amistadesQueComparten } from './amistades-ver.service.js';
import {
  MAX_RECOMENDACIONES_POR_DIA,
  MAX_RECOMENDADAS_POR_LLAMADA,
  limpiarMensajeRecomendacion,
} from './amistades-core.js';

const DIAS_SIN_REPETIR = 30;

/// Recomienda un libro a amistades (o las invita a leerlo juntas). Solo llega
/// a amistades aceptadas, no se repite la misma recomendación en 30 días y hay
/// un tope diario para que no sirva para molestar.
export async function recomendarLibro(
  userId: string,
  data: { bookId: string; nombres: string[]; mensaje?: unknown; juntas?: boolean },
) {
  const nombres = [...new Set((data.nombres ?? []).map((n) => String(n).trim()).filter(Boolean))];
  if (nombres.length === 0) return { ok: false, mensaje: 'Elige a quién quieres recomendárselo.' };
  if (nombres.length > MAX_RECOMENDADAS_POR_LLAMADA) {
    return {
      ok: false,
      mensaje: `Como máximo ${MAX_RECOMENDADAS_POR_LLAMADA} personas a la vez.`,
    };
  }

  const [yo, libro] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } }),
    prisma.book.findUnique({ where: { id: data.bookId }, select: { id: true, title: true } }),
  ]);
  if (!yo) return { ok: false, mensaje: 'Usuaria no encontrada' };
  if (!libro) return { ok: false, mensaje: 'No encontramos ese libro.' };

  const filas = await prisma.friendship.findMany({
    where: {
      status: FriendshipStatus.ACCEPTED,
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    include: {
      requester: { select: { id: true, name: true } },
      addressee: { select: { id: true, name: true } },
    },
  });
  const amistades = filas.map((f) => (f.requesterId === userId ? f.addressee : f.requester));
  const pedidos = new Set(nombres.map((n) => n.toLocaleLowerCase('es')));
  const destino = amistades.filter((a) => pedidos.has(a.name.toLocaleLowerCase('es')));
  if (destino.length === 0) return { ok: false, mensaje: 'Solo puedes recomendar a tus amigos.' };

  const marcaDe = `"de":"${userId}"`;
  const hoy = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const hace30 = new Date(Date.now() - DIAS_SIN_REPETIR * 24 * 60 * 60 * 1000);
  const [enviadasHoy, previas] = await Promise.all([
    prisma.notification.count({
      where: {
        tipo: NotificationType.LIBRO_RECOMENDADO,
        createdAt: { gte: hoy },
        extra: { contains: marcaDe },
      },
    }),
    prisma.notification.findMany({
      where: {
        tipo: NotificationType.LIBRO_RECOMENDADO,
        bookId: libro.id,
        userId: { in: destino.map((d) => d.id) },
        createdAt: { gte: hace30 },
        extra: { contains: marcaDe },
      },
      select: { userId: true },
    }),
  ]);
  const yaAvisadas = new Set(previas.map((n) => n.userId));
  const nuevas = destino.filter((d) => !yaAvisadas.has(d.id));
  if (enviadasHoy + nuevas.length > MAX_RECOMENDACIONES_POR_DIA) {
    return { ok: false, mensaje: 'Hoy ya has enviado muchas recomendaciones. Sigue mañana 💜' };
  }

  const mensajePersonal = limpiarMensajeRecomendacion(data.mensaje);
  let enviadas = 0;
  for (const amistad of nuevas) {
    try {
      await notifyLibroRecomendado({
        aUserId: amistad.id,
        deNombre: yo.name,
        deUserId: yo.id,
        bookId: libro.id,
        bookTitle: libro.title,
        mensajePersonal,
        juntas: data.juntas === true,
      });
      enviadas++;
    } catch (error) {
      backgroundError('book_recommendation_failed')(error);
    }
  }
  return { ok: true, enviadas, yaRecomendado: destino.length - nuevas.length };
}

export type OpcionRecomendar = {
  bookId: string;
  titulo: string;
  coverUrl: string;
  nota: number;
  leido: boolean;
};

/// Primero lo leído (de mayor a menor nota) y después lo pendiente, por título.
export function ordenarOpcionesRecomendar(opciones: OpcionRecomendar[]): OpcionRecomendar[] {
  return [...opciones].sort((a, b) => {
    if (a.leido !== b.leido) return a.leido ? -1 : 1;
    if (a.nota !== b.nota) return b.nota - a.nota;
    return a.titulo.localeCompare(b.titulo, 'es');
  });
}

/// Tus libros recomendables a una amistad: tus leídos (por nota) y tus pendientes,
/// sin los que ella ya ha leído o está leyendo —solo si lo comparte—. Sus
/// pendientes sí se mantienen. Va por tu identificador, nunca por el nombre.
export async function getLibrosParaRecomendar(yo: string, nombre: string) {
  const amistades = await amistadesQueComparten(yo);
  const amiga = amistades.find((a) => a.name.toLowerCase() === String(nombre ?? '').trim().toLowerCase());
  if (!amiga) return { ok: false, mensaje: 'Solo puedes recomendar a una amistad.', items: [] };

  const [mios, suyos] = await Promise.all([
    prisma.library.findMany({
      where: {
        userId: yo,
        status: { in: [ReadingStatus.FINISHED, ReadingStatus.PENDING] },
        book: { deletedAt: null },
      },
      select: { bookId: true, status: true, book: { select: { title: true, coverUrl: true } } },
    }),
    prisma.library.findMany({
      where: {
        userId: amiga.id,
        book: { deletedAt: null },
        OR: [
          ...(amiga.friendsSeeLibrary ? [{ status: ReadingStatus.FINISHED }] : []),
          ...(amiga.friendsSeeReading ? [{ status: { in: [ReadingStatus.READING, ReadingStatus.REREADING] } }] : []),
        ],
      },
      select: { bookId: true },
    }),
  ]);
  const yaConoce = new Set(suyos.map((f) => f.bookId));
  const terminados = mios.filter((m) => m.status === ReadingStatus.FINISHED).map((m) => m.bookId);
  const notas = terminados.length
    ? await prisma.review.findMany({
        where: { userId: yo, bookId: { in: terminados }, deletedAt: null },
        select: { bookId: true, rating: true },
      })
    : [];
  const notaDe = new Map(notas.map((n) => [n.bookId, n.rating]));
  const items = ordenarOpcionesRecomendar(
    mios
      .filter((m) => !yaConoce.has(m.bookId))
      .map((m) => ({
        bookId: m.bookId,
        titulo: m.book.title,
        coverUrl: m.book.coverUrl ?? '',
        nota: notaDe.get(m.bookId) ?? 0,
        leido: m.status === ReadingStatus.FINISHED,
      })),
  );
  return { ok: true, items };
}
