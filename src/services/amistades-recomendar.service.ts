import { FriendshipStatus, NotificationType } from '@prisma/client';

import { prisma } from '../prisma.js';
import { backgroundError } from '../logging/logger.js';
import { notifyLibroRecomendado } from './notifications.service.js';
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
