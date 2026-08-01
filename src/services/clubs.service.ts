import { randomBytes } from 'node:crypto';
import { ClubRole } from '@prisma/client';

import { prisma } from '../prisma.js';
import { ClubContextError } from './club-context.service.js';
import { subirAvatarDesdeBase64, subirAvatarDesdeUrl } from './cloudinary.service.js';

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function slugBase(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'club';
}

function inviteCode() {
  return randomBytes(6).toString('base64url').toUpperCase();
}

export async function listMyClubs(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      activeClubId: true,
      clubMemberships: {
        orderBy: { joinedAt: 'asc' },
        include: {
          club: {
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
  });
  if (!user) {
    throw new ClubContextError('Cuenta no encontrada', 404, 'USER_NOT_FOUND');
  }
  return {
    ok: true,
    activeClubId: user.activeClubId,
    clubs: user.clubMemberships.map(({ club, role }) => ({
      id: club.id,
      nombre: club.name,
      slug: club.slug,
      descripcion: club.description ?? '',
      avatarUrl: club.avatarUrl ?? '',
      rol: role,
      activo: club.id === user.activeClubId,
    })),
  };
}

export async function createClub(
  userId: string,
  nameValue: string,
  descriptionValue: string,
) {
  const name = normalizeName(nameValue);
  const description = descriptionValue.trim();
  if (name.length < 3 || name.length > 80) {
    throw new ClubContextError(
      'El nombre del club debe tener entre 3 y 80 caracteres',
      400,
      'INVALID_CLUB_NAME',
    );
  }
  if (description.length > 500) {
    throw new ClubContextError(
      'La descripción no puede superar 500 caracteres',
      400,
      'INVALID_CLUB_DESCRIPTION',
    );
  }

  const base = slugBase(name);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug =
      attempt === 0
        ? base
        : `${base}-${randomBytes(3).toString('hex')}`;
    try {
      const club = await prisma.$transaction(async (tx) => {
        const created = await tx.club.create({
          data: {
            name,
            slug,
            description: description || null,
            ownerId: userId,
            inviteCode: inviteCode(),
            members: {
              create: { userId, role: ClubRole.OWNER },
            },
          },
        });
        await tx.user.update({
          where: { id: userId },
          data: { activeClubId: created.id },
        });
        return created;
      });
      return {
        ok: true,
        club: {
          id: club.id,
          nombre: club.name,
          slug: club.slug,
          descripcion: club.description ?? '',
          rol: ClubRole.OWNER,
          activo: true,
        },
      };
    } catch (error: unknown) {
      if (attempt === 4) throw error;
    }
  }
  throw new ClubContextError(
    'No se ha podido crear el club',
    500,
    'CLUB_CREATION_FAILED',
  );
}

export async function joinClub(userId: string, codeValue: string) {
  const code = codeValue.trim().toUpperCase();
  if (!code) {
    throw new ClubContextError(
      'Escribe un código de invitación',
      400,
      'INVITE_CODE_REQUIRED',
    );
  }
  const club = await prisma.club.findFirst({
    where: { inviteCode: { equals: code, mode: 'insensitive' } },
  });
  if (!club) {
    throw new ClubContextError(
      'La invitación no existe o ya no es válida',
      400,
      'INVALID_INVITE_CODE',
    );
  }
  await prisma.$transaction([
    prisma.clubMember.upsert({
      where: { clubId_userId: { clubId: club.id, userId } },
      create: { clubId: club.id, userId, role: ClubRole.MEMBER },
      update: {},
    }),
    prisma.user.update({
      where: { id: userId },
      data: { activeClubId: club.id },
    }),
  ]);
  return { ok: true, clubId: club.id, nombre: club.name };
}

export async function selectClub(userId: string, clubId: string) {
  const membership = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId: clubId.trim(), userId } },
  });
  if (!membership) {
    throw new ClubContextError(
      'No perteneces a ese club',
      403,
      'NOT_CLUB_MEMBER',
    );
  }
  await prisma.user.update({
    where: { id: userId },
    data: { activeClubId: membership.clubId },
  });
  return { ok: true, activeClubId: membership.clubId };
}

export async function getInvite(userId: string, clubIdValue: string) {
  const clubId = clubIdValue.trim();
  const membership = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId, userId } },
    include: { club: true },
  });
  if (
    !membership ||
    (membership.role !== ClubRole.OWNER &&
      membership.role !== ClubRole.ADMIN)
  ) {
    throw new ClubContextError(
      'No tienes permiso para invitar a este club',
      403,
      'INSUFFICIENT_CLUB_ROLE',
    );
  }
  const code = membership.club.inviteCode ?? inviteCode();
  if (!membership.club.inviteCode) {
    await prisma.club.update({
      where: { id: clubId },
      data: { inviteCode: code },
    });
  }
  return { ok: true, codigo: code, clubId, nombre: membership.club.name };
}

// ─────────────────────────────────────────────
// Salir de un club
// ─────────────────────────────────────────────
export async function leaveClub(userId: string, clubId: string) {
  const membership = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId, userId } },
    include: { club: true },
  });
  if (!membership) {
    throw new ClubContextError('No perteneces a ese club', 403, 'NOT_CLUB_MEMBER');
  }
  if (membership.role === ClubRole.OWNER) {
    throw new ClubContextError(
      'La propietaria no puede salir del club. Transfiere la propiedad primero.',
      400,
      'OWNER_CANNOT_LEAVE',
    );
  }
  await prisma.$transaction([
    prisma.clubMember.delete({
      where: { clubId_userId: { clubId, userId } },
    }),
    // Si era el club activo, lo desvinculamos
    prisma.user.update({
      where: { id: userId },
      data: {
        activeClubId: membership.club.id === undefined ? null : undefined,
      },
    }),
  ]);
  // Limpiar activeClubId si era este club
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeClubId: true },
  });
  if (user?.activeClubId === clubId) {
    await prisma.user.update({
      where: { id: userId },
      data: { activeClubId: null },
    });
  }
  return { ok: true };
}

// ─────────────────────────────────────────────
// Actualizar datos del club (solo OWNER/ADMIN)
// ─────────────────────────────────────────────
export async function updateClub(
  userId: string,
  clubId: string,
  data: { nombre?: string; descripcion?: string; avatarUrl?: string },
) {
  const membership = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId, userId } },
  });
  // Para cambiar nombre/descripción se requiere OWNER o ADMIN
  // Para cambiar la foto cualquier miembro puede hacerlo
  const soloFoto = data.nombre === undefined && data.descripcion === undefined;
  if (!membership || (!soloFoto && membership.role !== ClubRole.OWNER && membership.role !== ClubRole.ADMIN)) {
    throw new ClubContextError(
      'No tienes permiso para editar este club',
      403,
      'INSUFFICIENT_CLUB_ROLE',
    );
  }
  const updateData: Record<string, unknown> = {};
  if (data.nombre !== undefined) {
    const nombre = normalizeName(data.nombre);
    if (nombre.length < 3 || nombre.length > 80) {
      throw new ClubContextError(
        'El nombre debe tener entre 3 y 80 caracteres',
        400,
        'INVALID_CLUB_NAME',
      );
    }
    updateData.name = nombre;
  }
  if (data.descripcion !== undefined) {
    updateData.description = data.descripcion.trim() || null;
  }
  if (data.avatarUrl !== undefined) {
    const avatar = data.avatarUrl.trim();
    if (!avatar) {
      updateData.avatarUrl = null;
    } else if (avatar.startsWith('data:image/')) {
      // Imagen desde galería — subir a Cloudinary
      const resultado = await subirAvatarDesdeBase64({
        imageBase64: avatar,
        usuario: `club_${clubId}`,
      });
      updateData.avatarUrl = resultado.url;
    } else {
      // URL externa — subir a Cloudinary
      const resultado = await subirAvatarDesdeUrl({
        imageUrl: avatar,
        usuario: `club_${clubId}`,
      });
      updateData.avatarUrl = resultado.url;
    }
  }

  const updated = await prisma.club.update({
    where: { id: clubId },
    data: updateData,
  });
  return { ok: true, nombre: updated.name, avatarUrl: updated.avatarUrl ?? '' };
}

// ─────────────────────────────────────────────
// Miembros del club
// ─────────────────────────────────────────────
export async function getClubMembers(userId: string, clubId: string) {
  const membership = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId, userId } },
  });
  if (!membership) {
    throw new ClubContextError('No perteneces a ese club', 403, 'NOT_CLUB_MEMBER');
  }
  const members = await prisma.clubMember.findMany({
    where: { clubId },
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  return {
    ok: true,
    miembros: members.map((m) => ({
      id: m.user.id,
      nombre: m.user.name,
      avatarUrl: m.user.avatarUrl ?? '',
      rol: m.role,
      desde: m.joinedAt.toISOString(),
    })),
  };
}