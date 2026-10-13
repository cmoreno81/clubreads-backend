import { randomBytes } from 'node:crypto';

import {
  ClubRole,
  ClubType,
  FriendReadingInviteStatus,
  FriendshipStatus,
} from '@prisma/client';

import { prisma } from '../prisma.js';
import { backgroundError } from '../logging/logger.js';
import {
  notifyLecturaAmistadAceptada,
  notifyLecturaAmistadInvitacion,
} from './notifications.service.js';
import {
  MAX_LECTURAS_AMISTADES_ABIERTAS,
  MAX_PERSONAS_LECTURA_AMISTADES,
} from './amistades-core.js';

const YA_NO_EXISTE = 'Esa lectura ya no existe.';

/// Crea una lectura conjunta privada con una amistad: un club de tipo AMISTADES
/// (solo vosotras dos y un libro) y la invitación pendiente. La lectura en sí
/// (capítulos, metas) la configura quien invita con el flujo normal.
export async function crearLecturaConAmistad(
  userId: string,
  data: { bookId: string; nombre: string },
) {
  const nombre = String(data.nombre ?? '').trim();
  if (!nombre) return { ok: false, mensaje: 'Elige con qué amistad quieres leer.' };

  const [yo, libro] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } }),
    prisma.book.findFirst({
      where: { id: String(data.bookId ?? '').trim(), deletedAt: null },
      select: { id: true, title: true },
    }),
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
  const amistad = filas
    .map((f) => (f.requesterId === userId ? f.addressee : f.requester))
    .find((a) => a.name.toLocaleLowerCase('es') === nombre.toLocaleLowerCase('es'));
  if (!amistad) return { ok: false, mensaje: 'Solo puedes leer a la vez con tus amistades.' };

  // Si ya hay una lectura de este libro entre las dos, se vuelve a ella.
  const existente = await prisma.friendReadingInvite.findFirst({
    where: {
      bookId: libro.id,
      status: { in: [FriendReadingInviteStatus.PENDING, FriendReadingInviteStatus.ACCEPTED] },
      OR: [
        { fromUserId: userId, toUserId: amistad.id },
        { fromUserId: amistad.id, toUserId: userId },
      ],
    },
    select: { clubId: true },
  });
  if (existente) return { ok: true, clubId: existente.clubId, libro: libro.title, yaExistia: true };

  const abiertas = await prisma.clubMember.count({
    where: { userId, club: { tipo: ClubType.AMISTADES } },
  });
  if (abiertas >= MAX_LECTURAS_AMISTADES_ABIERTAS) {
    return {
      ok: false,
      mensaje: `Ya tienes ${MAX_LECTURAS_AMISTADES_ABIERTAS} lecturas con amistades abiertas. Termina o sal de alguna para empezar otra.`,
    };
  }

  const club = await prisma.$transaction(async (tx) => {
    const creado = await tx.club.create({
      data: {
        name: `${libro.title} · ${yo.name} y ${amistad.name}`.slice(0, 80),
        slug: `lectura-${randomBytes(6).toString('hex')}`,
        tipo: ClubType.AMISTADES,
        visibility: 'PRIVATE',
        ownerId: userId,
        members: { create: { userId, role: ClubRole.OWNER } },
      },
      select: { id: true },
    });
    await tx.friendReadingInvite.create({
      data: {
        clubId: creado.id,
        fromUserId: userId,
        toUserId: amistad.id,
        bookId: libro.id,
        bookTitle: libro.title,
      },
    });
    return creado;
  });

  await notifyLecturaAmistadInvitacion({
    aUserId: amistad.id,
    deNombre: yo.name,
    deUserId: yo.id,
    clubId: club.id,
    bookId: libro.id,
    bookTitle: libro.title,
  }).catch(backgroundError('friend_reading_invite_notify_failed'));

  return { ok: true, clubId: club.id, libro: libro.title, yaExistia: false };
}

/// Invitaciones recibidas y lecturas conjuntas con amistades (también las que esperan respuesta).
export async function getLecturasAmistades(userId: string) {
  const [recibidas, mias] = await Promise.all([
    prisma.friendReadingInvite.findMany({
      where: { toUserId: userId, status: FriendReadingInviteStatus.PENDING },
      include: { from: { select: { name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.clubMember.findMany({
      where: { userId, club: { tipo: ClubType.AMISTADES } },
      select: {
        clubId: true,
        club: {
          select: {
            friendReadingInvites: {
              select: {
                bookId: true,
                bookTitle: true,
                status: true,
                fromUserId: true,
                from: { select: { name: true, avatarUrl: true } },
                to: { select: { name: true, avatarUrl: true } },
              },
              take: 1,
            },
          },
        },
      },
    }),
  ]);

  return {
    ok: true,
    recibidas: recibidas.map((i) => ({
      clubId: i.clubId,
      bookId: i.bookId,
      libro: i.bookTitle,
      de: i.from.name,
      avatarUrl: i.from.avatarUrl ?? '',
    })),
    lecturas: mias.flatMap((m) => {
      const inv = m.club.friendReadingInvites[0];
      if (!inv || inv.status === FriendReadingInviteStatus.DECLINED) return [];
      const otra = inv.fromUserId === userId ? inv.to : inv.from;
      return [
        {
          clubId: m.clubId,
          bookId: inv.bookId,
          libro: inv.bookTitle,
          con: otra.name,
          avatarUrl: otra.avatarUrl ?? '',
          esperando: inv.status === FriendReadingInviteStatus.PENDING,
        },
      ];
    }),
  };
}

/// Acepta o rechaza una invitación a leer a la vez. Rechazar no avisa a nadie.
export async function responderLecturaAmistad(userId: string, clubId: string, aceptar: boolean) {
  const invitacion = await prisma.friendReadingInvite.findFirst({
    where: { clubId: String(clubId ?? '').trim(), toUserId: userId, status: FriendReadingInviteStatus.PENDING },
    include: { from: { select: { id: true } }, to: { select: { name: true } } },
  });
  if (!invitacion) return { ok: false, mensaje: YA_NO_EXISTE };

  if (!aceptar) {
    await prisma.friendReadingInvite.update({
      where: { id: invitacion.id },
      data: { status: FriendReadingInviteStatus.DECLINED, respondedAt: new Date() },
    });
    // Si aún no se había configurado la lectura, el club vacío se retira.
    const lecturas = await prisma.reading.count({ where: { clubId: invitacion.clubId } });
    if (lecturas === 0) {
      await prisma.$transaction(async (tx) => {
        await tx.user.updateMany({ where: { activeClubId: invitacion.clubId }, data: { activeClubId: null } });
        await tx.club.delete({ where: { id: invitacion.clubId } });
      });
    }
    return { ok: true, aceptada: false };
  }

  const miembros = await prisma.clubMember.count({ where: { clubId: invitacion.clubId } });
  if (miembros >= MAX_PERSONAS_LECTURA_AMISTADES) return { ok: false, mensaje: YA_NO_EXISTE };

  await prisma.$transaction(async (tx) => {
    await tx.clubMember.create({ data: { clubId: invitacion.clubId, userId, role: ClubRole.MEMBER } });
    await tx.friendReadingInvite.update({
      where: { id: invitacion.id },
      data: { status: FriendReadingInviteStatus.ACCEPTED, respondedAt: new Date() },
    });
  });

  await notifyLecturaAmistadAceptada({
    aUserId: invitacion.from.id,
    deNombre: invitacion.to.name,
    deUserId: userId,
    clubId: invitacion.clubId,
    bookId: invitacion.bookId,
    bookTitle: invitacion.bookTitle,
  }).catch(backgroundError('friend_reading_accept_notify_failed'));

  return { ok: true, aceptada: true, clubId: invitacion.clubId, libro: invitacion.bookTitle };
}
