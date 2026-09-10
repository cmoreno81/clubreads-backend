/**
 * Job: cerrar la temporada de Ligas que acaba de terminar y congelar su
 * resultado en RankingSeasonResult (histórico permanente). Idempotente:
 * si ya estaba cerrada, no hace nada.
 *
 * Se ejecuta como cron en Railway, una vez al día de madrugada:
 *   node dist/jobs/close-ranking-season.job.js
 */

import { prisma } from '../prisma.js';
import {
  cerrarTemporada,
  currentSeasonNumber,
  temporadaCerrada,
} from '../services/ligas.service.js';

async function main() {
  await prisma.$queryRaw`SELECT 1`;

  const anterior = currentSeasonNumber() - 1;
  if (anterior < 0) {
    console.log('Ligas: aún no ha terminado ninguna temporada.');
    return;
  }

  if (await temporadaCerrada(anterior)) {
    console.log(`Ligas: la temporada ${anterior} ya estaba cerrada.`);
    return;
  }

  const n = await cerrarTemporada(anterior);
  console.log(`Ligas: temporada ${anterior} cerrada con ${n} participantes.`);
}

main()
  .catch((error) => {
    console.error('Ligas: no se pudo cerrar la temporada:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
