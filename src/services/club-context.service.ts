import { prisma } from '../prisma.js';

const DEFAULT_CLUB_SLUG = 'nuestros-gustos-son-cliches';

export async function getCurrentClubContext() {
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

  return {
    club,
  };
}