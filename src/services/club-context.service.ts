import { prisma } from '../prisma.js';
import type { ClubRole } from '@prisma/client';

const DEFAULT_CLUB_SLUG = 'nuestros-gustos-son-cliches';

export class ClubContextError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ClubContextError';
  }
}

async function getDefaultClub() {
  const club = await prisma.club.findUnique({
    where: {
      slug: DEFAULT_CLUB_SLUG,
    },
  });

  if (!club) {
    throw new Error(
      `No existe el club fundador (${DEFAULT_CLUB_SLUG})`,
    );
  }

  return club;
}

export async function getCurrentClubContext(usuario?: string) {
  const normalizedUserName = usuario?.trim();

  /*
   * Compatibilidad con la APK actual y con procesos automáticos
   * como el cron de Clubvisión.
   */
  if (!normalizedUserName) {
    const club = await getDefaultClub();

    return {
      club,
      user: null,
      membership: null,
    };
  }

  const user = await prisma.user.findUnique({
    where: {
      name: normalizedUserName,
    },
    include: { activeClub: true },
  });

  if (!user) {
    throw new ClubContextError(
      `Usuaria no encontrada: ${normalizedUserName}`,
      404,
      'USER_NOT_FOUND',
    );
  }

  if (!user.activeClub) {
    throw new ClubContextError(
      'Selecciona o crea un club para continuar',
      409,
      'NO_ACTIVE_CLUB',
    );
  }
  const club = user.activeClub;
  const membership = await prisma.clubMember.findUnique({
    where: {
      clubId_userId: {
        clubId: club.id,
        userId: user.id,
      },
    },
  });

  if (!membership) {
    throw new ClubContextError(
      `La usuaria no pertenece al club activo: ${club.name}`,
      403,
      'NOT_CLUB_MEMBER',
    );
  }

  return {
    club,
    user,
    membership,
  };
}

export async function requireClubMember(usuario?: string) {
  if (!usuario?.trim()) {
    throw new ClubContextError(
      'Falta la usuaria',
      400,
      'USER_REQUIRED',
    );
  }

  const context = await getCurrentClubContext(usuario);
  if (!context.user || !context.membership) {
    throw new ClubContextError(
      'Se necesita una miembro del club',
      403,
      'NOT_CLUB_MEMBER',
    );
  }

  return {
    club: context.club,
    user: context.user,
    membership: context.membership,
  };
}

export async function requireClubRole(
  usuario: string | undefined,
  roles: ClubRole[],
) {
  const context = await requireClubMember(usuario);

  if (!roles.includes(context.membership.role)) {
    throw new ClubContextError(
      'No tienes permisos para realizar esta acción',
      403,
      'INSUFFICIENT_CLUB_ROLE',
    );
  }

  return context;
}
