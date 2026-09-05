import 'dotenv/config';

import { prisma } from '../src/prisma.js';
import { backfillMissingBookLanguages } from '../src/services/book-language-backfill.service.js';

const apply = process.argv.includes('--apply');
const limitIndex = process.argv.indexOf('--limit');
const requestedLimit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : undefined;

backfillMissingBookLanguages({ apply, limit: requestedLimit })
  .then((result) => {
    console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'PREVIEW', ...result }, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
