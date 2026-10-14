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
  notifyLecturaAmistadEliminada,
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

  // El tope cuenta solo las que siguen en curso: las terminadas no ocupan sitio.
  const abiertas = (await cargarLecturas(userId)).filter((l) => !l.terminada).length;
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

  // No se avisa todavía: la invitación sale cuando la lectura está configurada (ver
  // `enviarInvitacionLectura`), para no invitar a algo que se queda a medias.
  return { ok: true, clubId: club.id, libro: libro.title, yaExistia: false };
}

/// Envía la invitación a la otra persona una vez configurada la lectura. Solo quien la abrió,
/// y solo una vez; si aún no hay lectura configurada, no se avisa.
export async function enviarInvitacionLectura(userId: string, clubId: string) {
  const invitacion = await prisma.friendReadingInvite.findFirst({
    where: { clubId: String(clubId ?? '').trim(), fromUserId: userId, status: FriendReadingInviteStatus.PENDING },
    include: { from: { select: { name: true } } },
  });
  if (!invitacion) return { ok: false, mensaje: YA_NO_EXISTE };
  if (invitacion.notifiedAt) return { ok: true, yaEnviada: true };
  const lecturas = await prisma.reading.count({ where: { clubId: invitacion.clubId } });
  if (lecturas === 0) return { ok: false, mensaje: 'Configura primero la lectura para poder invitar.' };

  await prisma.friendReadingInvite.update({ where: { id: invitacion.id }, data: { notifiedAt: new Date() } });
  await notifyLecturaAmistadInvitacion({
    aUserId: invitacion.toUserId,
    deNombre: invitacion.from.name,
    deUserId: userId,
    clubId: invitacion.clubId,
    bookId: invitacion.bookId,
    bookTitle: invitacion.bookTitle,
  }).catch(backgroundError('friend_reading_invite_notify_failed'));
  return { ok: true, yaEnviada: false };
}

type FilaLectura = {
  clubId: string;
  bookId: string;
  libro: string;
  con: string;
  avatarUrl: string;
  /// La otra persona aún no ha respondido a la invitación.
  esperando: boolean;
  /// La otra persona ya no está en la lectura (salió).
  salio: boolean;
  /// Quien la abrió (puede eliminarla para las dos).
  esDuena: boolean;
  /// Todas las personas que siguen en ella han terminado el libro desde que empezó.
  terminada: boolean;
};

/// Las lecturas a la vez de una persona, con su estado. La conversación nunca se borra al
/// terminar: «terminada» solo sirve para ordenarlas y no contar para el tope de abiertas.
async function cargarLecturas(userId: string): Promise<FilaLectura[]> {
  const mias = await prisma.clubMember.findMany({
    where: { userId, club: { tipo: ClubType.AMISTADES } },
    select: {
      clubId: true,
      role: true,
      club: {
        select: {
          members: { select: { userId: true } },
          friendReadingInvites: {
            select: {
              bookId: true,
              bookTitle: true,
              status: true,
              fromUserId: true,
              toUserId: true,
              createdAt: true,
              from: { select: { name: true, avatarUrl: true } },
              to: { select: { name: true, avatarUrl: true } },
            },
            take: 1,
          },
        },
      },
    },
  });

  const base = mias.flatMap((m) => {
    const inv = m.club.friendReadingInvites[0];
    if (!inv || inv.status === FriendReadingInviteStatus.DECLINED) return [];
    const yoFrom = inv.fromUserId === userId;
    const otraId = yoFrom ? inv.toUserId : inv.fromUserId;
    const otra = yoFrom ? inv.to : inv.from;
    const esperando = inv.status === FriendReadingInviteStatus.PENDING;
    const miembros = m.club.members.map((x) => x.userId);
    return [
      {
        clubId: m.clubId,
        bookId: inv.bookId,
        libro: inv.bookTitle,
        con: otra.name,
        avatarUrl: otra.avatarUrl ?? '',
        esperando,
        salio: !esperando && !miembros.includes(otraId),
        esDuena: m.role === ClubRole.OWNER,
        desde: inv.createdAt,
        participantes: miembros,
      },
    ];
  });
  if (base.length === 0) return [];

  const terminados = await prisma.readingCompletion.findMany({
    where: {
      OR: base.map((l) => ({
        bookId: l.bookId,
        userId: { in: l.participantes },
        finishedAt: { gte: l.desde },
      })),
    },
    select: { userId: true, bookId: true },
  });
  const hechos = new Set(terminados.map((t) => `${t.bookId}:${t.userId}`));

  return base.map(({ desde: _desde, participantes, ...l }) => ({
    ...l,
    terminada:
      !l.esperando && participantes.length > 0 && participantes.every((u) => hechos.has(`${l.bookId}:${u}`)),
  }));
}

/// Invitaciones recibidas y lecturas conjuntas con amistades, con su estado (en curso o terminada).
export async function getLecturasAmistades(userId: string) {
  const [recibidas, lecturas] = await Promise.all([
    prisma.friendReadingInvite.findMany({
      // Solo las ya enviadas: una lectura sin configurar todavía no es una invitación.
      where: { toUserId: userId, status: FriendReadingInviteStatus.PENDING, notifiedAt: { not: null } },
      include: { from: { select: { name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    cargarLecturas(userId),
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
    lecturas,
  };
}

/// Sale de una lectura a la vez (la conversación sigue para la otra persona) o, si [eliminar],
/// la borra para las dos (solo quien la abrió). Si no queda nadie, el espacio desaparece.
export async function salirLecturaAmistad(userId: string, clubId: string, eliminar: boolean) {
  const membresia = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId: String(clubId ?? '').trim(), userId } },
    select: {
      role: true,
      club: {
        select: {
          id: true,
          tipo: true,
          members: { select: { userId: true } },
          friendReadingInvites: { select: { bookTitle: true, status: true }, take: 1 },
        },
      },
      user: { select: { name: true } },
    },
  });
  if (!membresia || membresia.club.tipo !== ClubType.AMISTADES) return { ok: false, mensaje: YA_NO_EXISTE };

  const otros = membresia.club.members.map((m) => m.userId).filter((id) => id !== userId);
  const inv = membresia.club.friendReadingInvites[0];
  const borrarClub = (tx: any) =>
    tx.user
      .updateMany({ where: { activeClubId: membresia.club.id }, data: { activeClubId: null } })
      .then(() => tx.club.delete({ where: { id: membresia.club.id } }));

  if (eliminar) {
    if (membresia.role !== ClubRole.OWNER) {
      return { ok: false, mensaje: 'Solo quien abrió la lectura puede eliminarla para las dos personas.' };
    }
    await prisma.$transaction(async (tx) => borrarClub(tx));
    for (const otro of otros) {
      await notifyLecturaAmistadEliminada({
        aUserId: otro,
        deNombre: membresia.user.name,
        deUserId: userId,
        bookTitle: inv?.bookTitle ?? '',
      }).catch(backgroundError('friend_reading_removed_notify_failed'));
    }
    return { ok: true };
  }

  if (otros.length === 0) {
    await prisma.$transaction(async (tx) => borrarClub(tx));
    return { ok: true };
  }

  await prisma.$transaction(async (tx) => {
    if (membresia.role === ClubRole.OWNER) {
      await tx.club.update({ where: { id: membresia.club.id }, data: { ownerId: otros[0]! } });
      await tx.clubMember.update({
        where: { clubId_userId: { clubId: membresia.club.id, userId: otros[0]! } },
        data: { role: ClubRole.OWNER },
      });
    }
    await tx.clubMember.delete({ where: { clubId_userId: { clubId: membresia.club.id, userId } } });
    await tx.user.updateMany({ where: { id: userId, activeClubId: membresia.club.id }, data: { activeClubId: null } });
  });
  return { ok: true };
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

/// Al bloquear a alguien: deja de tener acceso a las lecturas a la vez que compartía con quien
/// bloquea. Sale de ellas (la propiedad pasa a quien bloquea) y quien bloquea conserva la conversación.
/// Las invitaciones aún sin aceptar entre las dos personas se retiran, para que no puedan aceptarse.
/// Quitar la amistad, en cambio, no toca nada: las lecturas se quedan.
export async function apartarPorBloqueo(bloquea: string, bloqueada: string) {
  const invitaciones = await prisma.friendReadingInvite.findMany({
    where: {
      OR: [
        { fromUserId: bloquea, toUserId: bloqueada },
        { fromUserId: bloqueada, toUserId: bloquea },
      ],
      status: { not: FriendReadingInviteStatus.DECLINED },
    },
    select: { clubId: true, status: true, club: { select: { ownerId: true } } },
  });
  for (const inv of invitaciones) {
    await prisma.$transaction(async (tx) => {
      if (inv.status === FriendReadingInviteStatus.PENDING) {
        // Sin aceptar: se retira la invitación y el espacio vacío.
        await tx.user.updateMany({ where: { activeClubId: inv.clubId }, data: { activeClubId: null } });
        await tx.club.delete({ where: { id: inv.clubId } });
        return;
      }
      if (inv.club.ownerId === bloqueada) {
        await tx.club.update({ where: { id: inv.clubId }, data: { ownerId: bloquea } });
        await tx.clubMember.updateMany({
          where: { clubId: inv.clubId, userId: bloquea },
          data: { role: ClubRole.OWNER },
        });
      }
      await tx.clubMember.deleteMany({ where: { clubId: inv.clubId, userId: bloqueada } });
      await tx.user.updateMany({
        where: { id: bloqueada, activeClubId: inv.clubId },
        data: { activeClubId: null },
      });
    });
  }
}
