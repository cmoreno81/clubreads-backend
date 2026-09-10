/**
 * Job: recalcular la temporada de Ligas en curso para todos los
 * participantes. Mantiene la tabla fresca sin depender de que alguien
 * la abra. Se ejecuta como cron en Railway:
 *   node dist/jobs/recompute-ranking.job.js
 * Frecuencia sugerida: cada 1-3 horas.
 */

import { prisma } from '../prisma.js';
import {
  currentSeasonNumber,
  recalcularTemporada,
} from '../services/ligas.service.js';

async function main() {
  await prisma.$queryRaw`SELECT 1`;

  const season = currentSeasonNumber();
  const participantes = await prisma.rankingParticipation.findMany({
    select: { userId: true },
  });

  let ok = 0;
  for (const { userId } of participantes) {
    try {
      await recalcularTemporada(userId, season);
      ok += 1;
    } catch (error) {
      console.error(`Ligas: fallo recalculando ${userId}:`, error);
    }
  }

  console.log(
    `Ligas: temporada ${season} recalculada para ${ok}/${participantes.length} participantes`,
  );
}

main()
  .catch((error) => {
    console.error('Ligas: no se pudo recalcular la temporada:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
