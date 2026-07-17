import { prisma } from '../src/prisma.js';
import { openScheduledClubvision } from '../src/services/clubvision.service.js';

async function main() {
  await prisma.$queryRaw`SELECT 1`;

  const clubvision = await openScheduledClubvision();

  if (!clubvision) {
    console.log('Clubvisión: no hay una edición que sincronizar');
    return;
  }

  const candidateCount = await prisma.clubvisionCandidate.count({
    where: { clubvisionId: clubvision.id },
  });

  console.log(
    `Clubvisión ${clubvision.edition} sincronizada con ${candidateCount} candidatas`,
  );
}

main()
  .catch((error) => {
    console.error('No se pudo preparar Clubvisión', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
