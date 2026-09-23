/**
 * Job: abrir Clubvisión programada.
 * Se ejecuta como cron en Railway usando: node dist/jobs/open-clubvision.job.js
 *
 * Sincroniza las ediciones de Clubvisión que toca abrir según su
 * fecha programada, calculando candidatas y preparando la votación.
 * Aprovecha el mismo ciclo diario para avisar a los clubes a los que les
 * van a faltar candidatas para la próxima edición (10 días antes), y para
 * recordar a quien no ha votado que la votación está a punto de cerrar.
 */

import { prisma } from '../prisma.js';
import {
  avisarPocosCandidatosClubvision,
  avisarVotoPendienteClubvision,
  openScheduledClubvision,
} from '../services/clubvision.service.js';

async function main() {
  // Verificar conectividad con la BD antes de proceder
  await prisma.$queryRaw`SELECT 1`;

  const clubvisions = (await openScheduledClubvision()).filter(
    (clubvision) => clubvision !== null,
  );

  if (clubvisions.length === 0) {
    console.log('Clubvisión: no hay ninguna edición que sincronizar ahora');
  } else {
    for (const clubvision of clubvisions) {
      const candidateCount = await prisma.clubvisionCandidate.count({
        where: { clubvisionId: clubvision.id },
      });

      console.log(
        `Clubvisión ${clubvision.edition} sincronizada con ${candidateCount} candidatas`,
      );
    }
  }

  const avisados = await avisarPocosCandidatosClubvision();
  if (avisados > 0) {
    console.log(`Clubvisión: aviso de pocas candidatas enviado a ${avisados} clubes`);
  }

  const recordados = await avisarVotoPendienteClubvision();
  if (recordados > 0) {
    console.log(`Clubvisión: recordatorio de voto pendiente enviado a ${recordados} personas`);
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
