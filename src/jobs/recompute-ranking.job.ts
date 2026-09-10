/**
 * Job único de Ligas para el cron de Railway:
 *   node dist/jobs/recompute-ranking.job.js
 * Frecuencia sugerida: cada 1-3 horas.
 *
 * 1. Recalcula la temporada en curso para todos los participantes
 *    (mantiene la tabla fresca sin depender de que alguien la abra).
 * 2. Si la temporada anterior ya terminó y aún no se ha congelado,
 *    la cierra (snapshot en RankingSeasonResult = histórico permanente).
 *    Es idempotente: en cuanto está cerrada, este paso no hace nada.
 */

import { prisma } from '../prisma.js';
import {
  cerrarTemporada,
  currentSeasonNumber,
  recalcularTemporada,
  temporadaCerrada,
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

  // Cierre de la temporada anterior si procede.
  const anterior = season - 1;
  if (anterior >= 0 && !(await temporadaCerrada(anterior))) {
    const n = await cerrarTemporada(anterior);
    console.log(`Ligas: temporada ${anterior} cerrada con ${n} participantes.`);
  }
}

main()
  .catch((error) => {
    console.error('Ligas: no se pudo recalcular la temporada:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
