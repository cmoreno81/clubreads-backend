import { prisma } from '../src/prisma.js';
import { openScheduledClubvision } from '../src/services/clubvision.service.js';

async function main() {
  await prisma.$queryRaw`SELECT 1`;

  const clubvisions = (await openScheduledClubvision()).filter(
    (clubvision) => clubvision !== null,
  );

  if (clubvisions.length === 0) {
    console.log('Clubvisión: no hay una edición que sincronizar');
    return;
  }

  for (const clubvision of clubvisions) {
    const candidateCount = await prisma.clubvisionCandidate.count({
      where: { clubvisionId: clubvision.id },
    });

    console.log(
      `Clubvisión ${clubvision.edition} sincronizada con ${candidateCount} candidatas`,
    );
  }
}

main()
  .catch((error) => {
    console.error('No se pudo preparar Clubvisión', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
