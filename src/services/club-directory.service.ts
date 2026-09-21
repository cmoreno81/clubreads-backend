/**
 * Directorio de clubes públicos: buscar y solicitar unirse a un club
 * PUBLIC sin código de invitación. A diferencia de `joinClub` (entrada
 * instantánea por código), esto pasa por aprobación de quien administra
 * el club — un `ClubJoinRequest` PENDING hasta que OWNER/ADMIN responde.
 */

import { ClubJoinRequestStatus, ClubRole, ClubVisibility } from '@prisma/client';

import { prisma } from '../prisma.js';
import { ClubContextError } from './club-context.service.js';
import {
  notifyNuevaMiembro,
  notifySolicitudIngreso,
  notifySolicitudResuelta,
} from './notifications.service.js';
import { backgroundError } from '../logging/logger.js';

const DIRECTORY_LIMIT = 30;

async function requireOwnerOrAdmin(clubId: string, userId: string) {
  const membership = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId, userId } },
  });
  if (
    !membership ||
    (membership.role !== ClubRole.OWNER && membership.role !== ClubRole.ADMIN)
  ) {
    throw new ClubContextError(
      'No tienes permiso para administrar este club',
      403,
      'INSUFFICIENT_CLUB_ROLE',
    );
  }
  return membership;
}

/** Lista de clubes PUBLIC, opcionalmente filtrada por nombre. Excluye los
 * clubes de los que `userId` ya es miembro. */
export async function listarClubesPublicos(userId: string, search?: string) {
  const texto = search?.trim();
  const clubes = await prisma.club.findMany({
    where: {
      visibility: ClubVisibility.PUBLIC,
      tipo: 'SOCIAL',
      members: { none: { userId } },
      ...(texto ? { name: { contains: texto, mode: 'insensitive' } } : {}),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      avatarUrl: true,
      _count: { select: { members: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: DIRECTORY_LIMIT,
  });

  return clubes.map((c) => ({
    clubId: c.id,
    nombre: c.name,
    slug: c.slug,
    descripcion: c.description,
    avatarUrl: c.avatarUrl,
    miembros: c._count.members,
  }));
}

/** OWNER/ADMIN: cambia la visibilidad de un club entre PUBLIC y PRIVATE. */
export async function cambiarVisibilidadClub(
  userId: string,
  clubId: string,
  visibility: ClubVisibility,
) {
  if (
    visibility !== ClubVisibility.PUBLIC &&
    visibility !== ClubVisibility.PRIVATE
  ) {
    throw new ClubContextError(
      'Visibilidad no válida',
      400,
      'INVALID_VISIBILITY',
    );
  }
  await requireOwnerOrAdmin(clubId, userId);
  const club = await prisma.club.update({
    where: { id: clubId },
    data: { visibility },
    select: { id: true, name: true, visibility: true },
  });
  return { ok: true, clubId: club.id, visibility: club.visibility };
}

/** Solicita unirse a un club PUBLIC. Reabre la solicitud si fue rechazada antes. */
export async function solicitarUnirseClub(userId: string, clubId: string) {
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club || club.visibility !== ClubVisibility.PUBLIC) {
    throw new ClubContextError(
      'Este club no admite solicitudes de ingreso',
      400,
      'CLUB_NOT_PUBLIC',
    );
  }

  const yaEsMiembro = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId, userId } },
  });
  if (yaEsMiembro) {
    throw new ClubContextError(
      'Ya eres miembro de este club',
      400,
      'ALREADY_MEMBER',
    );
  }

  const existente = await prisma.clubJoinRequest.findUnique({
    where: { clubId_userId: { clubId, userId } },
  });
  if (existente?.status === ClubJoinRequestStatus.PENDING) {
    throw new ClubContextError(
      'Ya tienes una solicitud pendiente para este club',
      400,
      'REQUEST_ALREADY_PENDING',
    );
  }

  await prisma.clubJoinRequest.upsert({
    where: { clubId_userId: { clubId, userId } },
    create: { clubId, userId, status: ClubJoinRequestStatus.PENDING },
    update: {
      status: ClubJoinRequestStatus.PENDING,
      respondedById: null,
      respondedAt: null,
    },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  if (user) {
    notifySolicitudIngreso({
      clubId,
      solicitanteNombre: user.name,
      solicitanteUserId: userId,
    }).catch(backgroundError('club_join_request_notification_failed'));
  }

  return { ok: true, clubId, estado: 'PENDING' as const };
}

/** OWNER/ADMIN: lista las solicitudes pendientes de un club. */
export async function listarSolicitudesPendientes(
  userId: string,
  clubId: string,
) {
  await requireOwnerOrAdmin(clubId, userId);
  const solicitudes = await prisma.clubJoinRequest.findMany({
    where: { clubId, status: ClubJoinRequestStatus.PENDING },
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return solicitudes.map((s) => ({
    id: s.id,
    userId: s.user.id,
    nombre: s.user.name,
    avatarUrl: s.user.avatarUrl,
    solicitadoEn: s.createdAt.toISOString(),
  }));
}

/** OWNER/ADMIN: acepta o rechaza una solicitud pendiente. */
export async function responderSolicitud(
  userId: string,
  clubId: string,
  requestId: string,
  aceptar: boolean,
) {
  await requireOwnerOrAdmin(clubId, userId);

  const solicitud = await prisma.clubJoinRequest.findUnique({
    where: { id: requestId },
  });
  if (!solicitud || solicitud.clubId !== clubId) {
    throw new ClubContextError('Solicitud no encontrada', 404, 'REQUEST_NOT_FOUND');
  }
  if (solicitud.status !== ClubJoinRequestStatus.PENDING) {
    throw new ClubContextError(
      'Esta solicitud ya se ha resuelto',
      400,
      'REQUEST_ALREADY_RESOLVED',
    );
  }

  const nuevoEstado = aceptar
    ? ClubJoinRequestStatus.ACCEPTED
    : ClubJoinRequestStatus.REJECTED;

  if (aceptar) {
    await prisma.$transaction([
      prisma.clubJoinRequest.update({
        where: { id: requestId },
        data: {
          status: nuevoEstado,
          respondedById: userId,
          respondedAt: new Date(),
        },
      }),
      prisma.clubMember.upsert({
        where: { clubId_userId: { clubId, userId: solicitud.userId } },
        create: { clubId, userId: solicitud.userId, role: ClubRole.MEMBER },
        update: {},
      }),
    ]);

    const nuevaMiembro = await prisma.user.findUnique({
      where: { id: solicitud.userId },
      select: { name: true },
    });
    if (nuevaMiembro) {
      notifyNuevaMiembro({
        clubId,
        nuevaMiembroNombre: nuevaMiembro.name,
        nuevaMiembroUserId: solicitud.userId,
      }).catch(backgroundError('new_member_notification_failed'));
    }
  } else {
    await prisma.clubJoinRequest.update({
      where: { id: requestId },
      data: {
        status: nuevoEstado,
        respondedById: userId,
        respondedAt: new Date(),
      },
    });
  }

  notifySolicitudResuelta({
    clubId,
    userId: solicitud.userId,
    aceptada: aceptar,
  }).catch(backgroundError('club_join_request_resolved_notification_failed'));

  return { ok: true, estado: nuevoEstado };
}
