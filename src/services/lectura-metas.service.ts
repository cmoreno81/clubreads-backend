import { NotificationType, Prisma, ReadingSessionStatus } from '@prisma/client';

import { prisma } from '../prisma.js';
import { backgroundError } from '../logging/logger.js';
import { requireClubMember } from './club-context.service.js';
import { fechaMadrid, sumarDias, textoRango } from './lectura-metas-core.service.js';
import {
  bookFilterForLectura,
  participantesDeLectura,
} from './readings.service.js';

export const MAX_INVITADAS = 50;

async function crearAvisos(
  userIds: string[],
  tipo: NotificationType,
  titulo: string,
  mensaje: string,
  datos: { clubId: string; bookId: string; extra: Record<string, unknown> },
) {
  if (userIds.length === 0) return 0;
  const desactivados = await prisma.user.findMany({
    where: { id: { in: userIds }, notificationsDisabled: { has: tipo } },
    select: { id: true },
  });
  const sin = new Set(desactivados.map((u) => u.id));
  const destino = userIds.filter((id) => !sin.has(id));
  if (destino.length === 0) return 0;
  await prisma.notification.createMany({
    data: destino.map((userId) => ({
      userId,
      tipo,
      titulo,
      mensaje,
      clubId: datos.clubId,
      bookId: datos.bookId,
      extra: JSON.stringify(datos.extra),
    })),
  });
  return destino.length;
}

/// Avisos de las metas: el día antes y el mismo día, siempre en positivo
/// (nunca se avisa de «retrasos»). Idempotente: cada aviso se marca al enviarlo.
export async function enviarAvisosMetas(ahora = new Date()) {
  const hoy = fechaMadrid(ahora);
  const manana = sumarDias(hoy, 1);
  const metas = await prisma.readingGoal.findMany({
    where: {
      reading: { status: ReadingSessionStatus.ACTIVE },
      OR: [
        { dueDate: new Date(`${manana}T00:00:00.000Z`), remindedDayBeforeAt: null },
        { dueDate: new Date(`${hoy}T00:00:00.000Z`), remindedTodayAt: null },
      ],
    },
    include: {
      reading: {
        select: {
          id: true,
          clubId: true,
          bookId: true,
          startedAt: true,
          book: { select: { title: true } },
          goals: { select: { upToChapter: true }, orderBy: { upToChapter: 'asc' } },
        },
      },
    },
  });

  let enviados = 0;
  for (const meta of metas) {
    const { reading } = meta;
    const fecha = meta.dueDate.toISOString().slice(0, 10);
    const esManana = fecha === manana;
    const anteriores = reading.goals
      .map((g) => g.upToChapter)
      .filter((n) => n < meta.upToChapter);
    const desde = (anteriores.length ? Math.max(...anteriores) : 0) + 1;
    const rango = textoRango(desde, meta.upToChapter);
    const participantes = await participantesDeLectura(
      reading.clubId,
      reading.bookId,
      reading.startedAt,
    );
    const titulo = esManana
      ? `📖 Mañana comentamos "${reading.book.title}"`
      : `💬 Hoy comentamos "${reading.book.title}"`;
    const mensaje = esManana
      ? `Toca comentar ${rango}. ¡Cuéntanos qué te va pareciendo!`
      : `Hoy es el día de comentar ${rango}. ¡Estamos deseando saber qué piensas!`;
    enviados += await crearAvisos(
      participantes,
      esManana
        ? NotificationType.LECTURA_META_PROXIMA
        : NotificationType.LECTURA_META_HOY,
      titulo,
      mensaje,
      {
        clubId: reading.clubId,
        bookId: reading.bookId,
        extra: {
          bookTitle: reading.book.title,
          readingId: reading.id,
          capitulo: meta.upToChapter,
        },
      },
    );
    await prisma.readingGoal.update({
      where: { id: meta.id },
      data: esManana
        ? { remindedDayBeforeAt: ahora }
        : { remindedTodayAt: ahora },
    });
  }
  return { metas: metas.length, avisos: enviados };
}

/// Invita a miembros del propio club a una lectura conjunta activa. Solo se
/// avisa a quien aún no la está leyendo y no ha sido invitada hace poco.
export async function invitarALectura(data: {
  usuario?: string;
  libro: string;
  usuarios: string[];
}) {
  const { club, user } = await requireClubMember(data.usuario);
  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };
  const titulo = String(data.libro || '').trim();
  if (!titulo) return { ok: false, mensaje: 'Falta el libro' };
  const ids = [...new Set((data.usuarios ?? []).map(String).filter(Boolean))];
  if (ids.length === 0) return { ok: false, mensaje: 'Elige a quién invitar.' };
  if (ids.length > MAX_INVITADAS) {
    return { ok: false, mensaje: `Como máximo ${MAX_INVITADAS} personas a la vez.` };
  }

  const reading = await prisma.reading.findFirst({
    where: {
      book: await bookFilterForLectura(titulo),
      clubId: club.id,
      status: ReadingSessionStatus.ACTIVE,
    },
    select: { id: true, bookId: true, startedAt: true, book: { select: { title: true } } },
  });
  if (!reading) {
    return { ok: false, mensaje: 'No hay una lectura activa para este libro.' };
  }

  // Solo miembros del mismo club, y no una misma.
  const miembros = await prisma.clubMember.findMany({
    where: { clubId: club.id, userId: { in: ids, not: user.id } },
    select: { userId: true },
  });
  const validos = miembros.map((m) => m.userId);
  const yaLeen = new Set(
    await participantesDeLectura(club.id, reading.bookId, reading.startedAt),
  );
  const hace7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recientes = await prisma.notification.findMany({
    where: {
      tipo: NotificationType.LECTURA_INVITACION,
      userId: { in: validos },
      bookId: reading.bookId,
      createdAt: { gte: hace7 },
      extra: { contains: `"de":"${user.id}"` },
    },
    select: { userId: true },
  });
  const yaInvitadas = new Set(recientes.map((n) => n.userId));
  const destino = validos.filter((id) => !yaLeen.has(id) && !yaInvitadas.has(id));

  const enviadas = await crearAvisos(
    destino,
    NotificationType.LECTURA_INVITACION,
    '💌 Te invitan a una lectura conjunta',
    `${user.name} te invita a leer "${reading.book.title}" en ${club.name}. ¡Te esperamos! 💜`,
    {
      clubId: club.id,
      bookId: reading.bookId,
      extra: { bookTitle: reading.book.title, readingId: reading.id, de: user.id },
    },
  ).catch((error) => {
    backgroundError('reading_invite_failed')(error);
    return 0;
  });

  return {
    ok: true,
    invitadas: enviadas,
    yaLeyendo: validos.filter((id) => yaLeen.has(id)).length,
  };
}
