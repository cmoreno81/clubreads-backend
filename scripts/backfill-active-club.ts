import { prisma } from '../src/prisma.js';

const DEFAULT_CLUB_SLUG = 'nuestros-gustos-son-cliches';

async function main() {
  const club = await prisma.club.findUnique({
    where: {
      slug: DEFAULT_CLUB_SLUG,
    },
  });

  if (!club) {
    throw new Error(`No existe el club ${DEFAULT_CLUB_SLUG}`);
  }

  const result = await prisma.user.updateMany({
    where: {
      activeClubId: null,
    },
    data: {
      activeClubId: club.id,
    },
  });

  console.log(`✅ Usuarios actualizados: ${result.count}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });