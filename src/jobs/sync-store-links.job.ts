import { createReadStream } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';

import { prisma } from '../prisma.js';
import {
  syncStoreLinks,
  syncStoreLinksFromUrl,
} from '../services/store-link-sync.service.js';

// Uso:
//   npx tsx src/jobs/sync-store-links.job.ts --dry-run
//   npx tsx src/jobs/sync-store-links.job.ts --dry-run --file ~/Downloads/datafeed.csv.gz
// Sin --file usa AWIN_FEED_URL. --dry-run calcula los cambios sin escribirlos.
export function hasStoreFeedConfigured() {
  return Boolean(process.env.AWIN_FEED_URL?.trim());
}

export async function runStoreLinkSync(options: { dryRun?: boolean } = {}) {
  const url = process.env.AWIN_FEED_URL?.trim();
  if (!url) throw new Error('AWIN_FEED_URL_MISSING');
  return syncStoreLinksFromUrl(url, options);
}

export async function main(args = process.argv.slice(2)) {
  const dryRun = args.includes('--dry-run');
  const fileIndex = args.indexOf('--file');
  try {
    const summary =
      fileIndex >= 0
        ? await syncStoreLinks(
            createReadStream(args[fileIndex + 1]!).pipe(createGunzip()),
            { dryRun },
          )
        : await runStoreLinkSync({ dryRun });
    console.log(JSON.stringify(summary));
    return 0;
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'STORE_LINK_SYNC_FAILED',
        detalle: error instanceof Error ? error.message : String(error),
      }),
    );
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entrypoint) process.exitCode = await main();
