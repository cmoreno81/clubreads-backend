import { Prisma } from '@prisma/client';

import { prisma } from '../prisma.js';
import { amistadesQueComparten } from './amistades-ver.service.js';
import { MAX_REGALOS_RESERVADOS } from './amistades-core.js';

/// «Yo lo regalo»: reserva (o quita la reserva de) un libro de la lista de deseos de una
/// amistad. Solo amistades que comparten su lista; un libro solo lo reserva una persona
/// y la dueña de la lista no recibe ningún aviso (es una sorpresa).
export async function reservarRegalo(yo: string, itemId: string, reservar: boolean) {
  const item = await prisma.wishlistItem.findUnique({
    where: { id: String(itemId ?? '').trim() },
    select: { id: true, userId: true, purchasedAt: true, reservation: { select: { reservedById: true } } },
  });
  if (!item || item.userId === yo) return { ok: false, mensaje: 'Ese libro ya no está en la lista.' };

  // Quitar tu propia reserva siempre se puede, aunque ya no seáis amistades o haya dejado de compartir la lista.
  if (!reservar) {
    if (item.reservation?.reservedById !== yo) return { ok: true }; // nada que deshacer
    await prisma.wishlistReservation.deleteMany({ where: { wishlistItemId: item.id, reservedById: yo } });
    return { ok: true };
  }

  const amistades = await amistadesQueComparten(yo);
  const duena = amistades.find((a) => a.id === item.userId);
  if (!duena?.friendsSeeWishlist) return { ok: false, mensaje: 'No puedes ver esa lista de deseos.' };

  if (item.purchasedAt) return { ok: false, mensaje: 'Ese libro ya no está en la lista.' };
  if (item.reservation) {
    return item.reservation.reservedById === yo
      ? { ok: true }
      : { ok: false, mensaje: 'Otro amigo ya lo ha reservado 🎁' };
  }
  const abiertas = await prisma.wishlistReservation.count({ where: { reservedById: yo } });
  if (abiertas >= MAX_REGALOS_RESERVADOS) {
    return { ok: false, mensaje: `Ya tienes ${MAX_REGALOS_RESERVADOS} regalos reservados.` };
  }
  try {
    await prisma.wishlistReservation.create({ data: { wishlistItemId: item.id, reservedById: yo } });
  } catch (error) {
    // Dos personas a la vez: gana la primera.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, mensaje: 'Otro amigo ya lo ha reservado 🎁' };
    }
    throw error;
  }
  return { ok: true };
}

/// Cuando se acaba una amistad (quitarla o bloquear), se liberan las reservas de regalo que
/// había entre las dos personas, en los dos sentidos. Si no, un libro quedaría «reservado»
/// para siempre por alguien que ya no puede verlo ni deshacerlo.
export async function liberarReservasEntre(a: string, b: string) {
  await prisma.wishlistReservation.deleteMany({
    where: {
      OR: [
        { reservedById: a, wishlistItem: { userId: b } },
        { reservedById: b, wishlistItem: { userId: a } },
      ],
    },
  });
}
