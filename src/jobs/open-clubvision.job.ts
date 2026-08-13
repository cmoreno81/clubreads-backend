/**
 * Job: abrir Clubvisión programada.
 * Se ejecuta como cron en Railway usando: node dist/jobs/open-clubvision.job.js
 *
 * Sincroniza las ediciones de Clubvisión que toca abrir según su
 * fecha programada, calculando candidatas y preparando la votación.
 */

import { prisma } from '../prisma.js';
import { openScheduledClubvision } from '../services/clubvision.service.js';

async function main() {
  // Verificar conectividad con la BD antes de proceder
  await prisma.$queryRaw`SELECT 1`;

  const clubvisions = (await openScheduledClubvision()).filter(
    (clubvision) => clubvision !== null,
  );

  if (clubvisions.length === 0) {
    console.log('Clubvisión: no hay ninguna edición que sincronizar ahora');
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
    console.error('No se pudo preparar Clubvisión:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
