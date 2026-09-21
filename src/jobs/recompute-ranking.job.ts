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
  actualizarTendencias,
  avisarCierreProximo,
  avisarRachaEnRiesgo,
  calcularRetoSemanal,
  cerrarTemporada,
  currentSeasonNumber,
  recalcularTemporada,
  temporadaCerrada,
} from '../services/ligas.service.js';
import { cerrarTemporadaClubes } from '../services/ligas-clubes.service.js';

async function main() {
  await prisma.$queryRaw`SELECT 1`;

  const now = new Date();
  const season = currentSeasonNumber(now);
  const participantes = await prisma.rankingParticipation.findMany({
    select: { userId: true },
  });

  let ok = 0;
  for (const { userId } of participantes) {
    try {
      await recalcularTemporada(userId, season);
      await calcularRetoSemanal(userId, now);
      ok += 1;
    } catch (error) {
      console.error(`Ligas: fallo recalculando ${userId}:`, error);
    }
  }

  console.log(
    `Ligas: temporada ${season} recalculada para ${ok}/${participantes.length} participantes`,
  );

  // Aviso de racha en riesgo (solo hace algo entre las 20:00 y las 23:00 de Madrid).
  const enRiesgo = await avisarRachaEnRiesgo(now).catch((error) => {
    console.error('Ligas: no se pudo avisar de racha en riesgo:', error);
    return 0;
  });
  if (enRiesgo > 0) {
    console.log(`Ligas: aviso de racha en riesgo enviado a ${enRiesgo} participantes.`);
  }

  // Guarda la posición de cada participante para el indicador de
  // sube/baja puestos del siguiente ciclo.
  await actualizarTendencias(season).catch((error) => {
    console.error('Ligas: no se pudieron actualizar las tendencias:', error);
  });

  // Aviso de cierre inminente de la temporada en curso (una vez por usuario).
  const avisados = await avisarCierreProximo(season, now);
  if (avisados > 0) {
    console.log(`Ligas: aviso de cierre enviado a ${avisados} participantes.`);
  }

  // Cierre de la temporada anterior si procede.
  const anterior = season - 1;
  if (anterior >= 0 && !(await temporadaCerrada(anterior))) {
    const n = await cerrarTemporada(anterior);
    console.log(`Ligas: temporada ${anterior} cerrada con ${n} participantes.`);

    const nClubes = await cerrarTemporadaClubes(anterior);
    console.log(`Ligas de clubes: temporada ${anterior} cerrada con ${nClubes} clubes.`);
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
