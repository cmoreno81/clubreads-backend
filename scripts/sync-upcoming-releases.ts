import 'dotenv/config';
import { runConfiguredUpcomingReleaseSync } from '../src/jobs/sync-upcoming-releases.job.js';
import { prisma } from '../src/prisma.js';

try {
  const summary = await runConfiguredUpcomingReleaseSync();
  for (const error of summary.errors) console.error(error);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.configuredSources === 0) {
    console.warn(
      'No hay fuentes configuradas. Usa UPCOMING_CASA_DEL_LIBRO_URL o un feed autorizado.',
    );
  } else if (summary.total === 0) {
    console.warn('Las fuentes no devolvieron ningún lanzamiento futuro válido.');
  }
} finally {
  await prisma.$disconnect();
}
